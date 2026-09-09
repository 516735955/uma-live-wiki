# -*- coding: utf-8 -*-
# Crawl ウマ娘 Lantis 公式 site (umamusume.lantis.jp) news category + live category.
# Output: lantis_news.json  (list of {id, date, title, url, category})
# Approach: crawl paginated list pages, parse <span class="list_time">date</span>
# then <a href="url">title</a> inside <ul class="news_list"><li>...</li>.
import re, io, json, sys, time, urllib.request, ssl, os, tempfile

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lantis_news.json')
MAX_PAGES = 30  # upper bound safety

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

def write_json_atomic(path, value):
    fd, tmp = tempfile.mkstemp(prefix='.lantis-', suffix='.tmp', dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

def fetch(url, timeout=20):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        return r.read().decode('utf-8', errors='ignore')

def parse_list(html):
    """Extract (date, url, title) triples from a news_list ul."""
    out = []
    # <li> <span class="list_time">2026.08.23</span> <a href="...">title</a> </li>
    for li in re.findall(r'<li>(.*?)</li>', html, re.S):
        dm = re.search(r'<span class="list_time">([^<]+)</span>', li)
        am = re.search(r'<a href="([^"]+)"[^>]*>([\s\S]*?)</a>', li)
        if not dm or not am:
            continue
        date = dm.group(1).strip()
        url = am.group(1).strip()
        title = re.sub(r'<[^>]+>', '', am.group(2)).strip()
        if date and url:
            out.append((date, url, title))
    return out

def crawl_category(base, pageless, seen):
    """base: the URL for page 1 (no /page/N/); pageless: base without trailing slash for page links."""
    items = []
    page = 1
    while page <= MAX_PAGES:
        if page == 1:
            url = base
        else:
            url = pageless + '/page/' + str(page) + '/'
        try:
            html = fetch(url)
        except Exception as e:
            print('fetch fail', url, e)
            break
        got = parse_list(html)
        if not got:
            break
        added = 0
        for date, u, title in got:
            key = u
            if key in seen:
                continue
            seen.add(key)
            # id = digits from URL
            mid = re.search(r'/(\d+)/?$', u)
            nid = ('lantis-' + mid.group(1)) if mid else ('lantis-' + str(abs(hash(u)) & 0xFFFFFF))
            items.append({'id': nid, 'date': date, 'url': u, 'title': title, 'category': 'cd'})
            added += 1
        print('category page', page, 'got', len(got), 'new', added)
        if added == 0:
            break
        # find NEXT link
        if '<div class="ban_more">' in html and 'NEXT' not in html:
            break
        page += 1
        time.sleep(0.4)
    return items

def extract_image(article_html):
    """Return the first real content image in a Lantis article, else og:image/None."""
    # Prefer images inside the article body (.innercon) — first <img> or its picture source.
    body = article_html
    m = re.search(r'<div class="innercon">(.*?)</div>\s*<div class="ban_more">', article_html, re.S)
    if m:
        body = m.group(1)
    # 1) picture > source srcset (webp)
    m = re.search(r'<source[^>]+srcset="([^"]+)"', body)
    if m:
        return m.group(1).strip()
    # 2) explicit <img src>
    m = re.search(r'<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"', body)
    if m:
        return m.group(1).strip()
    # 3) og:image
    m = re.search(r'<meta property="og:image" content="([^"]+)"', article_html)
    if m:
        return m.group(1).strip()
    return None

def ensure_images(items, max_fetch=None):
    """Attach 'image' to each item by fetching the article page; skip items that already have one."""
    fetched = 0
    for it in items:
        if it.get('image'):
            continue
        if max_fetch is not None and fetched >= max_fetch:
            break
        try:
            html = fetch(it['url'])
        except Exception as e:
            print('  img fetch fail', it['url'], e)
            continue
        img = extract_image(html)
        if img:
            it['image'] = img
        fetched += 1
        if fetched % 20 == 0:
            print('  images so far:', fetched)
        time.sleep(0.25)
    return items

def main():
    seen = set()
    items = []
    # Preserve previously-crawled images/ids so re-runs are cheap.
    old = {}
    try:
        for it in json.load(io.open(OUT, encoding='utf-8')):
            old[it['id']] = it
    except Exception:
        old = {}
    # NEWS category
    items += crawl_category('https://umamusume.lantis.jp/category/news/', 'https://umamusume.lantis.jp/category/news', seen)
    # LIVE category
    items += crawl_category('https://umamusume.lantis.jp/live/', 'https://umamusume.lantis.jp/category/live', seen)
    # dedupe + sort by date desc
    seen_ids = set()
    uniq = []
    for it in items:
        if it['id'] in seen_ids:
            continue
        seen_ids.add(it['id'])
        if it['id'] in old and old[it['id']].get('image'):
            it['image'] = old[it['id']]['image']
        uniq.append(it)
    def date_key(it):
        p = it['date'].split('.')
        while len(p) < 3:
            p.append('00')
        return [int(x) for x in p[:3]]
    uniq.sort(key=date_key, reverse=True)
    # Fetch article images (bounded to the newest few on this run; cached across runs).
    ensure_images(uniq, max_fetch=40)
    write_json_atomic(OUT, uniq)
    print('total', len(uniq), 'with images:', sum(1 for it in uniq if it.get('image')), '->', OUT)

if __name__ == '__main__':
    main()
