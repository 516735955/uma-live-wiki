# -*- coding: utf-8 -*-
"""阶段0：检测官方站新增角色（增量入口）
用法: python3 check_new_characters.py
"""
import io, re, json, sys, os, urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)
INDEX = os.path.join(ROOT, 'data', 'character_index_data.js')
URL = 'https://umamusume.jp/character/'

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read().decode('utf-8', 'replace')

raw = fetch(URL)
print('official page fetched, bytes=%d' % len(raw.encode("utf-8")))

ids = []
for m in re.finditer(r'href="/character/([a-z0-9_]+)/?"', raw):
    cid = m.group(1)
    if cid not in ids:
        ids.append(cid)
print('official character ids:', len(ids))

idx = io.open(INDEX, encoding='utf-8').read()
chars = json.loads(re.search(r'window\.CHAR_INDEX\s*=\s*(\[.*?\]);?\s*$', idx, re.S).group(1))
existing = {c['id'] for c in chars}
print('local CHAR_INDEX:', len(existing))

new = [i for i in ids if i not in existing]
gone = sorted(existing - set(ids))
print()
print('=== 新增角色:', len(new))
for i in new:
    print('  +', i)
print('=== 官方已移除(本地多余):', len(gone))
for g in gone:
    print('  -', g)
if not new:
    print()
    print('结论: 无新角色，管线无需执行。')
else:
    print()
    print('结论: 发现新角色，按流程文档阶段1→4依次执行。')
