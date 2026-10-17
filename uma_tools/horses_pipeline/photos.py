"""Photos responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import transport as pipeline_transport
from . import wikipedia as pipeline_wikipedia
from PIL import Image
import io


def valid_photo(source):
    try:
        with Image.open(source) as image:
            image.verify()
        return True
    except (OSError, ValueError):
        return False


def save_photo(path, data):
    if not valid_photo(io.BytesIO(data)):
        return False
    descriptor, temporary = pipeline_common.tempfile.mkstemp(prefix='.horse-photo-', dir=pipeline_common.os.path.dirname(path))
    try:
        with pipeline_common.os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
        pipeline_common.os.chmod(temporary, 0o644)
        pipeline_common.os.replace(temporary, path)
        return True
    finally:
        if pipeline_common.os.path.exists(temporary):
            pipeline_common.os.unlink(temporary)


def clean_photo_url(url):
    if not url:
        return ''
    url = pipeline_common.re.sub(r'\?.*$', '', url)
    return url


def _image_md5(path):
    with open(path, 'rb') as handle:
        return pipeline_common.hashlib.md5(handle.read()).hexdigest().upper()


def _photo_tokens(value):
    return [t for t in pipeline_common.re.split(r'[^0-9A-Za-z\u3040-\u30ff\u4e00-\u9fff]+', value or '') if t]


def _name_in_photo(name, filename):
    """马名须完整出现在文件名开头（拒绝 Twin Bee 飞机、Believe Guy 等同单词子串）。"""
    name_tokens = [t.lower() for t in _photo_tokens(name)]
    file_tokens = [t.lower() for t in _photo_tokens(filename.split(':', 1)[-1])]
    if not name_tokens or len(file_tokens) < len(name_tokens):
        return False
    return file_tokens[:len(name_tokens)] == name_tokens


def _usable_photo(name, file_title):
    base = file_title.split(':', 1)[-1]
    return (base.lower().endswith(pipeline_common._PHOTO_EXT)
            and not pipeline_common._NON_HORSE_PHOTO.search(base)
            and _name_in_photo(name, base))


def imageinfo_url(lang, title):
    """取 File: 标题的实际图片 URL（缩略宽度 800）。"""
    data = pipeline_wikipedia.api_get(lang, {
        'action': 'query', 'format': 'json', 'formatversion': '2',
        'redirects': '1', 'prop': 'imageinfo', 'iiprop': 'url|mime',
        'iiurlwidth': '800', 'titles': title,
    })
    page = data['query']['pages'][0]
    info = (page.get('imageinfo') or [{}])[0]
    return clean_photo_url(info.get('thumburl') or info.get('url') or '')


def photo_from_wikitext(lang, title, names):
    """词条 wikitext 里的图片（Infobox 图优先；正文图须文件名含马名）。"""
    try:
        wikitext = pipeline_wikipedia.wiki_wikitext(lang, title) or ''
    except Exception:  # noqa: BLE001
        return ''
    body_files = pipeline_common.re.findall(r'\[\[(?:ファイル|File|文件|文件):([^|\]]+)', wikitext)
    field = pipeline_common.re.search(r'\|\s*(?:image|画像)\s*=\s*([^|\]\n]+)', wikitext, pipeline_common.re.I)
    field_file = field.group(1).strip() if field else ''
    if field_file and not pipeline_common._NON_HORSE_PHOTO.search(field_file):
        try:
            url = imageinfo_url(lang, 'File:' + field_file)
        except Exception:  # noqa: BLE001
            url = ''
        if url:
            return url
    for name in body_files:
        name = name.strip()
        if not any(_usable_photo(n, name) for n in names):
            continue
        try:
            url = imageinfo_url(lang, 'File:' + name)
        except Exception:  # noqa: BLE001
            continue
        if url:
            return url
    return ''


def _url_matches(name, url):
    """校验图片 URL 文件名含马名（防 Commons 重定向到他人同名图）。"""
    if not name:
        return False
    decoded = pipeline_common.urllib.parse.unquote(url)
    filename = pipeline_common.urllib.parse.urlparse(decoded).path.rsplit('/', 1)[-1]
    filename = pipeline_common.re.sub(r'^\d+px-', '', filename)
    return _name_in_photo(name, filename)


def photo_from_commons(names):
    """Wikimedia Commons 文件名含马名（词边界）的图片。"""
    for name in names:
        if not name:
            continue
        try:
            data = pipeline_common.json.loads(pipeline_transport.http_get(
                'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2'
                '&list=search&srnamespace=6&srlimit=8&srsearch=' + pipeline_common.urllib.parse.quote(name)))
        except Exception:  # noqa: BLE001
            continue
        for hit in data.get('query', {}).get('search', []):
            file_title = hit.get('title') or ''
            if not _usable_photo(name, file_title):
                continue
            try:
                url = imageinfo_url('commons', file_title)
            except Exception:  # noqa: BLE001
                continue
            if url and (_url_matches(name, url) or any(_url_matches(n, url) for n in names)):
                return url
    return ''


def photo_from_netkeiba(record):
    """netkeiba show_photo.php（走代理）取头图并本地保存，返回站内路径。"""
    nk = record.get('netkeiba') or ''
    match = pipeline_common.re.search(r'/horse/([0-9a-z]+)', nk)
    if not match:
        return ''
    horse_id = match.group(1)
    local_name = '%s.jpg' % record['id']
    local_path = pipeline_common.os.path.join(pipeline_common.PHOTO_DIR, local_name)
    if pipeline_common.os.path.isfile(local_path) and pipeline_common.os.path.getsize(local_path) > 5000:
        if valid_photo(local_path) and _image_md5(local_path) not in pipeline_common._PLACEHOLDER_MD5:
            return '/uma_tools/img/horses/' + local_name
    nos = []
    try:
        page = pipeline_transport.http_get('https://db.netkeiba.com/horse/%s/' % horse_id)
        nos = sorted({int(n) for n in pipeline_common.re.findall(
            r'show_photo\.php\?[^"\'\s>]*?\bno=(\d+)', page)})
    except Exception:  # noqa: BLE001
        pass
    for no in nos[:6]:
        url = ('https://db.netkeiba.com/show_photo.php?horse_id=%s&no=%d&tn=yes&tmp=no'
               % (horse_id, no))
        try:
            data = pipeline_transport.http_get(url, binary=True)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(data, (bytes, bytearray)) or len(data) < 5000:
            continue
        if not (data.startswith(b'\xff\xd8') or data.startswith(b'\x89PNG')):
            continue
        if pipeline_common.hashlib.md5(data).hexdigest().upper() in pipeline_common._PLACEHOLDER_MD5:
            continue  # netkeiba 无图时的默认占位照
        pipeline_common.os.makedirs(pipeline_common.PHOTO_DIR, exist_ok=True)
        if save_photo(local_path, data):
            return '/uma_tools/img/horses/' + local_name
    return ''


def fill_missing_photo(record):
    """photo 为空时的补图链：netkeiba 档案照 → wikitext 图 → Commons，均需防误配校验。"""
    names = [n for n in (record.get('ja'), record.get('en')) if n]
    url = photo_from_netkeiba(record)
    if url:
        return url
    wiki = record.get('wiki') or {}
    lang = wiki.get('lang') or ''
    title = wiki.get(lang) if lang else ''
    # 词条必须确认是赛马主题才可取 wikitext 图（防歌曲/游戏误配取错封面）
    if title and pipeline_wikipedia.page_score(lang, title) == 2:
        url = photo_from_wikitext(lang, title, names)
        if url:
            return url
    return photo_from_commons(names)


def localize_photo(record):
    """把远端照片下载到本地 PHOTO_DIR，返回站内路径；失败返回 ''（防 wikimedia 国内不可达）。"""
    url = record.get('photo') or ''
    if not url or url.startswith('/uma_tools/'):
        return ''
    try:
        data = pipeline_transport.http_get(url, binary=True)
    except Exception:  # noqa: BLE001
        return ''
    if not isinstance(data, (bytes, bytearray)) or len(data) < 3000:
        return ''
    if pipeline_common.hashlib.md5(data).hexdigest().upper() in pipeline_common._PLACEHOLDER_MD5:
        return ''
    if data.startswith(b'\xff\xd8'):
        ext = '.jpg'
    elif data.startswith(b'\x89PNG'):
        ext = '.png'
    elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        ext = '.webp'
    else:
        return ''
    pipeline_common.os.makedirs(pipeline_common.PHOTO_DIR, exist_ok=True)
    local_name = '%s%s' % (record['id'], ext)
    if save_photo(pipeline_common.os.path.join(pipeline_common.PHOTO_DIR, local_name), data):
        return '/uma_tools/img/horses/' + local_name
    return ''
