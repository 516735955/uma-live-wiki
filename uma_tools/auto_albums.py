# -*- coding: utf-8 -*-
# auto_albums.py - 专辑自动维护（由 server.js 定时调用）
#   1) sync: 抓官网 microCMS 音乐商品 -> 未收录的新专辑登记为占位条目（品番/发售日/封面）
#   2) enrich: 对「已发售但还没曲目」的专辑，从网易云补全曲目/封面/专辑ID
# 用法: python uma_tools/auto_albums.py
import json, os, re, sys, io, time, urllib.request

if sys.version_info[0] == 2:
    sys.exit('requires python3')

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
ALBUMS_JSON = os.path.join(ROOT, 'albums.json')
STATE_JSON = os.path.join(BASE, 'albums_auto_state.json')
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


def log(msg):
    line = '[%s] %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    print(line, flush=True)
    try:
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
    return re.sub(r'20\d\d\s*remastered\s*version|remastered\s*version|op主題歌|ed主題歌|【通常盤】|【bd付限定盤】|【bd版】|remix|season\d+',
                  '', norm(s), flags=re.I)


SERIES_PREFIXES = [
    u'TVアニメ『ウマ娘 プリティーダービー』',
    u'アニメ『ウマ娘 プリティーダービー』',
    u'『ウマ娘 プリティーダービー』',
    u'ウマ娘 プリティーダービー ',
]


def core_title_key(s):
    """标题归一化作‘核心键’，忽略系列前缀/盘种/remaster 后缀差异，用于去重比较"""
    t = s or ''
    for p in SERIES_PREFIXES:
        if t.startswith(p):
            t = t[len(p):]
            break
    t = norm_key(t)
    t = re.sub(r'20\d\dremaster($|edversion$)|remaster$', '', t)
    return t


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
            break
        items.extend(j.get('contents') or [])
        if not j.get('contents') or len(j.get('contents')) < limit or len(items) >= (j.get('totalCount') or 0):
            break
        offset += limit
    return items


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
    if u'主題歌' in title:
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
        if not j:
            continue
        best = None
        best_score = 0
        for a in (j.get('result') or {}).get('albums') or []:
            sc = score_album(title, a.get('name', ''))
            if sc > best_score:
                best_score = sc
                best = a
        if best and best_score >= 50:
            return best, best_score
        time.sleep(SLEEP_AFTER_CALL)
    return None, 0


def netease_detail(album_id):
    j = http_json(NETEASE_ALBUM + str(album_id),
                  {'user-agent': UA, 'referer': 'https://music.163.com/', 'cookie': 'appver=2.0.2'},
                  tries=4, sleep_base=6.0)
    alb = (j or {}).get('album') or {}
    tracks = alb.get('songs') or []
    if not tracks:
        return None
    return alb


def build_songs(tracks, cover):
    out = []
    for t in tracks:
        arts = [a.get('name', '') for a in (t.get('ar') or t.get('artists') or [])]
        out.append({
            'name': t.get('name'),
            'artist': u'、'.join(a for a in arts if a),
            'url': METING + str(t.get('id')),
            'pic': cover})
    return out


def enrich_entry(ent):
    title = ent.get('name') or ''
    best, score = netease_search(title)
    time.sleep(SLEEP_AFTER_CALL)
    if not best:
        return False
    alb = netease_detail(best.get('id'))
    if not alb:
        return False
    tracks = alb.get('songs') or []
    cover = alb.get('picUrl') or alb.get('blurPicUrl') or ent.get('cover') or ''
    ent['count'] = str(len(tracks)) + u' 曲'
    if cover:
        ent['cover'] = cover
    ent['neteaseAlbumId'] = str(best.get('id'))
    ent['songs'] = build_songs(tracks, cover)
    return True


# ---------- 主流程 ----------

def load_list(path):
    try:
        with io.open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def save_atomic(path, obj):
    tmp = path + '.tmp'
    with io.open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def main():
    albums = load_list(ALBUMS_JSON)
    if not albums:
        log('albums.json 读取失败，终止')
        return

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
        if release and release <= local_today() and added <= MAX_ENRICH_PER_RUN:
            if enrich_entry(entry):
                log('  补全成功 -> %s 曲' % entry['count'])
            else:
                log('  网易云未匹配，稍后自动重试')
        changed = True
        time.sleep(SLEEP_AFTER_CALL)

    # 2) 已发售但未补全 -> 网易云补全
    enriched = 0
    tried = 0
    for ent in albums:
        if enriched >= MAX_ENRICH_PER_RUN:
            break
        release = ent.get('release') or ''
        if not release or release > local_today():
            continue
        if ent.get('songs') or ent.get('neteaseAlbumId'):
            continue
        key = norm_key(ent.get('name', ''))
        last = state.get(key) or 0
        if isinstance(last, (int, float)) and now_ts - last < RETRY_SKIP_HOURS * 3600:
            continue
        tried += 1
        ok = enrich_entry(ent)
        state[key] = now_ts
        if ok:
            enriched += 1
            log('补全: %s -> %s' % (ent.get('name'), ent['count']))
            changed = True
        else:
            log('未匹配网易云(稍后重试): %s' % ent.get('name'))

    save_atomic(STATE_JSON, state)

    if changed:
        save_atomic(ALBUMS_JSON, albums)
        log('已写入 albums.json | 新增 %d | 补全 %d | 共 %d 张' % (added, enriched, len(albums)))
    else:
        log('无变化 | 共 %d 张' % len(albums))


if __name__ == '__main__':
    import urllib.parse
    main()