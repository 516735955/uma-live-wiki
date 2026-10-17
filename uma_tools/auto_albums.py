# -*- coding: utf-8 -*-
# auto_albums.py - 专辑自动维护（由 server.js 定时调用）
#   1) sync: 抓官网 microCMS 音乐商品 -> 未收录的新专辑登记为占位条目（品番/发售日/封面）
#   2) enrich: 对「已发售但还没曲目」的专辑，从网易云补全曲目/封面/专辑ID
# 用法: python uma_tools/auto_albums.py
import hashlib, json, os, re, sys, io, time, unicodedata, urllib.request, urllib.parse

if sys.version_info[0] == 2:
    sys.exit('requires python3')

if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
DATA_DIR = os.path.join(ROOT, 'data')
ALBUMS_JSON = os.path.join(DATA_DIR, 'albums.json')
STATE_JSON = os.path.join(DATA_DIR, 'auto_update', 'albums.json')
LOG_FILE = os.path.join(BASE, 'albums_auto.log')

MICROCMS_URL = 'https://6azuq3sitt-aw4monxblm4y4x0oos66.microcms.io/api/v1/goods'
MICROCMS_KEY = 'xCZfLPNnbazeFHih87prlh1pomFsB1LFq6qZ'
NO_IMAGE = 'https://tis9kp3e0c.user-space.cdn.idcfcloud.net/bc/images/common/no_image.jpg'
NETEASE_SEARCH = 'https://music.163.com/api/search/get/web'
NETEASE_ALBUM = 'https://music.163.com/api/album/'
METING = 'https://api.injahow.cn/meting/?server=netease&type=url&id='
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

MAX_ENRICH_PER_RUN = 6      # 每次运行最多补全几张（网易云限流）
RETRY_SKIP_HOURS = 12       # 同一张失败/空结果后，至少隔多久再试
SLEEP_AFTER_CALL = 1.0      # 网易云调用间隔（秒）


def stable_album_id(album):
    current = str(album.get('id') or '').strip()
    if current:
        return current
    catalog = re.sub(r'[^a-z0-9]+', '-', str(album.get('catalog') or '').lower()).strip('-')
    if catalog:
        return 'album-' + catalog
    title = re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(album.get('name') or '')).lower())
    return 'album-' + hashlib.sha1(title.encode('utf-8')).hexdigest()[:12]


def log(msg):
    line = '[%s] %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    print(line, flush=True)
    try:
        if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) >= 2 * 1024 * 1024:
            os.replace(LOG_FILE, LOG_FILE + '.1')
        with io.open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def http_json(url, headers, tries=3, sleep_base=4.0):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers)
            data = urllib.request.urlopen(req, timeout=25).read()
            j = json.loads(data.decode('utf-8', errors='replace'))
            code = j.get('code') if isinstance(j, dict) else None
            if code in (405, -462, 429):
                log('  rate-limit code=%s sleep %ss' % (code, sleep_base * (i + 1)))
                time.sleep(sleep_base * (i + 1))
                continue
            return j
        except Exception as e:
            log('  http err %r sleep' % (e,))
            time.sleep(sleep_base)
    return None


def norm(s):
    return re.sub(u'[‘’`\'"「」『』\\[\\]（）()・ー\u3000\\s]', '', str(s or '')).lower()


def norm_key(s):
    return re.sub(r'op主題歌|ed主題歌|【通常盤】|【bd付限定盤】|【bd版】',
                  '', norm(s), flags=re.I)


SERIES_PREFIXES = [
    u'TVアニメ『ウマ娘 プリティーダービー』',
    u'アニメ『ウマ娘 プリティーダービー』',
    u'『ウマ娘 プリティーダービー』',
    u'ウマ娘 プリティーダービー ',
]


def core_title_key(s):
    """核心键忽略系列前缀和盘种，保留季数及录音版本。"""
    t = s or ''
    for p in SERIES_PREFIXES:
        if t.startswith(p):
            t = t[len(p):]
            break
    t = norm_key(t)
    return t


def version_key(title):
    return re.findall(r'season\d+|(?:20\d\d)?remaster(?:ed)?(?:version)?|remix', norm(title))


def local_today():
    return time.strftime('%Y-%m-%d')


# ---------- 官网商品 ----------

def get_official_goods():
    items = []
    offset = 0
    limit = 100
    for _ in range(20):
        q = urllib.parse.urlencode({
            'limit': str(limit), 'offset': str(offset),
            'fields': 'id,title,image,html',
            'filters': 'category[equals]music'})
        j = http_json(MICROCMS_URL + '?' + q,
                      {'user-agent': UA, 'X-MICROCMS-API-KEY': MICROCMS_KEY}, tries=2, sleep_base=3.0)
        if not j:
            raise RuntimeError('official music goods request failed at offset %d' % offset)
        if not isinstance(j.get('contents'), list):
            raise ValueError('official music goods layout was not recognized')
        items.extend(j.get('contents') or [])
        total = j.get('totalCount')
        if isinstance(total, int) and len(items) >= total:
            return items
        if len(j['contents']) < limit:
            if isinstance(total, int) and len(items) < total:
                raise RuntimeError('official music goods ended before totalCount')
            return items
        offset += limit
    raise RuntimeError('official music goods exceeded 2000-item request budget; no partial import was saved')


def parse_goods_meta(html):
    catalog = None
    release = None
    company = None
    m = re.search(r'品番[:：]\s*([A-Za-z0-9\-_]+)', html)
    if m:
        catalog = m.group(1)
    m = re.search(r'発売日[:：]\s*(\d{4})年(\d{1,2})月(\d{1,2})日', html)
    if m:
        release = '%04d-%02d-%02d' % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r'発売元[:：]\s*([^<\n]+)', html)
    if m:
        raw = m.group(1).strip()
        company = 'Lantis' if u'バンダイナムコミュージックライブ' in raw or u'ランティス' in raw else raw
    return catalog, release, company


def infer_type(title):
    if u'サウンドトラック' in title or 'Soundtrack' in title or 'OST' in title:
        return u'原声带'
    if re.search(r'主題歌|(?:デジタル)?シングル|digital\s+single', title, re.I):
        return u'单曲'
    return u'专辑'


# ---------- 网易云 ----------

def search_queries(title):
    qs = [title]
    t2 = re.sub(r'[『』]', '', title).replace(u'ウマ娘 プリティーダービー', '').strip()
    if t2 and t2 != title:
        qs.append(t2)
    runs = re.findall(r'([A-Za-z][A-Za-z0-9 ]+)', title)
    for r in runs:
        r = re.sub(r'\s+', ' ', r).strip()
        if re.search(r'\d', r) and len(r) >= 4:
            qs.append(r)
    out = []
    for q in qs:
        q = q.strip()
        if q and q not in out:
            out.append(q)
    return out[:4]


def score_album(title, a_name):
    if version_key(title) != version_key(a_name):
        return 0
    if re.findall(r'\d+', unicodedata.normalize('NFKC', title)) != re.findall(r'\d+', unicodedata.normalize('NFKC', a_name)):
        return 0
    target = norm_key(title)
    s = norm_key(a_name)
    if target and s == target:
        return 100
    if len(target) >= 8 and len(s) >= 8 and (s in target or target in s):
        return 80
    return 0


def netease_search(title):
    for q in search_queries(title):
        j = http_json(NETEASE_SEARCH + '?' + urllib.parse.urlencode({'s': q, 'type': '10', 'limit': '8'}),
                      {'user-agent': UA, 'referer': 'https://music.163.com/'}, tries=2, sleep_base=3.0)
        if not isinstance(j, dict) or j.get('code', 200) != 200:
            raise RuntimeError('NetEase album search is temporarily unavailable')
        best = None
        best_score = 0
        best_ids = set()
        for a in (j.get('result') or {}).get('albums') or []:
            sc = score_album(title, a.get('name', ''))
            if sc > best_score:
                best_score = sc
                best = a
                best_ids = {a.get('id')}
            elif sc == best_score and sc > 0:
                best_ids.add(a.get('id'))
        if best and best_score >= 50 and len(best_ids) == 1:
            return best, best_score
        time.sleep(SLEEP_AFTER_CALL)
    return None, 0


def netease_detail(album_id):
    j = http_json(NETEASE_ALBUM + str(album_id),
                  {'user-agent': UA, 'referer': 'https://music.163.com/', 'cookie': 'appver=2.0.2'},
                  tries=4, sleep_base=6.0)
    alb = (j or {}).get('album') or {}
    if not isinstance(j, dict) or j.get('code', 200) != 200:
        raise RuntimeError('NetEase album detail is temporarily unavailable')
    tracks = alb.get('songs') or []
    if not tracks:
        return None
    return alb


def full_audio_ids(tracks):
    ids = [t.get('id') for t in tracks if t.get('id')]
    if not ids:
        return set()
    result = http_json('https://music.163.com/api/song/enhance/player/url?' +
                       urllib.parse.urlencode({'ids': json.dumps(ids), 'br': 320000}),
                       {'user-agent': UA, 'referer': 'https://music.163.com/'}, tries=2)
    durations = {t.get('id'): t.get('dt') or t.get('duration') or 0 for t in tracks}
    return {item.get('id') for item in (result or {}).get('data') or []
            if item.get('code') == 200 and item.get('url') and not item.get('freeTrialInfo')
            and durations.get(item.get('id'), 0) > 0
            and (item.get('time') or 0) >= durations[item.get('id')] - 2000}


def build_songs(tracks, cover):
    playable = full_audio_ids(tracks)
    out = []
    for t in tracks:
        arts = [a.get('name', '') for a in (t.get('ar') or t.get('artists') or [])]
        out.append({
            'name': t.get('name'),
            'artist': u'、'.join(a for a in arts if a),
            'url': METING + str(t.get('id')) if t.get('id') in playable else '',
            'pic': cover})
    return out


def enrich_entry(ent):
    before = json.dumps(ent, ensure_ascii=False, sort_keys=True)
    title = ent.get('name') or ''
    best, score = netease_search(title)
    time.sleep(SLEEP_AFTER_CALL)
    if not best:
        return 'no_match'
    alb = netease_detail(best.get('id'))
    if not alb:
        return 'no_match'
    tracks = alb.get('songs') or []
    cover = alb.get('picUrl') or alb.get('blurPicUrl') or ent.get('cover') or ''
    if not ent.get('count'):
        ent['count'] = str(len(tracks)) + u' 曲'
    if cover and not ent.get('cover'):
        ent['cover'] = cover
    if not ent.get('neteaseAlbumId'):
        ent['neteaseAlbumId'] = str(best.get('id'))
    incoming = build_songs(tracks, cover)
    if ent.get('songs'):
        by_name = {}
        for track in incoming:
            by_name.setdefault(norm_key(track['name']), []).append(track)
        for track in ent['songs']:
            matches = by_name.get(norm_key(track.get('name')), [])
            if len(matches) == 1 and not track.get('url') and matches[0].get('url'):
                track['url'] = matches[0]['url']
    else:
        ent['songs'] = incoming
    return 'changed' if before != json.dumps(ent, ensure_ascii=False, sort_keys=True) else 'unchanged'


# ---------- 主流程 ----------

def load_list(path):
    try:
        with io.open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def save_atomic(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def main():
    albums = load_list(ALBUMS_JSON)
    if not albums:
        log('albums.json 读取失败，终止')
        return 1

    state = load_list(STATE_JSON) or {}
    if not isinstance(state, dict):
        state = {}
    now_ts = time.time()

    log('== albums auto ==')
    changed = False
    existing = set(core_title_key(a.get('name', '')) for a in albums)
    catalogs = set(a.get('catalog') or '' for a in albums if a.get('catalog'))

    # 1) 官网新商品 -> 占位
    goods = get_official_goods()
    log('官网音乐商品: %d 个' % len(goods))
    added = 0
    tried = 0
    enriched = 0
    failures = []
    def attempt(entry):
        key = norm_key(entry.get('name', ''))
        try:
            result = enrich_entry(entry)
        except (OSError, ValueError, RuntimeError) as error:
            failures.append(key)
            state[key] = now_ts - RETRY_SKIP_HOURS * 3600 + 3600
            log('  补全来源失败，一小时后重试: ' + type(error).__name__)
            return 'error'
        state[key] = now_ts
        log('  补全结果: ' + result)
        return result
    for g in goods:
        title = (g.get('title') or '').strip()
        if not title:
            continue
        html = g.get('html') or ''
        catalog, release, company = parse_goods_meta(html)
        if core_title_key(title) in existing or (catalog and catalog in catalogs):
            continue
        html = g.get('html') or ''
        catalog, release, company = parse_goods_meta(html)
        img = (g.get('image') or {}).get('url') or NO_IMAGE
        entry = {
            'name': title,
            'count': '',
            'cover': img,
            'release': release or '',
            'company': company or '',
            'songs': [],
            'neteaseAlbumId': '',
            'catalog': catalog or '',
            'type': infer_type(title)}
        albums.append(entry)
        existing.add(core_title_key(title))
        if catalog:
            catalogs.add(catalog)
        added += 1
        log('新增占位: %s (%s)' % (title, release or '?'))
        # 已发售的新登记条目，马上补全
        if release and release <= local_today() and tried < MAX_ENRICH_PER_RUN:
            tried += 1
            if attempt(entry) == 'changed':
                enriched += 1
                log('  补全成功 -> %s 曲' % entry['count'])
            else:
                log('  网易云未匹配，稍后自动重试')
        changed = True
        time.sleep(SLEEP_AFTER_CALL)

    # 2) 已发售但未补全 -> 网易云补全
    for ent in sorted(albums, key=lambda row: float(state.get(norm_key(row.get('name', ''))) or 0)):
        if tried >= MAX_ENRICH_PER_RUN:
            break
        release = ent.get('release') or ''
        if not release or release > local_today():
            continue
        if ent.get('songs') and all(track.get('url') for track in ent['songs']):
            continue
        key = norm_key(ent.get('name', ''))
        last = state.get(key) or 0
        if isinstance(last, (int, float)) and now_ts - last < RETRY_SKIP_HOURS * 3600:
            continue
        tried += 1
        outcome = attempt(ent)
        if outcome == 'changed':
            enriched += 1
            log('补全: %s -> %s' % (ent.get('name'), ent['count']))
            changed = True
        else:
            log('未匹配网易云(稍后重试): %s' % ent.get('name'))

    save_atomic(STATE_JSON, state)

    for ent in albums:
        if not ent.get('id'):
            ent['id'] = stable_album_id(ent)
            changed = True

    if changed:
        save_atomic(ALBUMS_JSON, albums)
        log('已写入 albums.json | 新增 %d | 补全 %d | 共 %d 张' % (added, enriched, len(albums)))
    else:
        log('无变化 | 共 %d 张' % len(albums))
    return 1 if failures else 0


if __name__ == '__main__':
    import urllib.parse
    raise SystemExit(main())
