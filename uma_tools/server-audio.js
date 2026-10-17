// audio service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  const AUDIO_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";

  const METING_HOSTS = new Set([
    "api.injahow.cn",
    "met.liiiu.cn",
    "api.baka.plus",
    "meting.mikus.ink",
  ]);

  function isAllowedAudioUrl(value) {
    let u;
    try {
      u = new URL(value);
    } catch (e) {
      return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.port && u.port !== "80" && u.port !== "443") return false;
    const host = u.hostname.toLowerCase().replace(/\.$/, "");
    return (
      METING_HOSTS.has(host) ||
      host === "music.163.com" ||
      host === "music.126.net" ||
      host.endsWith(".music.126.net")
    );
  }

  function metingCandidates(target) {
    let u;
    try {
      u = new URL(target);
    } catch (e) {
      return [target];
    }
    const q = u.searchParams;
    const server = q.get("server") || "netease";
    const type = q.get("type") || "url";
    const id = q.get("id");
    if (!id) return [target];
    const mirrorTpl = [
      { host: "api.injahow.cn", path: "/meting/" },
      { host: "met.liiiu.cn", path: "/meting/api" },
      { host: "api.baka.plus", path: "/meting/" },
      { host: "meting.mikus.ink", path: "/api" },
    ];
    const seen = [];
    const out = [];
    [target].forEach(function (t) {
      seen.push(t);
      out.push(t);
    });
    mirrorTpl.forEach(function (m) {
      const cand =
        "https://" +
        m.host +
        m.path +
        "?server=" +
        encodeURIComponent(server) +
        "&type=" +
        encodeURIComponent(type) +
        "&id=" +
        encodeURIComponent(id);
      if (seen.indexOf(cand) === -1) {
        seen.push(cand);
        out.push(cand);
      }
    });
    return out;
  }

  function audioFetchOnce(url, headers, cb, hops, onRequest) {
    hops = hops || 0;
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      cb(new Error("bad url"));
      return null;
    }
    if (!isAllowedAudioUrl(u.href)) {
      cb(new Error("audio host not allowed"));
      return null;
    }
    const mod = u.protocol === "http:" ? deps.http : deps.https;
    let called = false;
    const done = (err, r, pref) => {
      if (called) return;
      called = true;
      cb(err, r, pref);
    };
    const pref = mod.get(u, { headers: headers, family: 4 }, (r) => {
      // Meting mirrors answer type=url with a 302 to the real CDN audio; follow it.
      if (
        hops < 5 &&
        r.statusCode >= 300 &&
        r.statusCode < 400 &&
        r.headers.location
      ) {
        r.resume();
        try {
          const next = new URL(r.headers.location, u).href;
          audioFetchOnce(next, headers, done, hops + 1, onRequest);
        } catch (error) { done(error, null, pref); }
        return;
      }
      done(null, r, pref);
    });
    if (onRequest) onRequest(pref);
    pref.on("error", (e) => done(e, null, pref));
    pref.setTimeout(5000, function () {
      try {
        pref.destroy(new Error("timeout"));
      } catch (e) {}
    });
    return pref;
  }

  function handleAudioProxy(req, res, params) {
    const target = params.get("url");
    if (!target || !isAllowedAudioUrl(target)) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("bad audio url");
      return;
    }
    const candidates = metingCandidates(target);
    let idx = 0;
    let activeUpstream = null;
    let activeResponse = null;
    let clientClosed = false;
    const deadline = setTimeout(() => {
      clientClosed = true;
      if (activeUpstream) activeUpstream.destroy(new Error('audio deadline'));
      if (!res.headersSent) { res.writeHead(504); res.end('audio source timed out'); }
      else res.destroy();
    }, 18000);

    function tryNext() {
      if (clientClosed) return;
      if (idx >= candidates.length) {
        try {
          res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("audio proxy failed");
        } catch (e) {}
        return;
      }
      const url = candidates[idx++];
      const headers = {
        "User-Agent": AUDIO_UA,
        Referer: "https://music.163.com/",
      };
      if (req.headers.range) headers.Range = req.headers.range;
      audioFetchOnce(
        url,
        headers,
        (err, r, pref) => {
          if (clientClosed) {
            try {
              if (pref) pref.destroy();
            } catch (e) {}
            return;
          }
          if (err || !r) {
            try {
              if (pref) pref.destroy();
            } catch (e) {}
            tryNext();
            return;
          }
          const ct = String(r.headers["content-type"] || "");
          const isAudio = /audio\//i.test(ct) || /octet-stream/i.test(ct);
          const bad =
            ![200, 206].includes(r.statusCode) || !isAudio;
          const invalidRange =
            r.statusCode === 206 && !r.headers["content-range"];
          if (bad || invalidRange) {
            r.resume(); // drain
            try {
              if (pref) pref.destroy();
            } catch (e) {}
            tryNext();
            return;
          }
          const h = {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "private, max-age=3600",
          };
          if (r.headers["content-type"])
            h["Content-Type"] = r.headers["content-type"];
          else h["Content-Type"] = "application/octet-stream";
          h["Accept-Ranges"] = r.headers["accept-ranges"] || "bytes";
          if (r.headers["content-length"])
            h["Content-Length"] = r.headers["content-length"];
          if (r.headers["content-range"])
            h["Content-Range"] = r.headers["content-range"];
          try {
            clearTimeout(deadline);
            pref.setTimeout(20000);
            res.writeHead(r.statusCode || 200, h);
            activeResponse = r;
            deps.pipeline(r, res, function (streamError) {
              activeResponse = null;
              if (streamError && !clientClosed && !res.writableEnded) {
                try {
                  res.destroy(streamError);
                } catch (e) {}
              }
            });
          } catch (e) {
            try {
              if (pref) pref.destroy();
            } catch (e2) {}
          }
        },
        0,
        function (pref) {
          activeUpstream = pref;
        },
      );
    }
    res.on("close", () => {
      clearTimeout(deadline);
      clientClosed = true;
      try {
        if (activeResponse) activeResponse.destroy();
      } catch (e) {}
      try {
        if (activeUpstream) activeUpstream.destroy();
      } catch (e) {}
    });
    tryNext();
  }
  return { handleAudioProxy };
};
