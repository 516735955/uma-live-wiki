"""Transport responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common


def _opener(use_proxy):
    if not use_proxy:
        return pipeline_common.urllib.request.build_opener()
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


def http_get(url, binary=False, timeout=60):
    """带磁盘缓存、429/瞬断退避与代理回退的抓取。Wikipedia 域名走代理优先。"""
    digest = pipeline_common.hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]
    ext = '.bin' if binary else '.txt'
    path = pipeline_common.os.path.join(pipeline_common.CACHE_DIR, digest + ext)
    if pipeline_common.os.path.isfile(path):
        with open(path, 'rb') as handle:
            data = handle.read()
        return data if binary else data.decode('utf-8', 'replace')
    pipeline_common.os.makedirs(pipeline_common.CACHE_DIR, exist_ok=True)
    needs_proxy = ('wikipedia.org' in url) or ('wikimedia.org' in url) or ('netkeiba.com' in url)
    order = [True, False] if needs_proxy else [False, True]
    last_error = None
    for attempt in range(3):
        for use_proxy in order:
            try:
                with _opener(use_proxy).open(_request(url), timeout=timeout) as resp:
                    data = resp.read()
                with open(path, 'wb') as handle:
                    handle.write(data)
                return data if binary else data.decode('utf-8', 'replace')
            except pipeline_common.urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                    pipeline_common.time.sleep(2 + attempt * 4)
                    continue
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                continue
        pipeline_common.time.sleep(1 + attempt * 2)
    raise RuntimeError(repr(last_error))
