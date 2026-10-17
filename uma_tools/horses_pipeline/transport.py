"""Transport responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from knowledge_io import bounded_read

deadline = float('inf')
failures = []
_last_cleanup = 0


def cleanup_cache():
    global _last_cleanup
    now = pipeline_common.time.time()
    if now - _last_cleanup < 3600:
        return
    _last_cleanup = now
    rows = []
    for item in pipeline_common.os.scandir(pipeline_common.CACHE_DIR):
        if item.is_file() and pipeline_common.re.fullmatch(r'[0-9a-f]{16}\.(txt|bin)', item.name):
            stat = item.stat()
            rows.append((stat.st_mtime, stat.st_size, item.path))
    total = sum(row[1] for row in rows)
    for modified, size, path in sorted(rows):
        if now - modified <= 7 * 86400 and total <= 128 * 1024 * 1024:
            continue
        try:
            pipeline_common.os.unlink(path)
            total -= size
        except FileNotFoundError:
            pass


def _opener(use_proxy):
    if not use_proxy:
        return pipeline_common.urllib.request.build_opener(pipeline_common.urllib.request.ProxyHandler({}))
    handler = pipeline_common.urllib.request.ProxyHandler({
        'http': pipeline_common.PROXY,
        'https': pipeline_common.PROXY,
    })
    return pipeline_common.urllib.request.build_opener(handler)


def _request(url):
    return pipeline_common.urllib.request.Request(url, headers={
        'User-Agent': pipeline_common.UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
    })


def http_get(url, binary=False, timeout=12):
    """带磁盘缓存、429/瞬断退避与代理回退的抓取。Wikipedia 域名走代理优先。"""
    digest = pipeline_common.hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]
    ext = '.bin' if binary else '.txt'
    path = pipeline_common.os.path.join(pipeline_common.CACHE_DIR, digest + ext)
    if pipeline_common.os.path.isfile(path) and pipeline_common.time.time() - pipeline_common.os.path.getmtime(path) < 86400:
        with open(path, 'rb') as handle:
            data = handle.read()
        return data if binary else data.decode('utf-8', 'replace')
    pipeline_common.os.makedirs(pipeline_common.CACHE_DIR, exist_ok=True)
    cleanup_cache()
    request_deadline = min(deadline, pipeline_common.time.monotonic() + timeout * 4)
    needs_proxy = ('wikipedia.org' in url) or ('wikimedia.org' in url) or ('netkeiba.com' in url)
    order = [True, False] if needs_proxy else [False, True]
    last_error = None
    for attempt in range(2):
        for use_proxy in order:
            remaining = request_deadline - pipeline_common.time.monotonic()
            if remaining <= 0:
                failures.append('horse update time budget exhausted')
                raise RuntimeError('horse update time budget exhausted')
            try:
                with _opener(use_proxy).open(_request(url), timeout=min(timeout, remaining)) as resp:
                    data = bounded_read(resp, limit=16 * 1024 * 1024, deadline=request_deadline)
                descriptor, temporary = pipeline_common.tempfile.mkstemp(prefix='horse-source-', dir=pipeline_common.CACHE_DIR)
                try:
                    with pipeline_common.os.fdopen(descriptor, 'wb') as handle:
                        handle.write(data)
                    pipeline_common.os.replace(temporary, path)
                finally:
                    if pipeline_common.os.path.exists(temporary):
                        pipeline_common.os.unlink(temporary)
                return data if binary else data.decode('utf-8', 'replace')
            except pipeline_common.urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code not in (429, 500, 502, 503, 504):
                    if exc.code != 404 and use_proxy != order[-1]:
                        continue
                    if exc.code != 404:
                        failures.append('HTTP %s: %s' % (exc.code, url))
                    raise RuntimeError('HTTP %s: %s' % (exc.code, url)) from exc
                if attempt < 1:
                    pipeline_common.time.sleep(2 + attempt * 4)
                    continue
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                continue
        pipeline_common.time.sleep(1 + attempt * 2)
    failures.append(str(last_error))
    raise RuntimeError(repr(last_error))
