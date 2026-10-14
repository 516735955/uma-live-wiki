// static service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
  };

  const COMPRESSIBLE_EXTENSIONS = new Set([
    ".html",
    ".htm",
    ".json",
    ".js",
    ".mjs",
    ".css",
    ".svg",
  ]);

  function requestAcceptsGzip(req) {
    return String(req.headers["accept-encoding"] || "")
      .split(",")
      .some((entry) => {
        const parts = entry.trim().toLowerCase().split(";");
        if (parts[0] !== "gzip" && parts[0] !== "*") return false;
        const quality = parts
          .slice(1)
          .find((part) => part.trim().startsWith("q="));
        return !quality || Number(quality.trim().slice(2)) > 0;
      });
  }

  function isInsideRoot(filePath) {
    const relativePath = deps.path.relative(deps.ROOT, filePath);
    return (
      relativePath === "" ||
      (relativePath !== ".." &&
        !relativePath.startsWith(".." + deps.path.sep) &&
        !deps.path.isAbsolute(relativePath))
    );
  }

  const INDEX_CANDIDATES = ["index.html", "赛马娘LIVE相关.html"];

  let INDEX_FILE = "index.html";

  function serveFile(filePath, req, res) {
    deps.fs.stat(filePath, (err2, st2) => {
      if (err2 || !st2.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }
      const ext = deps.path.extname(filePath).toLowerCase();
      const requestUrl = new URL(req.url, "http://x");
      const versioned = /^\/assets\/[a-f0-9]{16}\.(?:js|css)$/.test(
        requestUrl.pathname,
      );
      const isHtml = ext === ".html" || ext === ".htm";
      const isMedia = [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".svg",
        ".gif",
        ".ico",
      ].includes(ext);
      const cacheControl = isHtml
        ? "no-cache"
        : requestUrl.pathname.startsWith("/data/") && ext !== ".js"
          ? "public, max-age=3600, stale-while-revalidate=86400"
          : versioned
            ? "public, max-age=31536000, immutable"
            : isMedia
              ? "public, max-age=2592000, stale-while-revalidate=86400"
              : "no-cache";
      const headers = {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
        "Last-Modified": st2.mtime.toUTCString(),
      };
      const ifModifiedSince = Date.parse(
        req.headers["if-modified-since"] || "",
      );
      if (
        !isNaN(ifModifiedSince) &&
        Math.floor(st2.mtimeMs / 1000) <= Math.floor(ifModifiedSince / 1000)
      ) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
      const shouldCompress =
        st2.size >= 1024 &&
        COMPRESSIBLE_EXTENSIONS.has(ext) &&
        requestAcceptsGzip(req);
      if (shouldCompress) {
        headers["Content-Encoding"] = "gzip";
        headers.Vary = "Accept-Encoding";
      } else {
        headers["Content-Length"] = st2.size;
      }
      res.writeHead(200, headers);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const input = deps.fs.createReadStream(filePath);
      const streams = shouldCompress
        ? [input, deps.zlib.createGzip(), res]
        : [input, res];
      deps.pipeline(...streams, (error) => {
        if (error && !res.destroyed) res.destroy(error);
      });
    });
  }
  function start() {
    try {
      INDEX_FILE =
        INDEX_CANDIDATES.find((f) =>
          deps.fs.existsSync(deps.path.join(deps.ROOT, f)),
        ) || "index.html";
    } catch (e) {
      /* keep default */
    }
  }
  return {
    start,
    requestAcceptsGzip,
    isInsideRoot,
    MIME,
    serveFile,
    get INDEX_FILE() {
      return INDEX_FILE;
    },
    set INDEX_FILE(value) {
      INDEX_FILE = value;
    },
  };
};
