# -*- coding: utf-8 -*-
import json, os, re, html

BASE = r'G:\学习\AI'
TMP = r'C:\Users\51673\AppData\Local\Temp\opencode'
STATE = os.path.join(TMP, 'pedigree_state.json')

state = json.load(open(STATE, encoding='utf-8'))
results = state['results']
chars = json.load(open(os.path.join(BASE, 'data', 'characters_data.json'), encoding='utf-8'))['characters']
avatars = {m['char']: m['avatar'] for m in
           json.load(open(os.path.join(TMP, 'avatar_map.json'), encoding='utf-8'))}

# ---- classify characters ----
HUMAN_IDS = {'hayakawatazuna', 'akikawayayoi', 'otonashietsuko', 'kiryuinaoi',
             'anshinzawasasami', 'kashimotoriko', 'hoshinakiyoko',
             'akasakamisato', 'hosoejunko'}

char_by_id = {c['id']: c for c in chars}

# ---- build graph ----
# node: key -> dict(name, year, gender, char: None | charid)
# edge: parent -> child (list of child keys), stored per parent
nodes = {}
children_of = {}
parents_of = {}

def ensure_node(key, name='', year='', gender=''):
    if key not in nodes:
        nodes[key] = {'name': name, 'year': year, 'gender': gender, 'char': None}
    else:
        if name and not nodes[key]['name']:
            nodes[key]['name'] = name
        if year and not nodes[key]['year']:
            nodes[key]['year'] = year
        if gender and not nodes[key]['gender']:
            nodes[key]['gender'] = gender
    return key

def add_edge(pkey, ckey):
    children_of.setdefault(pkey, set()).add(ckey)
    parents_of.setdefault(ckey, set()).add(pkey)

for c in chars:
    cid = c['id']
    if cid in HUMAN_IDS:
        continue
    r = results.get(cid, {})
    if 'error' in r:
        # character without pedigree data -> standalone char node
        key = 'char:' + cid
        ensure_node(key, c['name_ja'])
        nodes[key]['char'] = cid
        continue
    hid = r['horse_id']
    key = hid
    ensure_node(key, c['name_ja'])
    nodes[key]['char'] = cid
    # parent edges from col0
    for p in r.get('parents', []):
        pname, phref = p['name'], p['href']
        if phref:
            m = re.search(r'/horse/([0-9a-f]{6,})/', phref)
            if m:
                pkey = m.group(1)
                ensure_node(pkey, pname, p.get('year', ''), p.get('gender', ''))
                add_edge(pkey, key)
    # ancestor edges: (A,B) means B is a parent of A (A=child, B=parent)
    for (aname, ahref, agender, ayear, cname, chref) in r.get('edges', []):
        am = re.search(r'/horse/([0-9a-f]{6,})/', ahref or '')
        cm = re.search(r'/horse/([0-9a-f]{6,})/', chref or '')
        if not am or not cm:
            continue
        ak, ck = am.group(1), cm.group(1)
        ensure_node(ak, aname, ayear, agender)
        ensure_node(ck, cname)
        add_edge(ck, ak)  # parent -> child

print('nodes:', len(nodes), 'edges:', sum(len(v) for v in children_of.values()))
# level computation: level = min distance from a character (char=0)
level = {}
for key, nd in nodes.items():
    if nd['char']:
        level[key] = 0
changed = True
guard = 0
while changed and guard < 50:
    changed = False
    guard += 1
    for ckey, plist in parents_of.items():
        if ckey not in level:
            continue
        for p in plist:
            nl = level[ckey] + 1
            if p not in level or nl < level[p]:
                level[p] = nl
                changed = True

maxlvl = max(level.values()) if level else 0
print('levels:', {l: sum(1 for k in level if level[k] == l) for l in range(maxlvl + 1)})

# orphan ancestors not reachable (shouldn't happen) - default level 1
for key in nodes:
    if key not in level:
        level[key] = 1

# assign char info to nodes (zh name, avatar)
for key, nd in nodes.items():
    cid = nd['char']
    if cid:
        c = char_by_id[cid]
        nd['zh'] = c['name_zh']
        av = avatars.get(cid)
        nd['avatar'] = ('uma_avatars/' + av) if av else ('uma_official/' + cid + '.png')
        nd['char_id'] = cid

graph = {
    'nodes': nodes,
    'children_of': {k: sorted(v) for k, v in children_of.items()},
    'parents_of': {k: sorted(v) for k, v in parents_of.items()},
    'levels': level,
}
open(os.path.join(TMP, 'pedigree_graph.json'), 'w', encoding='utf-8').write(
    json.dumps(graph, ensure_ascii=False, indent=1))
print('saved pedigree_graph.json')
