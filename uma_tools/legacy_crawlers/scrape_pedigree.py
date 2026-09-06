# -*- coding: utf-8 -*-
import json, os, re, time, urllib.request, urllib.parse, html as H

BASE = r'G:\学习\AI'
TMP = r'C:\Users\51673\AppData\Local\Temp\opencode'
STATE = os.path.join(TMP, 'pedigree_state.json')

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

def fetch(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            raw = urllib.request.urlopen(req, timeout=40).read()
            for e in ['utf-8', 'euc_jp', 'cp932']:
                try:
                    return raw.decode(e)
                except Exception:
                    continue
            return raw.decode('utf-8', 'replace')
        except Exception as ex:
            time.sleep(1.2 * (i + 1))
    return ''

def search_horse(ja):
    w = urllib.parse.quote(ja)
    c = fetch('https://db.netkeiba.com/?pid=horse_list&word=' + w)
    if not c:
        return None
    links = re.findall(r'href="(/horse/([0-9a-f]+)/)"[^>]*title="([^"]*)"', c)
    if not links:
        return None
    ja_norm = re.sub(r'\s+', '', ja)
    for href, hid, title in links:
        if re.sub(r'\s+', '', title) == ja_norm:
            return hid
    return links[0][1]

def parse_pedigree(c):
    i = c.find('blood_table')
    if i < 0:
        return None
    i = c.find('<tr>', i)
    j = c.find('</table>', i)
    if j < 0:
        return None
    seg = c[i:j]
    rows_html = re.findall(r'<tr>(.*?)</tr>', seg, re.S)
    grid = {}
    occupied = {}
    cells = []
    for ri, rhtml in enumerate(rows_html):
        tds = re.findall(r'<td([^>]*)>(.*?)</td>', rhtml, re.S)
        col = 0
        for attrs, body in tds:
            while occupied.get((ri, col), 0) > 0:
                col += 1
            rs = 1
            m = re.search(r'rowspan="(\d+)"', attrs)
            if m:
                rs = int(m.group(1))
            a = re.search(r'<a href="([^"]+)">(.*?)</a>', body, re.S)
            name = ''
            href = None
            if a:
                href = a.group(1)
                inner = a.group(2)
                lines = [re.sub(r'\s+', '', ln) for ln in inner.split('<br')]
                name = lines[0] if lines and lines[0] else ''
            year = ''
            ym = re.search(r'(18\d{2}|19\d{2}|20\d{2})', body)
            if ym:
                year = ym.group(1)
            gender = 'M' if 'b_ml' in attrs else ('F' if 'b_fml' in attrs else '')
            cell = {'row': ri, 'col': col, 'rs': rs, 'name': name, 'href': href,
                    'year': year, 'gender': gender}
            grid[(ri, col)] = cell
            cells.append(cell)
            for rr in range(ri, ri + rs):
                occupied[(rr, col)] = occupied.get((rr, col), 0) + 1
            col += 1

    edges = []
    for cell in cells:
        r, cc, rs = cell['row'], cell['col'], cell['rs']
        kids = [grid[(rr, cc + 1)] for rr in range(r, r + rs) if (rr, cc + 1) in grid]
        kids.sort(key=lambda k: k['row'])
        starts = []
        for k in kids:
            if not starts or k['row'] >= starts[-1][1]:
                starts.append((k, k['row'] + k['rs']))
        for k, _ in starts[:2]:
            edges.append((cell['name'], cell['href'], cell['gender'], cell['year'],
                          k['name'], k['href']))
    # subject's parents: col0 cells
    parents = [grid[(rr, 0)] for rr in range(0, 32) if (rr, 0) in grid]
    return cells, edges, parents

def main():
    state = {}
    if os.path.exists(STATE):
        state = json.load(open(STATE, encoding='utf-8'))
    chars = json.load(open(os.path.join(BASE, 'characters_data.json'), encoding='utf-8'))['characters']
    done = state.get('done', [])
    results = state.get('results', {})
    for c in chars:
        cid = c['id']
        if cid in done:
            continue
        hid = search_horse(c['name_ja'])
        if not hid:
            results[cid] = {'error': 'no search result'}
            done.append(cid)
            state['done'] = done; state['results'] = results
            json.dump(state, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)
            print('NO SEARCH:', cid, c['name_ja'])
            continue
        pg = fetch('https://db.netkeiba.com/horse/ped/' + hid + '/')
        if not pg:
            results[cid] = {'error': 'ped fetch failed', 'horse_id': hid}
            done.append(cid)
            json.dump(state, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)
            print('PED FAIL:', cid)
            continue
        parsed = parse_pedigree(pg)
        if parsed is None:
            results[cid] = {'error': 'no blood_table', 'horse_id': hid}
            done.append(cid)
            json.dump(state, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)
            print('NO TABLE:', cid, hid)
            continue
        cells, edges, parents = parsed
        results[cid] = {'horse_id': hid, 'edges': edges,
                        'parents': [{'name': p['name'], 'href': p['href'],
                                     'gender': p['gender'], 'year': p['year']} for p in parents]}
        done.append(cid)
        state['done'] = done; state['results'] = results
        json.dump(state, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)
        print('OK %3d/%-3d %s (%s) parents=%s' % (len(done), len(chars), cid, hid,
              [p['name'] for p in results[cid]['parents']]))
        time.sleep(0.25)

    print('\nDONE total:', len(done), '/', len(chars))
    errs = {k: v for k, v in results.items() if 'error' in v}
    print('errors:', len(errs))
    for k, v in errs.items():
        print('   ', k, v)

if __name__ == '__main__':
    main()
