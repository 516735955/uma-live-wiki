# -*- coding: utf-8 -*-
import re, json, os, urllib.request, ssl, time

base = r"C:\Users\51673\AppData\Local\Temp\opencode"
moe = open(base + r"\moe_dengchang.html", encoding="utf-8").read()
chars = json.load(open(base + r"\final_characters_moe.json", encoding="utf-8"))

ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE

def extract_block(html, start):
    """From the index of '<div class="umamusume-intro"', return the balanced div block."""
    depth = 0
    i = start
    while i < len(html):
        if html.startswith("<div", i) and (len(html) <= i+4 or html[i+4] in " \t\r\n>/"):
            depth += 1
        elif html.startswith("</div>", i):
            depth -= 1
            if depth == 0:
                return html[start:i+6]
            i += 6
            continue
        i += 1
    return html[start:]

# collect all blocks with their titles
blocks = []
idx = 0
while True:
    i = moe.find('<div class="umamusume-intro"', idx)
    if i < 0: break
    b = extract_block(moe, i)
    m = re.search(r'<a href="(/[^"]+)" title="([^"]*)"', b)
    href = m.group(1) if m else ""
    title = m.group(2) if m else ""
    blocks.append({"href": href, "title": title, "html": b})
    idx = i + len(b)
print("blocks:", len(blocks))

# index by title (stripped of parens) and by href
def strip_paren(t):
    return re.sub(r"\s*\(.*?\)\s*$", "", t).strip()
by_href = {}
by_title = {}
for b in blocks:
    by_href[b["href"]] = b
    by_title.setdefault(strip_paren(b["title"]), []).append(b)

# map each char to a block
for ch in chars:
    path = ch.get("page", "").replace("https://zh.moegirl.org.cn", "")
    b = by_href.get(path) or (by_title.get(strip_paren(ch["zh"])) or [None])[0]
    if b:
        ch["block_html"] = b["html"]
        ch["block_found"] = True
    else:
        ch["block_found"] = False
print("mapped:", sum(1 for c in chars if c.get("block_found")), "/", len(chars))

# download images and rewrite blocks
img_re = re.compile(r'<img src="([^"]+)"[^>]*>')
def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=40, context=ctx).read()
    open(dest, "wb").write(data)

os.makedirs(r"G:\学习\AI\uma_moe", exist_ok=True)
detail = {}
missing = []
for ch in chars:
    if not ch.get("block_found"):
        missing.append(ch["id"]); continue
    h = ch["block_html"]
    m = re.search(r'<img src="([^"]+)"', h)
    if not m:
        missing.append(ch["id"]); continue
    src = m.group(1)
    # plain file = strip CDN pipeline suffix
    plain = src.split("!/")[0]
    dest = r"G:\学习\AI\uma_moe" + "\\" + ch["id"] + ".png"
    if not os.path.exists(dest) or os.path.getsize(dest) < 1000:
        try:
            download(plain, dest)
            print("img", ch["id"], os.path.getsize(dest))
        except Exception as e:
            print("IMGFALL", ch["id"], e)
            dest = ""
    # rewrite: replace the whole img tag with a local img
    new_img = '<img src="/uma_moe/' + ch["id"] + '.png" alt="' + (ch["zh"] or "") + '" class="mw-file-element">'
    h2 = img_re.sub(new_img, h, count=1)
# rewrite internal links to mobile moegirl absolute
    h2 = re.sub(r'href="/([^"]*)"', r'href="https://mobile.moegirl.org.cn/\1"', h2)
    detail[ch["id"]] = {
        "html": h2,
        "zh": ch["zh"], "ja": ch.get("ja", ""), "en": ch.get("en", ""),
        "cv_zh": ch.get("cv_zh", ""), "color": ch.get("color", "")
    }

print("detail count:", len(detail), "missing:", missing)

# write JS data file
lines = ["window.CHAR_DETAIL = {"]
for i, (cid, d) in enumerate(detail.items()):
    comma = "," if i < len(detail) - 1 else ""
    obj = json.dumps(d, ensure_ascii=False)
    lines.append("  '%s': %s%s" % (cid, obj, comma))
lines.append("};")
out = "\n".join(lines)
open(r"G:\学习\AI\character_detail_data.js", "w", encoding="utf-8").write(out)
print("wrote character_detail_data.js", os.path.getsize(r"G:\学习\AI\character_detail_data.js"))