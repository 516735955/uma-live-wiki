// application service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  let server;

  function start() {
    server = deps.http.createServer((req, res) => {
      let urlObj;
      let urlPath;
      try {
        urlObj = new URL(req.url, "http://x");
        urlPath = decodeURIComponent(urlObj.pathname || "/");
        if (urlPath.indexOf("\0") !== -1) throw new Error("null byte in path");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("400 Bad Request");
        return;
      }
      const params = urlObj.searchParams;
      if (/(?:^|\/)(?:\.[^/]+|baidu\.conf\.json)(?:\/|$)/i.test(urlPath) ||
          /^\/data\/(?:auto_update|horses_cache|news_image_cache)(?:\/|$)/i.test(urlPath) ||
          /\.(?:sqlite3?|db)(?:-wal|-shm)?$/i.test(urlPath)) {
        res.writeHead(404, { "Cache-Control": "no-store" });
        res.end("Not Found");
        return;
      }

      if (req.method === "GET" && urlPath === "/api/release")
        return deps.sendJson(
          res,
          200,
          { commit: deps.releaseInfo.commit },
          { cacheControl: "no-store" },
        );
      if (req.method === "GET" && urlPath === "/api/news-index")
        return deps.handleNewsIndex(res);
      if (req.method === "GET" && urlPath === "/api/home-summary")
        return deps.handleHomeSummary(res);
      if (req.method === "GET" && urlPath.startsWith("/api/catalog/"))
        return deps.handleCatalogApi(req, res, urlPath, params);
      if (req.method === "GET" && urlPath === "/api/news-detail")
        return deps.handleNewsDetail(req, res, params);
      if (req.method === "GET" && urlPath === "/api/news-image") {
        deps
          .loadNewsImage(params.get("url"))
          .then(({ bytes, extension }) => {
            if (res.destroyed || res.writableEnded) return;
            res.writeHead(200, {
              "Content-Type": deps.MIME[extension],
              "Content-Length": bytes.length,
              "Cache-Control": "public, max-age=3600",
            });
            res.end(bytes);
          })
          .catch((error) =>
            deps.sendJson(
              res,
              error.message === "unsupported news image" ? 400 : 502,
              { error: error.message },
            ),
          );
        return;
      }
      if (req.method === "GET" && urlPath === "/api/lantis-news")
        return deps.handleLantisNews(res);
      if (req.method === "GET" && urlPath === "/api/lantis-detail")
        return deps.handleLantisDetail(req, res, params);
      if (req.method === "GET" && urlPath === "/api/audio")
        return deps.handleAudioProxy(req, res, params);
      if (urlPath.startsWith("/api/"))
        return deps.sendJson(res, 404, { error: "unknown api endpoint" });

      if (urlPath === "/") {
        res.writeHead(302, {
          Location: "/zh-Hans/",
          "Cache-Control": "no-cache",
        });
        res.end();
        return;
      }
      if (urlPath === "/zh-Hans") {
        res.writeHead(301, {
          Location: "/zh-Hans/",
          "Cache-Control": "no-cache",
        });
        res.end();
        return;
      }
      let filePath = deps.path.normalize(deps.path.join(deps.ROOT, urlPath));
      if (!deps.isInsideRoot(filePath)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      deps.fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) {
          // Localized client routes may contain dots in entity names and IDs.
          // Serve the SPA for that namespace, including direct opens and refreshes.
          if (urlPath.startsWith("/zh-Hans/") || !deps.path.extname(urlPath)) {
            filePath = deps.path.join(deps.ROOT, deps.INDEX_FILE);
            return deps.serveFile(filePath, req, res);
          }
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("404 Not Found: " + urlPath);
          return;
        }
        deps.serveFile(filePath, req, res);
      });
    });
    server.listen(deps.PORT, () => {
      console.log(
        "Serving " + deps.ROOT + "  ->  http://localhost:" + deps.PORT + "/",
      );
      console.log(
        "News proxy ready: /api/news-index  /api/news-detail?id=xxx  /api/lantis-news  /api/audio?url=...",
      );
      deps.reloadLantis();
      if (deps.AUTO_CRAWL_DISABLED ?? deps.NO_AUTO_CRAWL) {
        console.log("Automatic data refresh disabled (--no-crawl).");
        return;
      }
      const refreshNews = () => {
        if (deps.NO_AUTO_CRAWL) return;
        deps.refreshNewsIndex().catch((error) => {
        console.error(
          "[news] startup refresh failed:",
          (error && error.message) || error,
        );
        });
      };
      refreshNews();
      setTimeout(() => deps.runCatalogRefresh("startup"), 60 * 1000);
      setTimeout(() => deps.ensureLantisFresh(), 5 * 1000);
      // The persistent runner selects daily jobs and retries only failed sources.
      setInterval(() => deps.runCatalogRefresh("scheduled"), 60 * 60 * 1000);
      // 定时自愈：访客触发之外每 30 分钟主动刷一次新闻/CD相关，挂死/失败也能自行恢复
      setInterval(
        () => {
          if (deps.NO_AUTO_CRAWL) return;
          deps.ensureLantisFresh();
          deps.refreshNewsIndex().catch((error) => {
            console.error(
              "[news] scheduled refresh failed:",
              (error && error.message) || error,
            );
          });
        },
        30 * 60 * 1000,
      );
    });
  }
  return {
    start,
    get server() {
      return server;
    },
  };
};
