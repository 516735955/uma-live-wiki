# -*- coding: utf-8 -*-
"""crawl_horses.py — 原型马数据爬取管线

从维护用血统源数据 pedigree_source.json 里导出全部「角色原型真实赛马」，
为每一匹抓取：
  - Wikipedia（zh 优先，找不到回退 ja）：信息框 (sire/dam/owner/trainer/record/
    earnings/出生/毛色…)、纯文正文分区（生涯 / 退役・繁育 / 血统 / 命名）、
    头图缩略图 URL、获胜名次（MedalGI/II/III）
  - JBIS（仅当源数据带有 jbis 链接时）：档案页（马主/生产牧场/调教师/厩舍/毛色/
    奖金/战绩）、年度别累计战绩表、主要成绩列表、马匹照片

产出两个浏览器数据文件：
  data/horses_list.js      window.HORSES   = [列表条目…]         （列表页用）
  data/horses_details.js   window.HORSES_DETAIL = {id: 详情}      （详情页用）

用法:
  python -X utf8 uma_tools/crawl_horses.py [--limit N] [--no-wiki] [--no-jbis]
"""
import hashlib
import html as html_lib
import io
import json
import os
import re
import socket
import sys
import tempfile
import time
import urllib.parse
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
DATA_DIR = os.path.join(ROOT, 'data')
PEDIGREE_SOURCE = os.path.join(DATA_DIR, 'pedigree_source.json')
OUT_LIST = os.path.join(DATA_DIR, 'horses_list.js')
OUT_DETAIL = os.path.join(DATA_DIR, 'horses_details.js')
CACHE_DIR = os.path.join(DATA_DIR, 'horses_cache')
LIST_PREFIX = 'window.HORSES = '
DETAIL_PREFIX = 'window.HORSES_DETAIL = '

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
PROXY = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or 'http://127.0.0.1:12000'
WIKI_SLEEP = 0.8
JBIS_SLEEP = 0.5


# ---------------------------------------------------------------- http ----

def _opener(use_proxy):
    if not use_proxy:
        return urllib.request.build_opener()
    handler = urllib.request.ProxyHandler({
        'http': PROXY,
        'https': PROXY,
    })
    return urllib.request.build_opener(handler)


def _request(url):
    return urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7',
    })


def http_get(url, binary=False, timeout=60):
    """带磁盘缓存、429/瞬断退避与代理回退的抓取。Wikipedia 域名走代理优先。"""
    digest = hashlib.sha1(url.encode('utf-8')).hexdigest()[:16]
    ext = '.bin' if binary else '.txt'
    path = os.path.join(CACHE_DIR, digest + ext)
    if os.path.isfile(path):
        with open(path, 'rb') as handle:
            data = handle.read()
        return data if binary else data.decode('utf-8', 'replace')
    os.makedirs(CACHE_DIR, exist_ok=True)
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
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(2 + attempt * 4)
                    continue
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                continue
        time.sleep(1 + attempt * 2)
    raise RuntimeError(repr(last_error))


# -------------------------------------------------------------- source ----

def load_pedigree_source():
    with open(PEDIGREE_SOURCE, encoding='utf-8') as handle:
        return json.load(handle)


def build_horses(source):
    by_id = {}
    for node in source.get('nodes') or []:
        node_id = node.get('id')
        if node_id:
            by_id[node_id] = node

    def canonical(node_id):
        seen = set()
        while node_id in by_id and by_id[node_id].get('alias_of'):
            node_id = by_id[node_id]['alias_of']
            if node_id in seen:
                break
            seen.add(node_id)
        return node_id

    horse_cids = {}
    for cid, mapping in (source.get('character_mappings') or {}).items():
        horse = mapping.get('horse')
        if not horse:
            continue
        check_kind = mapping.get('kind')
        if check_kind and check_kind != 'horse':
            continue
        hid = canonical(horse)
        if hid not in by_id:
            continue
        horse_cids.setdefault(hid, []).append(cid)

    rows = []
    for hid, cids in horse_cids.items():
        node = by_id[hid]
        sex = node.get('sex')
        born = node.get('born')
        if not sex or not born:
            continue  # 无性/无出生年 -> 训练员、工作人员等非马角色
        rows.append({
            'id': hid,
            'zh': node.get('zh') or '',
            'ja': node.get('ja') or '',
            'en': node.get('en') or '',
            'sex': sex,
            'born': born,
            'country': node.get('country') or '',
            'jbis': node.get('metadata_source_url') or '',
            'netkeiba': node.get('profile_url') or '',
            'cids': sorted(set(cids)),
        })
    rows.sort(key=lambda r: (born_sort(r['born']), r['ja'] or r['en'] or r['zh']))
    return rows


def born_sort(value):
    if isinstance(value, (int, float)):
        return int(value)
    digits = re.sub(r'\D', '', str(value))
    return int(digits) if digits else 999999


# -------------------------------------------------------------- wikipedia --

def api_get(lang, params):
    host = 'commons.wikimedia.org' if lang == 'commons' else '%s.wikipedia.org' % lang
    url = 'https://%s/w/api.php?%s' % (host, urllib.parse.urlencode(params))
    return json.loads(http_get(url))


def normalize_title(value):
    return re.sub(r'[\s_（）()]', '', value or '').upper()


# 非赛马词条的特征（歌曲/游戏/消歧义等误匹配）
_NON_HORSE_TITLE = re.compile(
    r'の曲|歌曲|のアルバム|アルバム|ゲーム|漫画|小説|映画|曖昧さ回避|曖昧さ一覧|一覧表'
)
_NON_HORSE_WIKI = re.compile(
    r'\[\[(?:Category|カテゴリ|分类|分類):[^\]]*(?:の曲|歌曲|ゲーム|ソフトウェア|楽曲|アルバム|映画|漫画|小説|曖昧さ)'
)
_RACEHORSE_MARK = re.compile(
    r'Infobox\s*(?:racehorse|horse)|競走馬インフォボックス'
    r'|\[\[(?:Category|カテゴリ|分类|分類):[^\]]*(?:競走馬|竞赛马|赛马|racehorse)'
    r'|戦績|重賞|GI競走|ダービー|オークス|有馬記念|天皇賞|战绩|一级赛|日本德比|日本打吡'
)


def page_score(lang, title):
    """2 = 明确赛马词条, 0 = 不确定, 1 = 明确非赛马（歌曲/游戏/消歧义等）。"""
    if not title:
        return 0
    if _NON_HORSE_TITLE.search(title):
        return 1
    try:
        wikitext = wiki_wikitext(lang, title) or ''
    except Exception:  # noqa: BLE001
        return 0
    if re.search(r'\{\{\s*(?:曖昧さ回避|曖昧さ一覧|消歧义|消歧義|Disambig|Disambiguation)', wikitext, re.I):
        return 1
    if re.search(r'可以指[：:]', wikitext[:300]):
        return 1
    if _NON_HORSE_WIKI.search(wikitext):
        return 1
    if _RACEHORSE_MARK.search(wikitext):
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
            if not re.search(r'[\u4e00-\u9fff\u30a0-\u30ff]', name):
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
        resolved.append({'lang': lang, 'title': real, 'score': page_score(lang, real)})
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
        'photo': clean_photo_url(photo),
        'extract': extract,
    }


def clean_photo_url(url):
    if not url:
        return ''
    url = re.sub(r'\?.*$', '', url)
    return url


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


# ------------------------------------------------------------- photos ----

PHOTO_DIR = os.path.join(TOOLS_DIR, 'img', 'horses')
_PHOTO_EXT = ('.jpg', '.jpeg', '.png', '.webp')
# 纪念物/非主体图特征（铜像/墓/勋章/logo 等不算马匹照片）
_NON_HORSE_PHOTO = re.compile(
    r'statue|tomb|grave|monument|memorial|bust|logo|crest|jockey|owner|pedigree|'
    r'requestpicture|nuvola|placeholder|question|wikipedia|commons|ambox|icon|\.svg|'
    r'墓|銅像|像$|記念|記章|ロゴ', re.I
)
# netkeiba 无图时的默认占位照
_PLACEHOLDER_MD5 = {'2A396AB5A03C93BDF76D222C157D3239'}


def _image_md5(path):
    with open(path, 'rb') as handle:
        return hashlib.md5(handle.read()).hexdigest().upper()


def _photo_tokens(value):
    return [t for t in re.split(r'[^0-9A-Za-z\u3040-\u30ff\u4e00-\u9fff]+', value or '') if t]


def _name_in_photo(name, filename):
    """马名须完整出现在文件名开头（拒绝 Twin Bee 飞机、Believe Guy 等同单词子串）。"""
    name_tokens = [t.lower() for t in _photo_tokens(name)]
    file_tokens = [t.lower() for t in _photo_tokens(filename.split(':', 1)[-1])]
    if not name_tokens or len(file_tokens) < len(name_tokens):
        return False
    return file_tokens[:len(name_tokens)] == name_tokens


def _usable_photo(name, file_title):
    base = file_title.split(':', 1)[-1]
    return (base.lower().endswith(_PHOTO_EXT)
            and not _NON_HORSE_PHOTO.search(base)
            and _name_in_photo(name, base))


def imageinfo_url(lang, title):
    """取 File: 标题的实际图片 URL（缩略宽度 800）。"""
    data = api_get(lang, {
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
        wikitext = wiki_wikitext(lang, title) or ''
    except Exception:  # noqa: BLE001
        return ''
    body_files = re.findall(r'\[\[(?:ファイル|File|文件|文件):([^|\]]+)', wikitext)
    field = re.search(r'\|\s*(?:image|画像)\s*=\s*([^|\]\n]+)', wikitext, re.I)
    field_file = field.group(1).strip() if field else ''
    if field_file and not _NON_HORSE_PHOTO.search(field_file):
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
    decoded = urllib.parse.unquote(url)
    return _name_in_photo(name, decoded)


def photo_from_commons(names):
    """Wikimedia Commons 文件名含马名（词边界）的图片。"""
    for name in names:
        if not name:
            continue
        try:
            data = json.loads(http_get(
                'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2'
                '&list=search&srnamespace=6&srlimit=8&srsearch=' + urllib.parse.quote(name)))
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
    match = re.search(r'/horse/([0-9a-z]+)', nk)
    if not match:
        return ''
    horse_id = match.group(1)
    local_name = '%s.jpg' % record['id']
    local_path = os.path.join(PHOTO_DIR, local_name)
    if os.path.isfile(local_path) and os.path.getsize(local_path) > 5000:
        if _image_md5(local_path) not in _PLACEHOLDER_MD5:
            return '/uma_tools/img/horses/' + local_name
    nos = []
    try:
        page = http_get('https://db.netkeiba.com/horse/%s/' % horse_id)
        nos = sorted({int(n) for n in re.findall(
            r'show_photo\.php\?[^"\'\s>]*?\bno=(\d+)', page)})
    except Exception:  # noqa: BLE001
        pass
    for no in nos[:6]:
        url = ('https://db.netkeiba.com/show_photo.php?horse_id=%s&no=%d&tn=yes&tmp=no'
               % (horse_id, no))
        try:
            data = http_get(url, binary=True)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(data, (bytes, bytearray)) or len(data) < 5000:
            continue
        if not (data.startswith(b'\xff\xd8') or data.startswith(b'\x89PNG')):
            continue
        if hashlib.md5(data).hexdigest().upper() in _PLACEHOLDER_MD5:
            continue  # netkeiba 无图时的默认占位照
        os.makedirs(PHOTO_DIR, exist_ok=True)
        with open(local_path, 'wb') as handle:
            handle.write(data)
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
    if title and page_score(lang, title) == 2:
        url = photo_from_wikitext(lang, title, names)
        if url:
            return url
    return photo_from_commons(names)


# ------------------------------------------------------------------ parse --

def strip_markup(text):
    text = re.sub(r'<ref[^>]*/>', '', text)
    text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.S)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    text = re.sub(r'&nbsp;', ' ', text)
    text = re.sub(r'&amp;', '&', text)
    # 国旗占位模板只保留代码
    text = re.sub(r'\{\{\s*flag\s*icon\s*\|\s*([^|{}]+?)\s*\}\}', r'\1', text)
    # 模板折叠：取第一个参数（表单名/链接文字），无参数则保留代码文字
    text = collapse_templates(text)
    text = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', text)
    text = re.sub(r"'''", '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def extract_template(wikitext, name):
    """在 wikitext 里按花括号配对取出指定模板全文（返回 None 表示未找到）。"""
    start = wikitext.find('{{' + name)
    if start == -1:
        return None
    pos = start + 2
    depth = 1
    while pos < len(wikitext):
        open_pos = wikitext.find('{{', pos)
        close_pos = wikitext.find('}}', pos)
        if close_pos == -1:
            break
        if open_pos != -1 and open_pos < close_pos:
            depth += 1
            pos = open_pos + 2
        else:
            depth -= 1
            pos = close_pos + 2
            if depth == 0:
                return wikitext[start:pos]
    return wikitext[start:]


def infobox_fields(wikitext):
    infobox = extract_template(wikitext, 'Infobox racehorse')
    if not infobox:
        return {}
    fields = {}
    for line in infobox.splitlines():
        match = re.match(r'\s*\|\s*([^=|]+?)\s*=\s*(.*)$', line)
        if match:
            fields[match.group(1).strip()] = match.group(2).strip()
    return fields


FIELD_ALIASES = {
    'sire': ('sire', '父'),
    'damsire': ('damsire', '母父'),
    'dam': ('dam', '母'),
    'sex': ('sex', '性別', '性别'),
    'foaled': ('foaled', '生年月日', '诞生', '诞辰'),
    'death': ('death_date', '死没', '死亡'),
    'colour': ('colour', '毛色'),
    'breeder': ('breeder', '生産者', '繁殖者', '生产牧场', '生產者'),
    'farm': ('生産牧場', '生產牧場'),
    'owner': ('owner', '馬主', '马主'),
    'trainer': ('trainer', '調教師', '调教师'),
    'stable': ('厩舎', '厩舍'),
    'record': ('record', '戦績', '戰績', '战绩', '通算成績', '通算成绩'),
    'earnings': ('earnings', '獲得賞金', '獲得獎金', '总奖金', '總獎金'),
    'country': ('country', '生産国', '产地', '產地'),
    'origin': ('馬名の由来', '馬名由来', '由來', '由来', '命名'),
}


def field_match(fields, aliases):
    for alias in aliases:
        if alias in fields and fields[alias].strip():
            return strip_markup(fields[alias])
    return ''


def valid_date(value):
    """日期字段须含 4 位年份，滤掉 p=0 等解析杂串与 JBIS 龄数后缀。"""
    text = strip_markup(value or '')
    if not re.search(r'\d{4}', text):
        return ''
    return re.sub(r'\s*\(?\d+歳\)?\s*$', '', text).strip()


def split_top_level(text, separator='|'):
    """按顶层分隔符切分（避开 {{...}} 内层）。"""
    parts = []
    depth = 0
    current = []
    for char in text:
        if char == '{':
            depth += 1
            current.append(char)
        elif char == '}':
            depth -= 1
            current.append(char)
        elif char == separator and depth == 0:
            parts.append(''.join(current).strip())
            current = []
        else:
            current.append(char)
    parts.append(''.join(current).strip())
    return parts


def collapse_templates(text):
    """反复把最内层 {{...}} 折叠为其第一个参数。"""
    for _ in range(6):
        changed = re.sub(r'\{\{[^{}]*\}\}', _collapse_simple, text)
        if changed == text:
            break
        text = changed
    return text


def _collapse_simple(match):
    inner = match.group(0)[2:-2]
    if '|' in inner:
        return inner.split('|', 1)[1].split('|', 1)[0].strip()
    return inner.strip()


def template_span(text, start):
    """返回从 start 处 `{{` 开始的配对模板全文。"""
    depth = 0
    pos = start
    while pos < len(text):
        if text.startswith('{{', pos):
            depth += 1
            pos += 2
        elif text.startswith('}}', pos):
            depth -= 1
            pos += 2
            if depth == 0:
                return text[start:pos]
        else:
            pos += 1
    return text[start:]


def parse_medals(infobox):
    wins = []
    for grade, tag in (
        ('G1', 'MedalGI'), ('G2', 'MedalGII'), ('G3', 'MedalGIII'),
        ('G1', 'MedalI'), ('G2', 'MedalII'), ('G3', 'MedalIII'),
    ):
        for match in re.finditer(r'\{\{\s*%s\b' % tag, infobox):
            full = template_span(infobox, match.start())
            inner = full[len(match.group(0)):]
            if inner.rstrip().endswith('}}'):
                inner = inner.rstrip()[:-2]
            params = split_top_level(inner)
            race = strip_markup(params[1] if len(params) > 1 else '')
            year = strip_markup(params[2] if len(params) > 2 else '')
            wins.append({'grade': grade, 'race': race, 'year': year})
    seen, out = set(), []
    for win in wins:
        key = (win['grade'], win['race'])
        if key in seen:
            continue
        seen.add(key)
        out.append(win)
    return out


def split_extract_sections(extract):
    sections = {}
    current = ''
    for line in extract.splitlines():
        match = re.match(r'^(=+)\s*(.*?)\s*\1\s*$', line.strip())
        if match:
            current = match.group(2).strip()
            sections[current] = sections.get(current, [])
        elif line.strip():
            parts = sections.setdefault(current, [])
            parts.append(line.strip())
    return sections


def bucket_for_header(header, patterns):
    for bucket, needles in patterns.items():
        for needle in needles:
            if needle in header:
                return bucket
    return None


ZH_PATTERNS = {
    'career': ('出賽前', '出生', '出道', '競賽生涯', '競賽', '戰績', '競走', '赛前'),
    'retirement': ('退役', '引退', '功労', '功劳', '種牡馬', '种马', '晩年', '晚年',
                   '纪念', '紀念', '表彰', '後世', '后世纪念'),
    'breeding': ('子嗣', '産駒', '产驹', '後代', '后代', '愛駒', '爱驹', '血脈'),
    'blood': ('血統', '血统', '家族', '牝系', '母系', '祖先'),
    'origins': ('命名', '由來', '由来', '馬名的由來', '马名的由来'),
}
JA_PATTERNS = {
    'career': ('生い立ち', '戦績', '競走', 'デビュー', '現役'),
    'retirement': ('引退', '種牡馬', '功労', '晩年', '記念', '没後', '死亡', '表彰'),
    'breeding': ('産駒', '子孫', '繁殖'),
    'blood': ('血統', '家系'),
    'origins': ('馬名の由来', '由来'),
}
SKIP_HEADERS = ('相關條目', '相关条目', '參考資料', '参考资料', '外部連結', '外部链接',
                '註釋', '注释', '脚注', '注釈', '出典', '参考文献')

P = {
    'INTRODUCTION', 'career', 'retirement', 'breeding', 'blood', 'origins'
}


def collect_paragraphs(sections, patterns):
    result = {'intro': [], 'career': [], 'retirement': [], 'breeding': [],
              'blood': [], 'origins': []}
    for header, paragraphs in sections.items():
        if header and any(skip in header for skip in SKIP_HEADERS):
            continue
        if not header:
            result['intro'].extend(paragraphs)
            continue
        bucket = bucket_for_header(header, patterns)
        if bucket:
            result[bucket].extend(paragraphs)
    return result


def trim_paragraphs(items, limit, width):
    out = []
    for item in items:
        if len(out) >= limit:
            break
        text = item.strip()
        if len(text) < 8:
            continue
        if len(text) > width:
            text = text[:width].rstrip() + '…'
        out.append(text)
    return out


# ------------------------------------------------------------------- jbis --

def search_jbis_url(name, born=''):
    """按马名在 JBIS 搜索马档案页，返回 URL；找不到返回 ''。
    同名多匹时按档案页生年月日与 born 年份消歧。"""
    if not name:
        return ''
    want_year = re.sub(r'\D', '', str(born or ''))[:4]
    for mode in ('exact', 'prefix'):
        url = ('https://www.jbis.or.jp/horse/result/?sid=horse&match=%s&keyword=%s'
               % (mode, urllib.parse.quote(name)))
        try:
            html = http_get(url)
        except Exception:  # noqa: BLE001
            continue
        ids = []
        prefix_id = ''
        # 卡片标题链接 class 精确为 txt-link（父母行是 txt-link txt-overflow，不匹配）
        for match in re.finditer(r'<a href="(/horse/([0-9a-f]+)/)" class="txt-link">([^<]+)</a>', html):
            label = html_lib.unescape(match.group(3)).strip()
            base = re.sub(r'\([^)]*\)\s*$', '', label).strip()
            hid = match.group(2)
            if label == name or base == name:
                if hid not in ids:
                    ids.append(hid)
            elif mode == 'prefix' and not prefix_id and (base.startswith(name) or name.startswith(base)):
                prefix_id = hid
        if not ids and prefix_id:
            ids = [prefix_id]
        if not ids:
            continue
        if len(ids) == 1 or not want_year:
            return 'https://www.jbis.or.jp/horse/%s/' % ids[0]
        # 同名多匹：按生年消歧
        for hid in ids:
            try:
                page = http_get('https://www.jbis.or.jp/horse/%s/' % hid)
                m = re.search(r'生年月日</dt>\s*<dd[^>]*>([^<]+)', page)
                birth = html_lib.unescape(m.group(1)).strip() if m else ''
            except Exception:  # noqa: BLE001
                continue
            if want_year in re.sub(r'\D', '', birth):
                return 'https://www.jbis.or.jp/horse/%s/' % hid
        return 'https://www.jbis.or.jp/horse/%s/' % ids[0]
    return ''


def parse_tables(html_text):
    """从 JBIS 档案页提取档案字段 / 表彰 / 年度累计 / 主要成绩。
    表格区块用摊平文本解析（JBIS 行结构与嵌套 div 不稳定）。
    返回 dict；解析失败时返回空结构。"""
    data = {'profile': {}, 'awards': [], 'yearly': [], 'major': [],
            'pedigree': [], 'photo': ''}
    photo_match = re.search(r'/horse/images/([0-9a-f]+_\d)/', html_text)
    if photo_match:
        data['photo'] = 'https://www.jbis.or.jp/horse/images/%s/' % photo_match.group(1)

    # --- 血统（父 / 母 及祖）---
    pedigree_block = None
    m = re.search(r'<h2>血統情報</h2>(.*?)<h2>プロフィール</h2>', html_text, re.S)
    if m:
        pedigree_block = m.group(1)
    if pedigree_block:
        for match in re.finditer(
            r'<a href="(/horse/[0-9a-f]+/)" class="txt-link">([^<]+)</a>',
            pedigree_block,
        ):
            data['pedigree'].append({
                'ja': html_lib.unescape(match.group(2)).strip(),
                'url': 'https://www.jbis.or.jp' + match.group(1),
            })

    # --- 档案 dl（第一个 data-4-1）---
    first_dl = re.search(r'<dl class="data-4-1">(.*?)</dl>', html_text, re.S)
    if first_dl:
        block = first_dl.group(1)
        for match in re.finditer(
            r'<dt>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>', block, re.S
        ):
            key = strip_tags(match.group(1))
            value = strip_tags(match.group(2))
            if key and value:
                data['profile'][key] = value

    # --- 表彰（后续 data-4-1）---
    for dl_match in re.finditer(r'<dl class="data-4-1">(.*?)</dl>', html_text, re.S):
        block = dl_match.group(1)
        if re.search(r'<dt>\d{4}年度</dt>', block):
            for match in re.finditer(r'<dt>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>', block, re.S):
                year = strip_tags(match.group(1))
                title = strip_tags(match.group(2))
                if year and title:
                    data['awards'].append({'year': year.replace('年度', ''), 'title': title})

    # --- 年度别累计（token 流状态机重建行）---
    # JBIS 每个单元格一个 <div>，摊平后一行一个 cell；以年份/合計行触发新行。
    yearly_seg = re.search(r'年度別累計成績</h2>(.*?)(?:SSI|主な成績|</main>)', html_text, re.S)
    if yearly_seg:
        section = ''
        current = None
        pending = []
        for line in plain_lines(yearly_seg.group(1)):
            if line in ('中央', '地方', '海外'):
                section = line
                continue
            if re.fullmatch(r'\d{4}', line) or line in ('合計', '通算'):
                if current is not None:
                    pending.append(current)
                current = {'year': line, 'section': section, 'cell': []}
                continue
            if current is not None and line not in (
                '年', '出走', '回数', '1着', '2着', '3着', '着外', '賞金', '開催場所',
            ):
                current['cell'].append(line)
        if current is not None:
            pending.append(current)
        for row in pending:
            ints = []
            rest = []
            for cell in row['cell']:
                if re.fullmatch(r'\d+', cell):
                    ints.append(cell)
                else:
                    rest.append(cell)
                if len(ints) > 5:
                    break
            earnings = next((t for t in rest if '円' in t), '')
            venue = [t for t in rest if t != earnings]
            if row['section']:
                venue.insert(0, row['section'])
            data['yearly'].append({
                'year': row['year'],
                'starts': ints[0] if len(ints) > 0 else '',
                'wins': ints[1] if len(ints) > 1 else '',
                'seconds': ints[2] if len(ints) > 2 else '',
                'thirds': ints[3] if len(ints) > 3 else '',
                'unplaced': ints[4] if len(ints) > 4 else '',
                'earnings': earnings,
                'venue': ' '.join(venue),
            })

    # --- 主要成绩（按日期行切分重建）---
    major_seg = re.search(r'主な成績</h2>(.*?)(?:<footer|トップへ|</main>)', html_text, re.S)
    if major_seg:
        rows = []
        current = None
        for line in plain_lines(major_seg.group(1)):
            if re.fullmatch(r'\d{4}\.\d\d\.\d\d', line):
                if current is not None:
                    rows.append(current)
                current = [line]
            elif current is not None:
                current.append(line)
        if current is not None:
            rows.append(current)
        for parts in rows:
            tokens = parts
            try:
                place_index = next(i for i, token in enumerate(tokens) if re.fullmatch(r'\d+', token))
            except StopIteration:
                continue
            grade_token = tokens[place_index - 1] if place_index - 1 >= 2 else ''
            race = ' '.join(tokens[2:max(2, place_index - 1)])
            if not race and grade_token and not _grade_like(grade_token):
                race = grade_token
                grade_token = ''
            place = int(tokens[place_index])
            tail = tokens[place_index + 1:]
            surface = tail[0] if tail else ''
            distance = tail[1] if len(tail) > 1 else ''
            beaten = ' '.join(tail[2:]).split(' ※')[0].strip()
            grade = ''
            for grade_idx, chars in (
                (1, ('Ⅰ', '１', '1')), (2, ('Ⅱ', '２', '2')), (3, ('Ⅲ', '３', '3')),
            ):
                if 'G' in grade_token and any(ch in grade_token for ch in chars):
                    grade = 'G%d' % grade_idx
                    break
            data['major'].append({
                'date': tokens[0],
                'track': tokens[1],
                'race': race,
                'grade': grade,
                'place': place,
                'surface': surface,
                'distance': distance,
                'beaten': beaten,
            })
    return data


def _grade_like(token):
    """判断 JBIS 战绩行里隔位处是否像比赛格付（G1/G2/G3/OP/L 等），而非赛事名。"""
    text = str(token or '').replace('Ｇ', 'G').replace('Ⅰ', 'I').replace('Ⅱ', 'II').replace('Ⅲ', 'III').replace('３', '3').replace('２', '2').replace('１', '1')
    return bool(re.search(r'\bG\s*I{1,3}\b|\bG[123]\b|\bOP\b|\bL\b|重賞', text))


def strip_tags(value):
    return re.sub(r'\s+', ' ', html_lib.unescape(re.sub(r'<[^>]+>', '', value or ''))).strip()


def plain_lines(html_text):
    """摊平为保留换行结构的纯文本行列表。"""
    text = re.sub(r'<(?:/div|/tr|/li|/dd|/dt|br|/table)[^>]*>', '\n', html_text)
    text = re.sub(r'<[^>]+>', '', text)
    text = html_lib.unescape(text)
    return [line.strip() for line in text.splitlines() if line.strip()]


# --------------------------------------------------------------- main ----

def fetch_horse(horse, use_wiki=True, use_jbis=True):
    record = {
        'id': horse['id'],
        'zh': horse['zh'],
        'ja': horse['ja'],
        'en': horse['en'],
        'sex': horse['sex'],
        'born': horse['born'],
        'country': horse['country'],
        'cids': horse['cids'],
        'jbis': horse['jbis'] or '',
        'netkeiba': horse['netkeiba'] or '',
        'photo': '',
        'birthdate': '',
        'colour': '',
        'death': '',
        'family': {},
        'facts': {},
        'wins': [],
        'yearly': [],
        'major': [],
        'awards': [],
        'career': [],
        'retirement': [],
        'breeding': [],
        'blood': [],
        'origins': [],
        'intro': '',
        'sources': [],
    }
    if horse['netkeiba'] and 'netkeiba.com' in horse['netkeiba']:
        record['sources'].append({'label': 'netkeiba', 'url': horse['netkeiba']})

    # ---- Wikipedia ----
    wiki = None
    if use_wiki:
        time.sleep(WIKI_SLEEP)
        wiki = resolve_wikipedia(horse)
    if wiki:
        lang, title = wiki['lang'], wiki['title']
        try:
            info = wiki_pageinfo(lang, title)
        except Exception as exc:  # noqa: BLE001
            info = {'title': title, 'photo': '', 'extract': ''}
            print('  [wiki info fail] %s %s' % (horse['id'], exc))
        time.sleep(WIKI_SLEEP)
        wikitext = wiki_wikitext(lang, title) if use_wiki else ''
        # wiki 首图须像马匹照片（拒绝求图占位/马主纹章/logo 等；只查文件名防误伤 wikimedia 域名）
        photo_name = urllib.parse.unquote((info['photo'] or '').split('/')[-1])
        if info['photo'] and not _NON_HORSE_PHOTO.search(photo_name):
            record['photo'] = info['photo']
        record['wiki'] = {'lang': lang, 'zh': title if lang == 'zh' else '',
                          'ja': title if lang == 'ja' else ''}
        record['sources'].append({
            'label': 'wikipedia', 'url': 'https://%s.wikipedia.org/wiki/%s' % (
                lang, urllib.parse.quote(title)),
        })

        fields = infobox_fields(wikitext) if wikitext else {}
        record['facts']['sire'] = field_match(fields, FIELD_ALIASES['sire'])
        record['facts']['dam'] = field_match(fields, FIELD_ALIASES['dam'])
        record['facts']['damsire'] = field_match(fields, FIELD_ALIASES['damsire'])
        record['facts']['sex'] = field_match(fields, FIELD_ALIASES['sex'])
        if not record.get('birthdate'):
            record['birthdate'] = valid_date(field_match(fields, FIELD_ALIASES['foaled']))
        record['death'] = field_match(fields, FIELD_ALIASES['death'])
        record['colour'] = field_match(fields, FIELD_ALIASES['colour'])
        record['facts']['owner'] = field_match(fields, FIELD_ALIASES['owner'])
        record['facts']['breeder'] = field_match(fields, FIELD_ALIASES['breeder'])
        record['facts']['farm'] = field_match(fields, FIELD_ALIASES['farm'])
        record['facts']['trainer'] = field_match(fields, FIELD_ALIASES['trainer'])
        record['facts']['stable'] = field_match(fields, FIELD_ALIASES['stable'])
        record['facts']['record'] = field_match(fields, FIELD_ALIASES['record'])
        record['facts']['earnings'] = field_match(fields, FIELD_ALIASES['earnings'])
        record['origins'] = [field_match(fields, FIELD_ALIASES['origin'])] if field_match(fields, FIELD_ALIASES['origin']) else []
        infobox = extract_template(wikitext, 'Infobox racehorse') if wikitext else None
        if infobox:
            record['wins'] = parse_medals(infobox)

        paragraphs = collect_paragraphs(
            split_extract_sections(info['extract']),
            JA_PATTERNS if lang == 'ja' else ZH_PATTERNS,
        )
        record['intro'] = trim_paragraphs(paragraphs['intro'], 2, 320)
        record['career'] = trim_paragraphs(paragraphs['career'], 14, 500)
        record['retirement'] = trim_paragraphs(paragraphs['retirement'], 10, 420)
        record['breeding'] = trim_paragraphs(paragraphs['breeding'], 8, 420)
        record['blood'] = trim_paragraphs(paragraphs['blood'], 8, 420)

    # ---- JBIS ----
    if use_jbis and not (record['jbis'] and 'jbis.or.jp' in record['jbis']):
        jbis_url = (search_jbis_url(record['ja'], record['born'])
                    or search_jbis_url(record['en'], record['born']))
        if jbis_url:
            record['jbis'] = jbis_url
            print('  [jbis found] %s %s' % (horse['id'], jbis_url))
    if use_jbis and record['jbis'] and 'jbis.or.jp' in record['jbis']:
        try:
            time.sleep(JBIS_SLEEP)
            page = http_get(record['jbis'])
            parsed = parse_tables(page)
        except Exception as exc:  # noqa: BLE001
            print('  [jbis fail] %s %s' % (horse['id'], exc))
            parsed = {}
        if parsed:
            if parsed.get('photo') and not record['photo']:
                record['photo'] = parsed['photo']
            profile = parsed.get('profile') or {}
            facts = record['facts']
            facts['registration'] = profile.get('登録', '')
            if not facts.get('owner'):
                facts['owner'] = profile.get('馬主', '')
            if not facts.get('breeder'):
                facts['breeder'] = profile.get('生産牧場', '')
            if not facts.get('trainer'):
                facts['trainer'] = profile.get('調教師', '')
            if not facts.get('stable'):
                trainer_text = profile.get('調教師', '')
                stable_match = re.search(r'\((.*)\)$', trainer_text)
                if stable_match:
                    facts['stable'] = stable_match.group(1).strip()
            if not facts.get('record'):
                facts['record'] = profile.get('戦績', '')
            if not facts.get('earnings'):
                facts['earnings'] = profile.get('総賞金', '')
            if not record.get('birthdate'):
                record['birthdate'] = valid_date(profile.get('生年月日', ''))
            if not record.get('colour'):
                record['colour'] = profile.get('毛色', '')
            if not facts.get('country'):
                facts['country'] = profile.get('産地', '')
            record['yearly'] = parsed.get('yearly') or record['yearly']
            record['major'] = parsed.get('major') or record['major']
            record['awards'] = parsed.get('awards') or record['awards']
            record['jbis_pedigree'] = parsed.get('pedigree') or []
    if not record['photo']:
        record['photo'] = fill_missing_photo(record)
    # 生年终检：birthdate 年份与源数据 born 冲突时丢弃（防同名 JBIS 错配日期）
    born_year = re.sub(r'\D', '', str(record.get('born') or ''))[:4]
    birth_year = re.sub(r'\D', '', str(record.get('birthdate') or ''))[:4]
    if born_year and birth_year and born_year != birth_year:
        print('  [birth year mismatch] %s born=%s bd=%s -> drop bd' % (
            record['id'], record.get('born'), record.get('birthdate')))
        record['birthdate'] = ''
    return record


def serialize(prefix, payload):
    return prefix + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"


def atomic_write(path, content):
    directory = os.path.dirname(path)
    fd, temp_path = tempfile.mkstemp(prefix='.horses-', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as handle:
            handle.write(content)
        os.replace(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0, help='只跑前 N 匹用于调试')
    parser.add_argument('--no-wiki', action='store_true', help='跳过 Wikipedia 抓取')
    parser.add_argument('--no-jbis', action='store_true', help='跳过 JBIS 抓取')
    parser.add_argument('--resume', action='store_true', help='跳过已有详情缓存的马')
    parser.add_argument('--photos-only', action='store_true',
                        help='只给缺图的马补 photo 字段（不重抓正文）')
    args = parser.parse_args()

    source = load_pedigree_source()
    horses = build_horses(source)
    print('原型马总数: %d' % len(horses))
    if args.limit:
        horses = horses[:args.limit]

    total = len(horses)
    list_rows = []
    details = {}
    for index, horse in enumerate(horses, 1):
        done_path = os.path.join(CACHE_DIR, 'detail_%s.json' % horse['id'])
        if args.photos_only:
            if not os.path.isfile(done_path):
                continue
            with open(done_path, encoding='utf-8') as handle:
                record = json.load(handle)
            if record.get('photo'):
                details[horse['id']] = record
                list_rows.append({
                    'id': record['id'], 'zh': record['zh'], 'ja': record['ja'],
                    'en': record['en'], 'sex': record['sex'], 'born': record['born'],
                    'country': record['country'],
                    'birthdate': record.get('birthdate', ''),
                    'photo': record.get('photo', ''),
                    'cids': record.get('cids', []),
                })
                continue
            photo = fill_missing_photo(record)
            if photo:
                record['photo'] = photo
                with open(done_path, 'w', encoding='utf-8') as handle:
                    json.dump(record, handle, ensure_ascii=False)
                print('[photo] %s -> %s' % (horse['id'], photo))
            else:
                print('[photo miss] %s' % horse['id'])
        elif args.resume and os.path.isfile(done_path):
            with open(done_path, encoding='utf-8') as handle:
                record = json.load(handle)
        else:
            record = fetch_horse(horse, use_wiki=not args.no_wiki,
                                 use_jbis=not args.no_jbis)
            os.makedirs(CACHE_DIR, exist_ok=True)
            with open(done_path, 'w', encoding='utf-8') as handle:
                json.dump(record, handle, ensure_ascii=False)
        details[horse['id']] = record
        list_rows.append({
            'id': horse['id'],
            'zh': record['zh'],
            'ja': record['ja'],
            'en': record['en'],
            'sex': record['sex'],
            'born': record['born'],
            'country': record['country'],
            'birthdate': record.get('birthdate', ''),
            'photo': record.get('photo', ''),
            'cids': record.get('cids', []),
        })
        print('[%d/%d] %s %s %s wiki=%s jbis=%s photo=%s' % (
            index, total, horse['id'], record['ja'], record['zh'],
            'yes' if record.get('wiki') else 'no',
            'yes' if record['jbis'] else 'no',
            'yes' if record['photo'] else 'no',
        ))
        if index % 10 == 0:
            print('  ...complete %d/%d' % (index, total))

    atomic_write(OUT_LIST, serialize(LIST_PREFIX, list_rows))
    atomic_write(OUT_DETAIL, serialize(DETAIL_PREFIX, details))
    print('wrote %s' % os.path.relpath(OUT_LIST, ROOT))
    print('wrote %s' % os.path.relpath(OUT_DETAIL, ROOT))


if __name__ == '__main__':
    main()