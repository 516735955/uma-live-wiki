"""Wikipedia responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import photos as pipeline_photos
from . import transport as pipeline_transport


def api_get(lang, params):
    host = 'commons.wikimedia.org' if lang == 'commons' else '%s.wikipedia.org' % lang
    url = 'https://%s/w/api.php?%s' % (host, pipeline_common.urllib.parse.urlencode(params))
    try:
        return pipeline_common.json.loads(pipeline_transport.http_get(url))
    except (ValueError, pipeline_common.json.JSONDecodeError):
        digest = pipeline_common.hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]
        path = pipeline_common.os.path.join(pipeline_common.CACHE_DIR, digest + '.txt')
        try:
            pipeline_common.os.unlink(path)
        except FileNotFoundError:
            pass
        raise RuntimeError('invalid Wikipedia API response')


def normalize_title(value):
    return pipeline_common.re.sub(r'[\s_（）()]', '', value or '').upper()


def page_score(lang, title):
    """2 = 明确赛马词条, 0 = 不确定, 1 = 明确非赛马（歌曲/游戏/消歧义等）。"""
    if not title:
        return 0
    if pipeline_common._NON_HORSE_TITLE.search(title):
        return 1
    try:
        wikitext = wiki_wikitext(lang, title) or ''
    except Exception:  # noqa: BLE001
        return 0
    if pipeline_common.re.search(r'\{\{\s*(?:曖昧さ回避|曖昧さ一覧|消歧义|消歧義|Disambig|Disambiguation)', wikitext, pipeline_common.re.I):
        return 1
    if pipeline_common.re.search(r'可以指[：:]', wikitext[:300]):
        return 1
    if pipeline_common._NON_HORSE_WIKI.search(wikitext):
        return 1
    if pipeline_common._RACEHORSE_MARK.search(wikitext):
        return 2
    return 0


def resolve_wikipedia(horse):
    """尝试在 zh / ja 两个维基找到对应词条，返回 (lang, title, info)。"""
    names = []
    for key in ('zh', 'ja'):
        value = horse.get(key)
        if value:
            names.append(value)
    seen = set()
    candidates = []
    for lang in ('zh', 'ja'):
        for name in names:
            base = normalize_title(name)
            if not base or (lang, base) in seen:
                continue
            if not pipeline_common.re.search(r'[\u4e00-\u9fff\u30a0-\u30ff]', name):
                continue
            seen.add((lang, base))
            # 带 (競走馬)/(赛马) 消歧后缀的标题优先于裸名（裸名常被歌曲/游戏占用）
            for suffix in (' (競走馬)', ' (赛马)', ' (賽馬)'):
                candidates.append((lang, name + suffix))
            candidates.append((lang, name))

    resolved = []
    for lang, title in candidates:
        data = api_get(lang, {
            'action': 'query', 'format': 'json', 'formatversion': '2',
            'redirects': '1', 'prop': 'info', 'titles': title,
        })
        page = data['query']['pages'][0]
        if 'missing' in page or 'invalid' in page:
            continue
        real = page.get('title') or title
        score = page_score(lang, real)
        if score == 2:
            return {'lang': lang, 'title': real}
        resolved.append({'lang': lang, 'title': real, 'score': score})
    # 优先明确赛马词条，其次不确定项；明确非赛马丢弃
    for target in (2, 0):
        for item in resolved:
            if item['score'] == target:
                return {'lang': item['lang'], 'title': item['title']}

    # 兜底：ja 维基全文搜索，要求命中名等于日文名（防子串误配歌曲标题）
    ja = horse.get('ja') or ''
    if ja:
        data = api_get('ja', {
            'action': 'query', 'format': 'json', 'formatversion': '2',
            'list': 'search', 'srsearch': ja, 'srlimit': '5',
        })
        expected = normalize_title(ja)
        for result in data['query']['search']:
            title = result['title']
            score = page_score('ja', title)
            if score == 1:
                continue
            # 仅接受与马名同名/消歧形式的命中
            if normalize_title(title) != expected and normalize_title(title) != expected + normalize_title('(競走馬)'):
                continue
            return {'lang': 'ja', 'title': title}
    return None


def wiki_pageinfo(lang, title):
    data = api_get(lang, {
        'action': 'query', 'format': 'json', 'formatversion': '2',
        'redirects': '1', 'prop': 'info|extracts|pageimages',
        'explaintext': '1', 'exlimit': '1', 'piprop': 'thumbnail|name',
        'pithumbsize': '420', 'titles': title,
    })
    page = data['query']['pages'][0]
    thumbnail = page.get('thumbnail') or {}
    photo = thumbnail.get('source') or ''
    page_title = page.get('title') or title
    extract = page.get('extract') or ''
    if not extract:
        extract = page.get('extract_html') or ''
    return {
        'title': page_title,
        'photo': pipeline_photos.clean_photo_url(photo),
        'extract': extract,
    }


def wiki_wikitext(lang, title):
    data = api_get(lang, {
        'action': 'query', 'format': 'json', 'formatversion': '2',
        'redirects': '1', 'prop': 'revisions',
        'rvprop': 'content', 'rvslots': 'main', 'titles': title,
    })
    page = data['query']['pages'][0]
    try:
        return page['revisions'][0]['slots']['main']['content']
    except (KeyError, IndexError):
        return ''
