// transport service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  const representations = new Map();
  let representationBytes = 0;
  function trimRepresentations() {
    while (representations.size > 64 || representationBytes > 16 * 1024 * 1024) {
      const key = representations.keys().next().value;
      const value = representations.get(key);
      representationBytes -= value.body.length + (value.gzipBytes || 0);
      representations.delete(key);
    }
  }
  function httpsGet(url, cb, signal) {
    const u = new URL(url);
    // cb 只允许调一次：timeout destroy 会同时触发 req/res 的 error 事件，
    // 双回调会让新闻刷新的页计数错乱，造成 promise 永久挂死（所有后续刷新被挡）。
    let settled = false;
    let deadline;
    const done = (err, json, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (signal) signal.removeEventListener("abort", abort);
      cb(err, json, body);
    };
    const req = deps.https.request(
      u,
      {
        method: "GET",
        family: 4,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://umamusume.jp/news",
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return done(Object.assign(new Error('HTTP ' + res.statusCode), { status: res.statusCode }));
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 8 * 1024 * 1024) req.destroy(new Error('upstream response too large'));
          else chunks.push(c);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(body);
          } catch (e) {
            /* keep null */
          }
          done(null, json, body);
        });
        res.on("error", (e) => done(e, null, null));
        res.on("aborted", () =>
          done(new Error("upstream response aborted"), null, null),
        );
      },
    );
    const abort = () => req.destroy(new Error("cancelled"));
    deadline = setTimeout(() => req.destroy(new Error('upstream deadline')), 25000);
    req.on("error", (e) => done(e, null, null));
    if (signal) {
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }
    req.setTimeout(20000, function () {
      try {
        req.destroy(new Error("timeout"));
      } catch (e) {}
      done(new Error("timeout"), null, null);
    });
    req.end();
  }

  function httpsGetHtml(url, cb, redirects, signal, expires = Date.now() + 25000) {
    let completed = false;
    let abort;
    let deadline;
    const done = (err, body) => {
      if (!completed) {
        completed = true;
        clearTimeout(deadline);
        if (signal && abort) signal.removeEventListener("abort", abort);
        cb(err, body);
      }
    };
    if ((redirects || 0) > 5) {
      done(new Error("too many redirects"));
      return;
    }
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      done(new Error("bad url"));
      return;
    }
    const req = deps.https.request(
      u,
      {
        method: "GET",
        family: 4,
        headers: { "User-Agent": "Mozilla/5.0" },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          try {
            httpsGetHtml(
              new URL(res.headers.location, u).href,
              done,
              (redirects || 0) + 1,
              signal,
              expires,
            );
          } catch (error) {
            done(error);
          }
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          done(new Error("HTTP " + res.statusCode));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 8 * 1024 * 1024) req.destroy(new Error('upstream response too large'));
          else chunks.push(c);
        });
        res.on("end", () => done(null, Buffer.concat(chunks).toString("utf8")));
        res.on("error", (e) => done(e, null));
        res.on("aborted", () => done(new Error("upstream response aborted")));
      },
    );
    abort = () => req.destroy(new Error("cancelled"));
    deadline = setTimeout(() => req.destroy(new Error('upstream deadline')), Math.max(1, expires - Date.now()));
    req.on("error", (e) => done(e, null));
    if (signal) {
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }
    req.setTimeout(20000, function () {
      try {
        req.destroy(new Error("timeout"));
      } catch (e) {}
    });
    req.end();
  }

  function sendJson(res, code, obj, options) {
    if (res.destroyed || res.writableEnded) return;
    const settings = options || {};
    const headers = Object.assign(
      {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": settings.cacheControl || "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      settings.headers || {},
    );
    headers.Vary = 'Accept-Encoding';
    if (settings.etag) headers.ETag = settings.etag;
    if (
      settings.etag &&
      res.req &&
      res.req.headers["if-none-match"] === settings.etag
    ) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    let representation = settings.etag && representations.get(settings.etag);
    if (!representation) {
      representation = { body: Buffer.from(JSON.stringify(obj)), gzip: null };
      if (code === 200 && settings.etag && representation.body.length <= 4 * 1024 * 1024) {
        representations.set(settings.etag, representation);
        representationBytes += representation.body.length;
        trimRepresentations();
      }
    }
    const body = representation.body;
    const finish = (payload, compressed) => {
      if (res.destroyed || res.writableEnded) return;
      if (compressed) {
        headers["Content-Encoding"] = "gzip";
        headers.Vary = "Accept-Encoding";
      }
      headers["Content-Length"] = payload.length;
      res.writeHead(code, headers);
      res.end(payload);
    };
    if (body.length >= 1024 && res.req && deps.requestAcceptsGzip(res.req)) {
      if (!representation.gzip) representation.gzip = new Promise(resolve =>
        deps.zlib.gzip(body, (error, compressed) => {
          if (!error && representations.get(settings.etag) === representation) {
            representation.gzipBytes = compressed.length;
            representationBytes += compressed.length;
            trimRepresentations();
          }
          resolve(error ? null : compressed);
        }));
      representation.gzip.then(compressed => finish(compressed || body, !!compressed));
    } else {
      finish(body, false);
    }
  }
  return { httpsGet, sendJson, httpsGetHtml };
};
