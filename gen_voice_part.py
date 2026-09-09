# -*- coding: utf-8 -*-
import io, sys, re, json, html, datetime, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = os.path.dirname(os.path.abspath(__file__))
H = io.open(os.path.join(ROOT, '赛马娘LIVE相关.html'), encoding='utf-8').read()
def extract(name):
    i = H.find(name + ' = ')
    s = H.index('[', i); dep = 0; e = -1
    for j in range(s, len(H)):
        if H[j] == '[': dep += 1
        elif H[j] == ']':
            dep -= 1
            if dep == 0: e = j + 1; break
    return json.loads(H[s:e])

LIVE = extract('LIVE_DATA')
SERIES = extract('SERIES_GRID')
CAT = json.load(io.open(os.path.join(ROOT, 'live_cat_data.json'), encoding='utf-8'))
# 用 app 实际角色库 CHAR_INDEX（character_index_data.js，179个，最完整且与页面一致）
jsrc = io.open(os.path.join(ROOT, 'character_index_data.js'), encoding='utf-8').read()
CHAR_INDEX = json.loads(re.search(r'window\.CHAR_INDEX\s*=\s*(\[[\s\S]*?\])\s*;', jsrc).group(1))
# 兼容后备：并入 characters_data.json
chars_doc = json.load(io.open(os.path.join(ROOT, 'characters_data.json'), encoding='utf-8-sig'))['characters']
# 异体字折叠（高↔髙、崎↔﨑 等），让声优名对齐到 voice 库规范写法
VFOLD = {'髙': '高', '﨑': '崎', '祥': '祥', '塚': '塚', '濱': '浜', '諸': '諸',
         '侮': '仏', '墨': '墨', '梶': '梶', '稲': '稲', '榊': '榊', '蓮': '蓮'}
def vfold(s):
    return ''.join(VFOLD.get(c, c) for c in s)
voiceDb = set(); charToCv = {}; cv_fold = {}
def add_char(c):
    cv = c.get('cv')
    if not cv: return
    voiceDb.add(cv)
    cv_fold.setdefault(vfold(cv), cv)
    charToCv[cv] = cv
    # 原声优（换过CV的角色）：规范化/日文写法都映射为自身，令早期活动出演可解析
    for fk in ('cv_former', 'cv_former_ja'):
        f = c.get(fk)
        if not f: continue
        voiceDb.add(f)
        charToCv[f] = f
        cv_fold.setdefault(vfold(f), f)
    for kk in ('zh', 'ja', 'name_zh', 'name_ja'):
        nm = c.get(kk)
        if nm: charToCv[nm] = cv
for c in CHAR_INDEX: add_char(c)
for c in chars_doc: add_char(c)
def resolve_cv(n):
    if not n: return None
    n = n.strip()
    cv_part = n; ch_part = None
    if '（' in n:
        cv_part = n.split('（')[0].strip()
        m = re.search(r'（([^）]+)）', n)
        if m: ch_part = m.group(1).strip()
    f = vfold(cv_part)
    if f in cv_fold: return cv_fold[f]
    if cv_part in charToCv: return charToCv[cv_part]
    if ch_part and ch_part in charToCv: return charToCv[ch_part]
    if n in charToCv: return charToCv[n]
    return None

def build_actor_from_xlsx(events_data_events):
    """声优排行数据源：events_list.xlsx 的 出演者（按事件计数），规范到 CV 名，
    cat 由 events_data 按 标题 匹配得到。写出 actor_participation.json。"""
    try:
        import openpyxl
    except Exception:
        print('actor xlsx: openpyxl 不可用，跳过')
        return
    def norm_title(t):
        return re.sub(r'\s+', '', (t or '').replace('\u3000', ' ')).strip()
    cat_by_title = {}
    for e in events_data_events:
        live = e.get('live', '') or ''
        if 'number_series_event' in live:
            cat = 'num'
        elif live:
            cat = 'otherlive'
        else:
            cat = 'nonlive'
        cat_by_title[norm_title(e.get('title', ''))] = cat
    try:
        wb = openpyxl.load_workbook(os.path.join(ROOT, 'events_list.xlsx'), data_only=True)
    except Exception as ex:
        print('actor xlsx: events_list.xlsx 读取失败，跳过:', str(ex)[:80])
        return
    ws = wb[wb.sheetnames[0]]
    today = datetime.date.today()
    def parse_date(cell):
        if cell is None:
            return None
        if isinstance(cell, datetime.datetime):
            return cell.date()
        if isinstance(cell, datetime.date):
            return cell
        m = re.search(r'(\d{4})-(\d{1,2})-(\d{1,2})', str(cell))
        if m:
            try:
                return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except Exception:
                return None
        return None
    entries = []
    total_names = 0
    skipped = 0
    skipped_future = 0
    for r in range(2, ws.max_row + 1):
        date_cell = ws.cell(r, 1).value
        title = ws.cell(r, 2).value
        actors_raw = ws.cell(r, 4).value
        if not title and not actors_raw:
            continue
        d = parse_date(date_cell)
        if d is None or d >= today:
            skipped_future += 1
            continue
        cat = cat_by_title.get(norm_title(title), 'nonlive')
        names = [x.strip() for x in (actors_raw or '').split('、') if x.strip()] if isinstance(actors_raw, str) else []
        cvs = []
        for nm in names:
            cand = '佐伯伊織' if nm == '佐伯伊織(NU-KO)' else nm
            cv = resolve_cv(cand)
            if cv:
                cvs.append(cv)
            else:
                skipped += 1
        entries.append({'cat': cat, 'actors': cvs})
        total_names += len(names)
    out = {'generated_at': 'local-build',
           'source': 'events_list.xlsx + events_data.json + CHAR_INDEX',
           'cutoff': today.isoformat(), 'only_before_today': True,
           'total_events': len(entries), 'entries': entries}
    io.open(os.path.join(ROOT, 'actor_participation.json'), 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1))
    print('actor_participation.json 写出: 事件=%d 出演者条目=%d 未解析跳过=%d 今日及未来跳过=%d (截至 %s)' % (len(entries), total_names, skipped, skipped_future, today.isoformat()))

ev = json.load(io.open(os.path.join(ROOT, 'events_data.json'), encoding='utf-8-sig'))['events']

def collect_voice(tb):
    st = set()
    for m in re.finditer(r'<span class="perf-name">([\s\S]*?)</span>', tb):
        n = re.sub(r'<[^>]+>', '', m.group(1))
        n = html.unescape(n).strip()
        if not n: continue
        cv = resolve_cv(n)
        if cv: st.add(cv)
    return sorted(st)

def normalize_punct(s):
    res = []
    for c in s:
        o = ord(c)
        if 0xFF01 <= o <= 0xFF5E:
            res.append(chr(o - 0xFEE0))
        elif c == '\u3000':
            res.append(' ')
        else:
            res.append(c)
    return ''.join(res)

CURLY = {'’': "'", '‘': "'", '“': '"', '”': '"', '｢': '「', '｣': '」', '〈': '<', '〉': '>'}
def fix_quotes(n):
    return ''.join(CURLY.get(c, c) for c in n)

def rm_cjk_space(n):
    n = re.sub(r'([\u3040-\u30FF\u4E00-\u9FFF])\s+([A-Za-z0-9])', r'\1\2', n)
    n = re.sub(r'([A-Za-z0-9])\s+([\u3040-\u30FF\u4E00-\u9FFF])', r'\1\2', n)
    return n

# known abbreviations / typo corrections (applied after cleaning)
ALIAS = {
    'Ready!!! Steady!!! Derby!!!': 'Ready!! Steady!! Derby!!',
}

def clean_song(raw):
    n = re.sub(r'<[^>]+>', '', raw)
    n = html.unescape(n).strip()
    if n == '安可' or '曲名不明' in n or re.match(r'^MC\d*$', n):
        return None
    # remove full-width parenthetical version groups (may contain half-width parens inside)
    n = re.sub(r'（[^（）]*）', '', n)
    # remove half-width parenthetical version groups
    n = re.sub(r'\([^()]*\)', '', n)
    # drop any leftover stray parens
    n = n.replace('（', '').replace('）', '').replace('(', '').replace(')', '')
    # normalize full-width punctuation to half-width (merges ！/! etc.)
    n = normalize_punct(n)
    # normalize curly quotes to straight
    n = fix_quotes(n)
    # drop invisible variation selectors (keep decorative ▷▶★♪ symbols)
    n = n.replace('\uFE0E', '').replace('\uFE0F', '')
    # remove space between Japanese and Latin (merges アコガレ Challenge / アコガレChallenge)
    n = rm_cjk_space(n)
    # remove space immediately before punctuation (Enter Enter MISSION ! -> !)
    n = re.sub(r'\s+([!?！？。、,.])', r'\1', n)
    n = re.sub(r'\s+', ' ', n).strip()
    if '※Short ver.' in n:
        return n
    # strip other ※ version tags (Game size / Long ver. etc.)
    n = re.sub(r'※.*$', '', n)
    n = n.strip()
    return n if n else None

# merge variants that differ only by ! count / spacing / casing
canon_map = {}
def song_key(s):
    k = s.lower()
    k = re.sub(r'[!！]+', '!', k)
    k = re.sub(r'[?？]+', '?', k)
    k = re.sub(r'\s+', '', k)
    return k
def canon(s):
    if s in ALIAS:
        s = ALIAS[s]
    k = song_key(s)
    if k not in canon_map:
        canon_map[k] = s
    return canon_map[k]

def collect_songs(tb):
    out = []
    for m in re.finditer(r'<td class="setlist-song">([\s\S]*?)</td>', tb):
        s = clean_song(m.group(1))
        if s:
            s = canon(s)
            out.append(s)
    return out

def get_tables(live_url):
    if not live_url: return []
    p = [x for x in live_url.split('/') if x]
    if p and p[0].lower() == 'zh-hans': p = p[1:]
    if not p or p[0] != 'live' or p[1] == 'number_series_event': return []
    try:
        if len(p) >= 4: si, gi = int(p[2]), int(p[3])
        else: si, gi = 0, int(p[2])
    except Exception: return []
    node = CAT.get(p[1])
    if not node: return []
    groups = None
    if 'sections' in node:
        try: groups = node['sections'][si]['groups']
        except Exception: return []
    elif 'groups' in node: groups = node['groups']
    else: return []
    if gi >= len(groups): return []
    grp = groups[gi]; t = []
    def w(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'table' and isinstance(v, str): t.append(v)
                else: w(v)
        elif isinstance(o, list):
            for x in o: w(x)
    w(grp); return t

def num_day(live_url):
    p = [x for x in live_url.split('/') if x]
    if p and p[0].lower() == 'zh-hans': p = p[1:]
    if len(p) < 3: return None
    no = p[2].replace('_EVENT', '')
    gi = None
    for idx, g in enumerate(LIVE):
        if no in (g.get('group') or ''): gi = idx; break
    if gi is None: return None
    grp = LIVE[gi]
    pi = int(p[3]) if len(p) >= 4 else 0
    di = int(p[4]) if len(p) >= 5 else 0
    sub = None
    for cand in [pi, pi - 1]:
        if 0 <= cand < len(grp.get('subs', [])): sub = grp['subs'][cand]; break
    if sub is None: return None
    days = sub.get('days', [])
    day = None
    for cand in [di, di - 1]:
        if 0 <= cand < len(days): day = days[cand]; break
    if day is None: return [d for d in days]
    return [day]

events = []
# non-live: from events_data (Eventernote 出演者)
for e in ev:
    if e.get('live'): continue
    vas = [cv for cv in (resolve_cv(a.get('name')) for a in e.get('actors', [])) if cv]
    events.append({'link': e.get('link', ''), 'title': e.get('title', ''), 'cat': 'nonlive',
                   'days': [{'voice_actors': vas}]})
# 其他live: from events_data live entries (cd/twinkle/other) -> per day-table
# 同时合并该活动的出演者（events_data actors），补上歌单未逐曲列出的声优（如 other/4 的高柳知葉）
for e in ev:
    live = e.get('live')
    if not live or 'number_series_event' in live: continue
    days = []
    for tb in get_tables(live):
        vas = set(collect_voice(tb))
        for a in e.get('actors', []):
            cv = resolve_cv(a.get('name'))
            if cv: vas.add(cv)
        days.append({'voice_actors': sorted(vas), 'songs': collect_songs(tb)})
    events.append({'link': live, 'title': e.get('title', ''), 'cat': 'otherlive', 'days': days})
# 补充：CAT 里有歌单、但 events_data 缺对应 live 条目的场次（如 other/27, other/29, cd/1, cd/7）
covered = set(e2['link'] for e2 in events if e2['cat'] == 'otherlive')
for cat in ['other', 'cd', 'twinkle']:
    node = CAT.get(cat)
    if not node: continue
    groups = node['groups'] if 'groups' in node else node['sections'][0]['groups']
    for gi, grp in enumerate(groups):
        live = '/zh-Hans/live/%s/%d' % (cat, gi)
        if live in covered: continue
        days = []
        for tb in get_tables(live):
            days.append({'voice_actors': collect_voice(tb), 'songs': collect_songs(tb)})
        events.append({'link': live, 'title': grp.get('group', ''), 'cat': 'otherlive', 'days': days})
# 编号系列公演: from LIVE_DATA, per 公演(sub) collecting ALL its days
for gi, grp in enumerate(LIVE):
    no = SERIES[gi]['no'] if (SERIES and gi < len(SERIES)) else ('S%d' % (gi + 1))
    for pi, sub in enumerate(grp.get('subs', [])):
        days = []
        for di, day in enumerate(sub.get('days', [])):
            days.append({'label': day.get('label', ''),
                         'voice_actors': collect_voice(day.get('table', '')),
                         'songs': collect_songs(day.get('table', ''))})
        link = '/zh-Hans/live/number_series_event/%s_EVENT/%d' % (no, pi + 1)
        events.append({'link': link, 'title': sub.get('title', ''), 'cat': 'num', 'days': days})

result = {'generated_at': 'local-build', 'source': 'events_data.json + live_cat_data.json + characters_data.json + LIVE_DATA',
          'total': len(events), 'events': events}
io.open(os.path.join(ROOT, 'voice_participation.json'), 'w', encoding='utf-8').write(json.dumps(result, ensure_ascii=False, indent=1))
build_actor_from_xlsx(ev)

from collections import Counter
cc = Counter(ev['cat'] for ev in events)
print('events in file by cat:', dict(cc), 'total', len(events))
# per-day voice/song verify
def flat(cat_filter):
    v = Counter(); s = Counter()
    for ev in events:
        for d in ev['days']:
            for a in d.get('voice_actors', []): v[a] += 1
            for so in d.get('songs', []): s[so] += 1
    return v, s
for f in ['all', 'num', 'otherlive', 'nonlive']:
    v, s = flat(f)
    print('VOICE', f, 'distinct', len(v), 'appear', sum(v.values()))
    if f != 'nonlive':
        print('  SONG', f, 'distinct', len(s), 'appear', sum(s.values()))
# Machico check
mc_v = Counter(); mc_s = Counter()
for ev in events:
    for d in ev['days']:
        if 'Machico' in d.get('voice_actors', []): mc_v['Machico'] += 1
print('Machico num appearances (from file):', sum(1 for ev in events if ev['cat']=='num' and 'Machico' in [a for d in ev['days'] for a in d.get('voice_actors',[])]))
