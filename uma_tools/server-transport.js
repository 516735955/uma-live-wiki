// transport service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  function httpsGet(url, cb, signal) {
    const u = new URL(url);
    // cb 只允许调一次：timeout destroy 会同时触发 req/res 的 error 事件，
    // 双回调会让新闻刷新的页计数错乱，造成 promise 永久挂死（所有后续刷新被挡）。
    let settled = false;
    const done = (err, json, body) => {
      if (settled) return;
      settled = true;
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
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
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

  function httpsGetHtml(url, cb, redirects, signal) {
    let completed = false;
    let abort;
    const done = (err, body) => {
      if (!completed) {
        completed = true;
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
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks).toString("utf8")));
        res.on("error", (e) => done(e, null));
        res.on("aborted", () => done(new Error("upstream response aborted")));
      },
    );
    abort = () => req.destroy(new Error("cancelled"));
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
    const body = Buffer.from(JSON.stringify(obj));
    const headers = Object.assign(
      {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": settings.cacheControl || "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      settings.headers || {},
    );
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
      deps.zlib.gzip(body, (err, compressed) =>
        finish(err ? body : compressed, !err),
      );
    } else {
      finish(body, false);
    }
  }
  function start() {}
  return { start, httpsGet, sendJson, httpsGetHtml };
};
