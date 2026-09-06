import re, html as h

c = open(r'C:\Users\51673\AppData\Local\Temp\opencode\nk_ped_full.html', encoding='utf-8').read()

# find blood_table detail
i = c.find('blood_table')
i = c.find('<tr>', i)
end = c.find('</table>', i)
seg = c[i:end]

# tokenize tr/td
rows_html = re.findall(r'<tr>(.*?)</tr>', seg, re.S)

def clean(s):
    s = re.sub(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', lambda m: '\x01' + m.group(1) + '\x02' + m.group(2), s, flags=re.S)
    s = re.sub(r'<br\s*/?>', ' | ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = h.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

# build grid
grid = {}  # (row, col) -> dict(rowspan, name, href, text)
occupied = {}  # (row, col) -> remaining rowspans
cells = []
for ri, rhtml in enumerate(rows_html):
    tds = re.findall(r'<td([^>]*)>(.*?)</td>', rhtml, re.S)
    col = 0
    for attrs, body in tds:
        while occupied.get((ri, col), 0) > 0:
            col += 1
        rs = int(re.search(r'rowspan="(\d+)"', attrs).group(1)) if 'rowspan' in attrs else 1
        links = re.findall(r'href="([^"]*)"[^>]*>\s*([^<]+?)\s*<', body)
        name = None
        href = None
        a = re.search(r'<a href="([^"]+)">([^<]+)', body)
        if a:
            href = a.group(1)
            name = re.sub(r'[\s|]+', ' ', a.group(2)).strip()
        cell = {'row': ri, 'col': col, 'rs': rs,
                'name': name or re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', body)).strip(),
                'href': href}
        grid[(ri, col)] = cell
        cells.append(cell)
        for rr in range(ri, ri + rs):
            occupied[(rr, col)] = occupied.get((rr, col), 0) + 1
        col += 1

# build edges: for each cell, children at col+1 within [row, row+rs)
edges = []
for cell in cells:
    r, cc, rs = cell['row'], cell['col'], cell['rs']
    kids = [grid[(rr, cc + 1)] for rr in range(r, r + rs) if (rr, cc + 1) in grid]
    # keep only start rows (those whose rowspan begins here)
    kids_sorted = sorted(kids, key=lambda k: k['row'])
    # dedupe: a child occupies multiple rows; keep unique start rows
    starts = []
    for k in kids_sorted:
        if not starts or k['row'] >= starts[-1][1]:
            starts.append((k, k['row'] + k['rs']))
    for k, _ in starts[:2]:
        edges.append((cell, k))

print('cells:', len(cells))
def nm(x):
    return x['name'][:40]
for cell in cells:
    kids = [k for (p, k) in edges if p is cell]
    print('G%d %s  ->  %s' % (cell['col'], nm(cell), ' ; '.join(nm(k) for k in kids)))
