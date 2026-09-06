# -*- coding: utf-8 -*-
"""Fetch 6 Eventernote detail pages -> uma_tools/manual_events.json (pre-linked)."""
import urllib.request, re, json, io, sys, os, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

OUT = r'G:\学习\AI\uma_tools\manual_events.json'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

TARGETS = {
    '124343': '/zh-Hans/live/other/7',    # 響×Cygames 公開録音まつり ぱかラジッ
    '267407': '/zh-Hans/live/other/18',   # 出張版 ぱかライブTV Vol.3
    '302779': '/zh-Hans/live/other/30',   # VTuber Fes Japan 2022
    '304660': '/zh-Hans/live/other/31',   # V-Carnival VOL.2 DAY2
    '424802': '/zh-Hans/live/cd/2/5',     # シンデレラグレイ∞ 【1部】
    '424803': '/zh-Hans/live/cd/2/6',     # シンデレラグレイ∞ 【2部】
}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=35).read().decode('utf-8', 'replace')

def field(h, label):
    m = re.search(label + r'.{0,200}?</td>\s*<td>(.*?)</td>', h, re.S)
    return m.group(1) if m else ''

rows = []
for eid, live_url in TARGETS.items():
    h = get('https://www.eventernote.com/events/' + eid)
    t = re.search(r'<meta property="og:title" content="([^"]+)"', h)
    title = t.group(1).strip() if t else ''
    d = re.search(r'開催日時.{0,200}?<a[^>]*>(\d{4}-\d{2}-\d{2})&nbsp;\(([月火水木金土日])\)</a>', h, re.S)
    date, wd = (d.group(1), d.group(2)) if d else ('', '')
    ven = re.search(r'開催場所.{0,200}?<a href="(/places/\d+)">([^<]+)</a>', h, re.S)
    venue_link = ('https://www.eventernote.com' + ven.group(1)) if ven else ''
    venue = ven.group(2).strip() if ven else ''
    tm_raw = field(h, '時間')
    times = re.sub(r'<[^>]+>', ' ', tm_raw)
    times = re.sub(r'\s+', ' ', times).replace('&nbsp;', ' ').strip()
    img = ''
    mi = re.search(r'images/events/%s\.jpg' % eid, h)
    if mi:
        img = 'https://eventernote.s3.amazonaws.com/images/events/%s.jpg' % eid
    rows.append({
        'date': date,
        'date_zh': (date + ' (' + wd + ')') if date else '',
        'title': title,
        'link': 'https://www.eventernote.com/events/' + eid,
        'img': img,
        'venue': venue,
        'venue_link': venue_link,
        'times': times,
        'actors': [],
        'live': live_url,
        '_manual': True,
    })
    print('%s | %-10s | %-46s | %s | %s' % (eid, date, title[:46], venue[:14], live_url))
    time.sleep(0.4)

json.dump(rows, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('WROTE', OUT, len(rows))
