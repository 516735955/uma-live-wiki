# -*- coding: utf-8 -*-
"""自动同步官方 Google Sheet（赛马娘LIVE歌单导出）中的新歌单到站点详情页。

由 server.js 爬虫链调用（每次 catalog refresh 最先执行）。对 Google Sheet 中
出现、但站点还没有的歌单活动，自动：

  1. 下载官方 xlsx（不可达/未公开则在日志里说明并跳过，不影响主流程）
  2. 与本地跟踪用 xlsx / 已插入记录比对，找出「新增歌单活动」
  3. 分类并全自动插入 live_cat_data.json：
       - WINNING LIVE / STARTING GATE / 动画相关  -> 追加到 cd 对应分区 group
       - 编号系列公演（EVENT / WORLD TOUR / STAGE / DAY）-> 不自动改 HTML，只上报
       - 其余有歌单的 live                           -> 追加到 other.groups
     每个 group 按现有手工格式生成：cast-line、setlist-table（演员按声优/角色/
     头像映射铺成 perf-item 结构）。
  4. 尽量把 events_data.json 里匹配到的未开演事件补上 live 字段（本轮即可生效；
     之后 crawl_events.py 也会自动维护该字段）。
  5. 成功后用下载的表覆盖本地跟踪用 xlsx。

安全策略（全自动写线上数据时防止误伤）：
  - 任何异常（缺 openpyxl / 下载失败 / 解析不出歌单 / 标题重复）都只记日志，退出码为 0，
    绝不中断主爬虫链、绝不写坏数据。
  - 服务器首次运行（无跟踪 xlsx、无已见记录）时只建立基线，不做任何插入。
  - 同一标题在 live_cat 里已存在 -> 跳过。
  - 没有出演者 / 歌单为空 -> 跳过并上报。
  - 编号系列公演（需要改 HTML LIVE_DATA）一律不自动处理，写入报告等人工。

用法:
    python auto_setlists.py [--dry-run] [--sheet-xlsx 已下载的.xlsx] [--report out.json]

依赖: Python 3.7+；openpyxl（缺了会跳过）。
"""
import argparse
import datetime
import html as _html
import io
import json
import os
import re
import shutil
import sys
import urllib.request

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
DATA_DIR = os.path.join(ROOT, 'data')
EVENTS_DIR = os.path.join(DATA_DIR, 'events')

SHEET_ID = '1HU5lkpjmz3_tXtJnHLvBcbeUXe_2LliD9AagFdwhDvk'
SHEET_URL = 'https://docs.google.com/spreadsheets/d/%s/export?format=xlsx' % SHEET_ID
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

LIVE_CAT_JSON = os.path.join(DATA_DIR, 'live_cat_data.json')
EVENTS_JSON = os.path.join(DATA_DIR, 'events_data.json')
VOICE_PROFILES_JSON = os.path.join(DATA_DIR, 'voice_actor_profiles.json')
PEDIGREE_JSON = os.path.join(DATA_DIR, 'pedigree_source.json')
TRACKING_XLSX = os.path.join(EVENTS_DIR, '赛马娘LIVE歌单导出.xlsx')
SEEN_JSON = os.path.join(EVENTS_DIR, 'sheet_seen.json')
REPORT_JSON = os.path.join(EVENTS_DIR, 'sheet_apply_report.json')
TMP_XLSX = os.path.join(EVENTS_DIR, 'download_sheet_tmp.xlsx')

_SONG_RE = re.compile(r'^M\s*(\d+)[\.\s]\s*(.*)$', re.IGNORECASE)
_PERF_SPLIT_RE = re.compile(r'[\u3001\uff0c,\uff64/\u30fb]')
_TITLE_SPLIT_RE = re.compile(r'[\uff20@]')
_TRAIL_REGION_RE = re.compile(r'\s*[(\uff08][^()\uff08\uff09]*[)\uff09]\s*$')
_PART_RE = re.compile(r'([1-3]\u90e8|DAY\s*\d+|\u7b2c[\u4e00\u4e8c\u4e09\u56db]\u90e8|\u30a2\u30d5\u30bf\u30fc\u30d1\u30fc\u30c8)',
                      re.IGNORECASE)
_DAY_RE = re.compile(r'(\d+)\s*\u65e5\u76ee')

_TRANS = str.maketrans({
    '\u3000': ' ', ' ': '', '\uff5e': '~', '\u301c': '~', '\uff0d': '-',
    '\u2014': '-', '\uff01': '!', '\uff1f': '?', '\uff06': '&',
    '\u2019': "'", '\u201d': '"', '"': '"', '\u300e': '', '\u300f': '',
    '\u300c': '', '\u300d': '', '\u3010': '', '\u3011': '',
    '\uff08': '', '\uff09': '', '(': '', ')': '', '@': '', '\uff20': '',
})


def norm(s):
    s = (s or '').replace('\u914d\u4fe1', '')
    s = s.translate(_TRANS)
    s = _DAY_RE.sub(r'DAY\1', s)
    s = s.upper()
    for junk in ('\u30a6\u30de\u5a18\u30d7\u30ea\u30c6\u30a3\u30fc\u30c0\u30d3\u30fc',
                 '\u8cfd\u99ac\u5a18PRETTYDERBY', '\u8d5b\u9a6c\u5a18PRETTYDERBY',
                 '\u8cfd\u99ac\u5a18', '\u8d5b\u9a6c\u5a18', '\u30a6\u30de\u5a18'):
        s = s.replace(junk, '')
    s = re.sub(r'[(\uff08][^()\uff08\uff09]*[)\uff09]$', '', s)
    return s.rstrip(' @').strip()


def bigrams(s):
    return set(s[i:i + 2] for i in range(len(s) - 1)) if len(s) > 1 else {s}


def sim(a, b):
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    A, B = bigrams(a), bigrams(b)
    inter = len(A & B)
    return 2.0 * inter / (len(A) + len(B)) if A and B else 0.0


def classify(title):
    t = (title or '').upper()
    if 'WINNING LIVE' in t:
        return 'cd-win'
    if 'STARTING GATE' in t:
        return 'cd-sg'
    if any(k in t for k in ('\u30a2\u30cb\u30e1', 'SEASON', '\u3046\u307e\u3086\u308b',
                            'ROAD TO THE TOP', '\u30b7\u30f3\u30c7\u30ec\u30e9\u30b0\u30ec\u30a4',
                            'ANIMATION DERBY')):
        return 'cd-anime'
    if any(k in t for k in ('EVENT', 'WORLD TOUR', 'STAGE', 'DAY')):
        return 'series'
    return 'other'


def load_json(path, default=None):
    try:
        with io.open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, value, indent):
    with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(value, f, ensure_ascii=False, indent=indent)


def esc(v):
    return _html.escape(v or '', quote=True)


def _proxy_url():
    """优先环境变量，其次 Windows 系统代理（WinINET 设置）。"""
    for k in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'):
        v = os.environ.get(k)
        if v:
            return v
    if os.name == 'nt':
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
                enable, _ = winreg.QueryValueEx(key, 'ProxyEnable')
                server, _ = winreg.QueryValueEx(key, 'ProxyServer')
                if enable and server:
                    if '=' in server:
                        parts = dict(p.split('=', 1) for p in server.split(';') if '=' in p)
                        return parts.get('https') or parts.get('http') or server
                    return server
        except Exception:
            pass
    return None


def fetch_sheet_bytes(url, timeout=60):
    proxy = _proxy_url()
    handlers = []
    if proxy:
        if '://' not in proxy:
            proxy = 'http://' + proxy
        handlers.append(urllib.request.ProxyHandler({'http': proxy, 'https': proxy}))
    opener = urllib.request.build_opener(*handlers)
    opener.addheaders = [('User-Agent', UA['User-Agent'])]
    with opener.open(url, timeout=timeout) as r:
        return r.read()


# ---------- xlsx 解析 ----------
def parse_sheet(path):
    """解析『セトリ』sheet -> [{date,title,songs:[{no,name,perf:[..]}]}]。

    列结构：col0=日期  col1=活动标题  col2=曲目  col3=上一首曲目对应的出演者。
    """
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    events = []
    cur_date = None
    cur = None
    for row in ws.iter_rows(min_row=1, values_only=True):
        d = row[0] if len(row) > 0 else None
        t = row[1] if len(row) > 1 else None
        s = row[2] if len(row) > 2 else None
        perf = row[3] if len(row) > 3 else None
        if d is not None:
            if isinstance(d, datetime.datetime):
                cur_date = d.strftime('%Y-%m-%d')
            elif isinstance(d, str):
                cur_date = (d or '')[:10]
            elif isinstance(d, (int, float)):
                cur_date = str(int(d))
        if t is not None and str(t).strip():
            title = str(t).strip()
            if not cur or cur.get('title') != title:
                cur = {'date': cur_date, 'title': title, 'songs': []}
                events.append(cur)
        elif s is not None and str(s).strip():
            if cur is None:
                continue
            song = str(s).strip()
            m = _SONG_RE.match(song)
            no = m.group(1) if m else None
            if no is not None:
                no = no.lstrip('0') or '0'
            entry = {'no': no,
                     'name': (m.group(2).strip() if m else song),
                     'perf': []}
            cur['songs'].append(entry)
            if perf is not None and str(perf).strip():
                entry['perf'] = split_perf(perf)
        elif perf is not None and str(perf).strip() and cur is not None and cur['songs']:
            last = cur['songs'][-1]
            if not last['perf']:
                last['perf'] = split_perf(perf)
    return events


def split_perf(v):
    return [p.strip() for p in _PERF_SPLIT_RE.split(str(v)) if p.strip()]


def parse_sheet_safe(path):
    return [e for e in parse_sheet(path) if e.get('title') and e['songs']]


# ---------- 演员 -> 角色/头像 映射 ----------
def build_performer_map():
    """返回 {演员名: {'cn','role_name','char':{'zh','avatar'}|None}}。"""
    out = {}
    profiles = load_json(VOICE_PROFILES_JSON) or {}
    nodes = (load_json(PEDIGREE_JSON) or {}).get('nodes') or []
    char_map = {}
    for n in nodes:
        if isinstance(n, dict) and n.get('id') and n.get('avatar'):
            char_map[n['id'].lower()] = {'zh': n.get('zh') or n.get('en') or '',
                                         'avatar': n['avatar']}
    for va in (profiles.get('voice_actors') or []):
        if not isinstance(va, dict):
            continue
        identity = va.get('identity') or {}
        roles = [r for r in (va.get('roles') or [])
                 if isinstance(r, dict) and not r.get('former')]
        if not roles:
            continue
        cid = (roles[0].get('character_id') or '').lower()
        entry = {'cn': identity.get('zh') or '',
                 'role_name': roles[0].get('name') or '',
                 'char': char_map.get(cid)}
        names = set()
        if identity.get('ja'):
            names.add(identity['ja'])
        for a in (identity.get('aliases') or []):
            if a:
                names.add(str(a))
        for nm in names:
            out.setdefault(nm, entry)
    return out


# ---------- 标题 / 场地解析 ----------
def clean_title(raw):
    t = _TITLE_SPLIT_RE.split(str(raw or '').strip(), 1)[0].strip()
    t = _TRAIL_REGION_RE.sub('', t).strip(' \u3000@\uff20')
    return t


def venue_from(raw):
    parts = _TITLE_SPLIT_RE.split(str(raw or '').strip(), 1)
    if len(parts) < 2:
        return ''
    return _TRAIL_REGION_RE.sub('', parts[1]).strip(' \u3000')


def part_label(title):
    m = _PART_RE.search(title or '')
    return m.group(1) if m else ''


# ---------- HTML 生成 ----------
def perf_item_html(pnames, pmap):
    out = []
    for pn in pnames:
        info = pmap.get(pn)
        ch = (info or {}).get('char')
        if ch and ch.get('avatar') and ch.get('zh'):
            out.append('<span class="perf-item"><img class="char-avatar" src="%s" alt="%s" title="%s"><span class="perf-name">%s</span></span>'
                       % (esc(ch['avatar']), esc(ch['zh']), esc(ch['zh']), esc(ch['zh'])))
        else:
            out.append('<span class="perf-item"><span class="perf-name">%s</span></span>' % esc(pn))
    return ''.join(out)


def table_html(songs, pmap):
    rows = []
    for idx, song in enumerate(songs, 1):
        rows.append('<tr><td class="setlist-no">%s</td><td class="setlist-song">%s</td><td class="setlist-perf">%s</td></tr>'
                    % (esc(song.get('no') or str(idx)), esc(song['name']),
                       perf_item_html(song.get('perf') or [], pmap)))
    return ('<table class="setlist-table">\n'
            '<thead><tr><th>#</th><th>\u66f2\u540d</th><th>\u51fa\u6f14\u8005</th></tr></thead>\n'
            '<tbody>\n' + ''.join(rows) + '\n</tbody>\n</table>')


def cast_html(performers, pmap):
    entries = []
    for pn in performers:
        info = pmap.get(pn)
        ch = (info or {}).get('char')
        if ch and ch.get('zh'):
            entries.append('%s\uff08%s\uff09' % (pn, ch['zh']))
        elif info and info.get('role_name'):
            entries.append('%s\uff08%s\uff09' % (pn, info['role_name']))
        else:
            entries.append(pn)
    return '<div class="cast-line">%s</div>' % '\u3001'.join(entries)


def build_subs(blocks, pmap, title_clean):
    subs = []
    unresolved = []
    total_perf = 0
    for blk in blocks:
        songs = blk['songs']
        performers = []
        for song in songs:
            for pn in (song.get('perf') or []):
                if pn not in performers:
                    performers.append(pn)
        total_perf += len(performers)
        for pn in performers:
            if pn not in pmap and pn not in unresolved:
                unresolved.append(pn)
        date_str = blk['date'] or ''
        venue = venue_from(blk['title'])
        if venue:
            date_str = ('%s %s' % (date_str, venue)).strip()
        subs.append({
            'title': title_clean,
            'date': date_str,
            'cast': cast_html(performers, pmap),
            'days': [{'label': part_label(blk['title']) or '\u672c\u516c\u6f14',
                      'table': table_html(songs, pmap)}],
        })
    return subs, unresolved, total_perf


# ---------- live_cat 操作 ----------
def find_section(live_cat, keyword):
    cd = live_cat.get('cd') or {}
    for si, sec in enumerate(cd.get('sections') or []):
        probe = (sec.get('group') or '')
        groups = sec.get('groups') or []
        if groups:
            probe += ' ' + (groups[0].get('group') or '')
        if keyword in probe:
            return si
    return None


def existing_normalized(live_cat):
    seen = set()
    for cat in ('cd', 'other', 'twinkle'):
        root = live_cat.get(cat) or {}
        if not isinstance(root, dict):
            continue
        sections = root.get('sections') or [{'groups': root.get('groups') or []}]
        for sec in sections:
            for g in (sec.get('groups') or []):
                seen.add(norm(g.get('group') or ''))
                for sub in (g.get('subs') or []):
                    seen.add(norm(sub.get('title') or ''))
    return seen


def attempt_live_link(events_data, title, date, url):
    """把匹配到的未开演事件（live=''）的 live 字段指向 url。返回命中次数。"""
    try:
        tord = datetime.date(*(int(x) for x in (date or '9999').split('-')[:3])).toordinal()
    except Exception:
        tord = None
    tkey = norm(title)
    hits = 0
    for ev in (events_data or {}).get('events') or []:
        if ev.get('live'):
            continue
        try:
            eord = datetime.date(*(int(x) for x in (ev.get('date') or '9999').split('-')[:3])).toordinal()
        except Exception:
            eord = None
        if tord is not None and eord is not None and abs(eord - tord) > 2:
            continue
        if sim(tkey, norm(ev.get('title') or '')) < 0.5:
            continue
        ev['live'] = url
        hits += 1
    return hits


def target_groups(live_cat, cat):
    """返回 (groups_list, base_url) 或 (None, reason)。"""
    if cat == 'other':
        groups = (live_cat.get('other') or {}).get('groups')
        if groups is None:
            return None, None, 'other.groups 未找到'
        return groups, '/zh-Hans/live/other/%d', None
    kw = {'cd-win': 'WINNING LIVE', 'cd-sg': 'STARTING GATE', 'cd-anime': '\u30a2\u30cb\u30e1'}[cat]
    si = find_section(live_cat, kw)
    if si is None:
        return None, None, '%s 分区未找到' % kw
    groups = live_cat['cd']['sections'][si]['groups']
    return groups, '/zh-Hans/live/cd/%d/%%d' % si, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--sheet-xlsx', default=None, help='跳过网络，使用本地已下载的 xlsx')
    ap.add_argument('--report', default=REPORT_JSON)
    ap.add_argument('--tracking-xlsx', default=TRACKING_XLSX)
    args = ap.parse_args()

    report = {'when': datetime.datetime.now().isoformat(timespec='seconds'),
              'downloaded': False, 'sheet_events': 0, 'new_titles': 0,
              'inserted': [], 'skipped': [], 'unresolved_performers': [], 'errors': []}
    print('[sheet-sync] auto_setlists start', flush=True)

    try:
        import openpyxl  # noqa: F401
    except Exception as ex:
        report['errors'].append('openpyxl 缺失(%s)' % ex)
        print('[sheet-sync] skip: openpyxl 缺失，', ex, flush=True)
        save_json(args.report, report, 1)
        return 0

    # 0) 下载 / 读入 Sheet
    if args.sheet_xlsx:
        try:
            with io.open(args.sheet_xlsx, 'rb') as f:
                data = f.read()
        except Exception as ex:
            report['errors'].append('读取本地 xlsx 失败(%s)' % ex)
            save_json(args.report, report, 1)
            return 0
        print('[sheet-sync] use local xlsx:', args.sheet_xlsx, flush=True)
    else:
        try:
            data = fetch_sheet_bytes(SHEET_URL)
            report['downloaded'] = True
            print('[sheet-sync] downloaded %d bytes' % len(data), flush=True)
        except Exception as ex:
            report['errors'].append('下载失败(%s)，跳过本轮歌单同步' % ex)
            print('[sheet-sync] skip: 下载失败，', ex, flush=True)
            save_json(args.report, report, 1)
            return 0

    if not data or data[:2] != b'PK':
        report['errors'].append('下载内容不是有效 xlsx（无 ZIP 头）')
        print('[sheet-sync] skip: 非有效 xlsx', flush=True)
        save_json(args.report, report, 1)
        return 0

    try:
        with io.open(TMP_XLSX, 'wb') as f:
            f.write(data)
        sheet_events = parse_sheet_safe(TMP_XLSX)
    except Exception as ex:
        report['errors'].append('解析 Sheet 失败(%s)' % ex)
        print('[sheet-sync] skip: 解析失败', ex, flush=True)
        save_json(args.report, report, 1)
        return 0
    report['sheet_events'] = len(sheet_events)
    print('[sheet-sync] sheet events(with setlist)=%d' % len(sheet_events), flush=True)

    # 1) 已见表：跟踪 xlsx（上次同步快照）+ 记录文件
    seen = load_json(SEEN_JSON) or {'schema': 1, 'titles': {}}
    seen_titles = seen.setdefault('titles', {})
    tracking_exists = os.path.exists(args.tracking_xlsx)
    if tracking_exists:
        try:
            for e in parse_sheet_safe(args.tracking_xlsx):
                seen_titles.setdefault(norm(e['title']), {'status': 'baseline'})
        except Exception as ex:
            report['errors'].append('读取跟踪 xlsx 失败(%s)' % ex)

    if not tracking_exists and not seen_titles:
        # 服务器首次部署：建立基线，不插入任何历史歌单。
        for e in sheet_events:
            seen_titles.setdefault(norm(e['title']), {'status': 'baseline'})
        if not args.dry_run:
            save_json(SEEN_JSON, seen, 1)
            shutil.copyfile(TMP_XLSX, args.tracking_xlsx)
        report['skipped'].append('首次运行：已建立基线（sheet=%d 条，未插入）' % len(sheet_events))
        print('[sheet-sync] baseline: sheet=%d, no insert' % len(sheet_events), flush=True)
        save_json(args.report, report, 1)
        return 0

    # 2) 增量
    pmap = build_performer_map()
    live_cat = load_json(LIVE_CAT_JSON) or {}
    events_data = load_json(EVENTS_JSON) or {}
    existing = existing_normalized(live_cat)

    new_by_key = {}
    for e in sheet_events:
        k = norm(e['title'])
        if not k:
            continue
        if k in seen_titles:
            continue
        if k in existing:
            seen_titles[k] = {'status': 'existing', 'title': e['title']}
            continue
        new_by_key.setdefault(k, {'title': e['title'], 'blocks': []})
        new_by_key[k]['blocks'].append(e)
    report['new_titles'] = len(new_by_key)

    changed_livecat = changed_eventsdata = False
    for k, item in sorted(new_by_key.items()):
        title_raw = item['title']
        cat = classify(title_raw)
        if cat == 'series':
            seen_titles[k] = {'status': 'skipped_series', 'title': title_raw}
            report['skipped'].append({'title': title_raw,
                                      'reason': '编号系列公演（需人工改 HTML LIVE_DATA）'})
            print('[sheet-sync] skip series:', title_raw, flush=True)
            continue

        title_clean = clean_title(title_raw)
        if not title_clean:
            seen_titles[k] = {'status': 'skipped_badtitle', 'title': title_raw}
            report['skipped'].append({'title': title_raw, 'reason': '无法清洗标题'})
            continue

        subs, unresolved, total_perf = build_subs(item['blocks'], pmap, title_clean)
        for pn in unresolved:
            report['unresolved_performers'].append({'performer': pn, 'title': title_clean})
        if total_perf == 0:
            seen_titles[k] = {'status': 'skipped_noperf', 'title': title_raw}
            report['skipped'].append({'title': title_raw, 'reason': '没有出演者信息'})
            continue

        groups, base_fmt, reason = target_groups(live_cat, cat)
        if groups is None:
            report['errors'].append('%s：%s' % (title_clean, reason))
            print('[sheet-sync] error:', title_clean, reason, flush=True)
            continue
        gi = len(groups)
        base = base_fmt % gi

        if args.dry_run:
            report['inserted'].append({'title': title_clean, 'category': cat,
                                       'url': base, 'dry_run': True,
                                       'unresolved': unresolved, 'subs': subs})
            print('[sheet-sync][dry] would insert:', title_clean, '->', base, flush=True)
            continue

        for pi, sub in enumerate(subs):
            url = base if pi == 0 else '%s/%d/0' % (base, pi)
            if events_data and attempt_live_link(events_data, title_clean,
                                                 (sub['date'] or '').split(' ')[0], url):
                changed_eventsdata = True
        groups.append({'group': title_clean, 'subs': subs})
        changed_livecat = True
        seen_titles[k] = {'status': 'inserted', 'title': title_raw}
        report['inserted'].append({'title': title_clean, 'category': cat, 'url': base})
        print('[sheet-sync] inserted:', title_clean, '->', base, flush=True)

    if not args.dry_run:
        if changed_livecat:
            save_json(LIVE_CAT_JSON, live_cat, 2)
        if changed_eventsdata:
            save_json(EVENTS_JSON, events_data, 1)
        save_json(SEEN_JSON, seen, 1)
        shutil.copyfile(TMP_XLSX, args.tracking_xlsx)
        print('[sheet-sync] tracking xlsx updated', flush=True)

    save_json(args.report, report, 1)
    print('[sheet-sync] done | sheet=%d new=%d inserted=%d skipped=%d' % (
        len(sheet_events), len(new_by_key),
        sum(1 for r in report['inserted'] if not r.get('dry_run')),
        len(report['skipped'])), flush=True)
    return 0


if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.exit(main())