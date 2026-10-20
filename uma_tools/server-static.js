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
    ".avif": "image/avif",
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
    const values = new Map(String(req.headers['accept-encoding'] || '').split(',').map(entry => {
      const [name, ...parameters] = entry.trim().toLowerCase().split(';');
      const quality = parameters.find(value => value.trim().startsWith('q='));
      return [name, quality ? Number(quality.trim().slice(2)) : 1];
    }));
    return (values.has('gzip') ? values.get('gzip') : values.get('*') || 0) > 0;
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
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }
    deps.fs.open(filePath, 'r', (openError, fd) => {
      if (openError) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404 Not Found"); return;
      }
      deps.fs.fstat(fd, (err2, st2) => {
      if (err2 || !st2.isFile()) {
        deps.fs.close(fd, () => {});
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
        ".avif",
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
            ? (/^[a-f0-9]{40}$/.test(requestUrl.searchParams.get('v') || '') ? "public, max-age=2592000" : "no-cache")
              : "no-cache";
      const headers = {
        "ETag": '"' + st2.size.toString(16) + '-' + st2.mtimeMs.toString(16) + '"',
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": cacheControl,
        "Last-Modified": st2.mtime.toUTCString(),
        "Vary": "Accept-Encoding",
      };
      const ifModifiedSince = Date.parse(
        req.headers["if-modified-since"] || "",
      );
      if (
        req.headers['if-none-match']
          ? req.headers['if-none-match'].split(',').map(value => value.trim().replace(/^W\//, '')).some(value => value === '*' || value === headers.ETag)
          : !isNaN(ifModifiedSince) && st2.mtimeMs <= ifModifiedSince
      ) {
        deps.fs.close(fd, () => {});
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
        deps.fs.close(fd, () => {});
        res.end();
        return;
      }
        const input = deps.fs.createReadStream(null, { fd, autoClose: true });
      const streams = shouldCompress
        ? [input, deps.zlib.createGzip(), res]
        : [input, res];
      deps.pipeline(...streams, (error) => {
        if (error && !res.destroyed) res.destroy(error);
      });
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
