# -*- coding: utf-8 -*-
import json, os, base64, io, html

BASE = r'G:\学习\AI'
TMP = r'C:\Users\51673\AppData\Local\Temp\opencode'
ROLE_DIR = os.path.join(BASE, 'role_svgs')
os.makedirs(ROLE_DIR, exist_ok=True)

from PIL import Image

g = json.load(open(TMP + r'\pedigree_graph.json', encoding='utf-8'))
nodes = g['nodes']
parents_of = g['parents_of']
levels = g['levels']

esc = html.escape

def thumb_b64(nd, px=64):
    cid = nd.get('char')
    if nd.get('avatar') and 'uma_avatars/' in nd.get('avatar', ''):
        p = os.path.join(BASE, 'uma_avatars', os.path.basename(nd['avatar']))
    else:
        p = os.path.join(BASE, 'uma_official', cid + '.png')
    if not os.path.exists(p):
        return ''
    try:
        im = Image.open(p).convert('RGBA')
        im.thumbnail((px, px))
        b = io.BytesIO()
        im.save(b, 'PNG')
        return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()
    except Exception:
        return ''

def role_svg(cid, nd):
    NODE_W = 96
    NODE_H = 34
    ROOT_W = 140
    ROW_H = 58
    TOP = 46
    MARGIN = 30
    HGAP = 10
    unit = NODE_W + HGAP

    # subtree width in leaf units (cached by k+depth)
    cache = {}
    def subw(k, d):
        if d >= 5:
            return 1
        key = (k, d)
        if key in cache:
            return cache[key]
        ps = [p for p in parents_of.get(k, []) if p in nodes]
        w = sum(subw(p, d + 1) for p in ps) if ps else 1
        cache[key] = w
        return w

    # recursive placement producing occurrences + edges
    occ = []     # {k, d, cx(units)}
    edges = []   # (parent_occ_idx, child_occ_idx)
    def place(k, d, xoff):
        if d > 5:
            return None
        wself = subw(k, d)
        cx = xoff + wself / 2.0
        idx = len(occ)
        occ.append({'k': k, 'd': d, 'cx': cx})
        x = xoff
        if d == 5:
            return idx
        for p in parents_of.get(k, []):
            if p not in nodes:
                continue
            cidx = place(p, d + 1, x)
            edges.append((idx, cidx))
            x += subw(p, d + 1)
        return idx

    root = cid
    place(root, 0, 0)

    px = {i: MARGIN + (o['cx'] - 0.5) * unit for i, o in enumerate(occ)}
    py = {i: TOP + o['d'] * ROW_H for i, o in enumerate(occ)}

    total_w = MARGIN * 2 + max(subw(root, 0) * unit, ROOT_W) + 30
    H = TOP + 6 * ROW_H + 40
    W = int(total_w)

    parts = []
    parts.append('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" font-family="Segoe UI, Arial, sans-serif">' % (W, H))
    parts.append('<text x="%d" y="28" font-size="20" font-weight="700" fill="#333">%s（%s）%s</text>' %
                 (MARGIN, esc(nd.get('zh') or ''), esc(nd.get('name') or ''), esc(nd.get('bd') or nd.get('year') or '')))

    # edges
    for pi, ci in edges:
        x1, y1 = px[pi], py[pi] + NODE_H
        x2, y2 = px[ci], py[ci]
        # pull child connector toward parent center if boxes face each other
        if abs(x2 - x1) > unit - NODE_W + 2:
            x2 = x1 + (unit - NODE_W + 2) / 2.0 * (1 if x2 > x1 else -1)
        my = (y1 + y2) / 2
        parts.append('<path d="M %s %s L %s %s L %s %s" fill="none" stroke="#b9b3c9" stroke-width="1"/>' %
                     (round(x1, 1), round(y1, 1), round(x1, 1), round(my, 1), round(x2, 1), round(y2, 1)))

    # boxes grouped so same depth draws in order
    for o in occ:
        k, d, i = o['k'], o['d'], o['k']
        x = px[occ.index(o)]
        y = py[occ.index(o)]
        m = nodes[k]
        if k == root:
            parts.append('<rect x="%s" y="%s" width="%s" height="%s" rx="8" fill="#fff6f9" stroke="#e0759f" stroke-width="1.5"/>'
                         % (round(x - ROOT_W / 2, 1), round(y, 1), ROOT_W, NODE_H + 10))
            av = thumb_b64(nd)
            if av:
                parts.append('<image x="%s" y="%s" width="44" height="44" href="%s"/>'
                             % (round(x - ROOT_W / 2 + 4, 1), round(y + 5, 1), av))
            parts.append('<text x="%s" y="%s" font-size="14" font-weight="700" fill="#8a3b5e">%s</text>'
                         % (round(x - ROOT_W / 2 + 54, 1), round(y + 20, 1), esc(m.get('zh') or m.get('name') or '')))
            parts.append('<text x="%s" y="%s" font-size="9" fill="#b0768f">%s</text>'
                         % (round(x - ROOT_W / 2 + 54, 1), round(y + 33, 1), esc(m.get('bd') or m.get('year') or '')))
        else:
            gcol = '#4a7ac7' if m.get('gender') == 'M' else ('#d9577c' if m.get('gender') == 'F' else '#777')
            parts.append('<rect x="%s" y="%s" width="%s" height="%s" rx="6" fill="#f4f2fa" stroke="%s"/>'
                         % (round(x - NODE_W / 2, 1), round(y, 1), NODE_W, NODE_H, gcol))
            nm = m.get('name') or ''
            bd = m.get('bd') or ''
            yl = m.get('year') or ''
            if bd:
                parts.append('<text x="%s" y="%s" font-size="10.5" font-weight="600" fill="%s" text-anchor="middle">%s</text>'
                             % (round(x, 1), round(y + 13, 1), gcol, esc(nm)))
                parts.append('<text x="%s" y="%s" font-size="8.5" fill="#999" text-anchor="middle">%s</text>'
                             % (round(x, 1), round(y + 26, 1), bd))
            elif yl:
                parts.append('<text x="%s" y="%s" font-size="10.5" font-weight="600" fill="%s" text-anchor="middle">%s</text>'
                             % (round(x, 1), round(y + 13, 1), gcol, esc(nm)))
                parts.append('<text x="%s" y="%s" font-size="8.5" fill="#999" text-anchor="middle">%s</text>'
                             % (round(x, 1), round(y + 26, 1), yl))
            else:
                parts.append('<text x="%s" y="%s" font-size="10" font-weight="600" fill="%s" text-anchor="middle">%s</text>'
                             % (round(x, 1), round(y + 20, 1), gcol, esc(nm)))
    parts.append('</svg>')
    return '\n'.join(parts)

def fs_name(k):
    return k.replace(':', '_')

chars = [k for k in nodes if nodes[k].get('char') and levels.get(k) == 0]
print('characters:', len(chars), 'nodes total:', len(nodes))

n_bytes = 0
for k in chars:
    svg = role_svg(k, nodes[k])
    out = os.path.join(ROLE_DIR, fs_name(k) + '.svg')
    open(out, 'w', encoding='utf-8').write(svg)
    n_bytes += len(svg)
print('role svgs written:', len(chars), 'total KB:', n_bytes // 1024)

# ---- data.js ----
chars_sorted = sorted(chars, key=lambda k: (nodes[k].get('zh') or '', nodes[k].get('name') or ''))
def js_str(s):
    return json.dumps(s, ensure_ascii=False)
items = []
for k in chars_sorted:
    nd = nodes[k]
    items.append('{id:%s,cid:%s,fs:%s,zh:%s,name:%s,year:%s,bd:%s,av:%s}' % (
        js_str(k), js_str(nd.get('char') or ''), js_str(fs_name(k)),
        js_str(nd.get('zh') or ''), js_str(nd.get('name') or ''),
        js_str(nd.get('year') or ''), js_str(nd.get('bd') or ''), js_str(thumb_b64(nd, 64))))
datajs = 'const UMACHARA = [\n' + ',\n'.join(items) + '\n];\n'
out = os.path.join(BASE, 'archive', 'legacy-pedigree', '血统表_data.js')
open(out, 'w', encoding='utf-8').write(datajs)
print('data.js written:', out, 'KB:', os.path.getsize(out) // 1024)
