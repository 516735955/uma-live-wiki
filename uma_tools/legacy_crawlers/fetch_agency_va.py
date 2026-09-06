# -*- coding: utf-8 -*-
"""Fetch VA headshots from agency profile pages (og:image), merge into manifest."""
import urllib.request, urllib.parse, json, re, os, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from PIL import Image

ROOT = r'G:\学习\AI'
OUT_DIR = os.path.join(ROOT, 'uma_va')
MANIFEST = os.path.join(ROOT, 'va_photos_data.js')
STATE = r'C:\Users\51673\AppData\Local\Temp\opencode\va_photo_state2.json'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.google.com/'}

# name -> (candidate profile pages, twitter handle for link, birth)
TARGETS = {
    '秋山实咲':   (['https://www.aoni.co.jp/search/akiyama-misaki.html'], 'misaki_aoni', '8月2日'),
    '望月裕美子': (['https://www.kenproduction.co.jp/talent/239'], 'mochi_yumi25', '5月25日'),
    '野木奏':     (['https://haikyo.co.jp/profile/profile.php?ActorID=13118'], 'kana_nogi0911', '9月11日'),
    '真名濑日和': (['https://inspion-agc.co.jp/ja/talent/manase-hiyori/'], 'Hiyori_Manase', '2月27日'),
    '小田杏树':   (['https://axl-one.com/talent/oda.html'], 'Anju_oda0130', '1月30日'),
    '折原日菜':   (['https://hina-orihara.bitfan.id/', 'https://thetv.jp/person/2000069242/'], 'Hina_orihara_', '5月8日'),
    '井料爱良':   (['https://thetv.jp/person/2000075486/'], 'Aira_Iryo', '9月19日'),
}

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=35).read()

def get_html(url):
    return fetch(url).decode('utf-8', 'replace')

def abs_url(u, base):
    if u.startswith('//'): return 'https:' + u
    if u.startswith('/'):
        m = re.match(r'(https?://[^/]+)', base)
        return (m.group(1) if m else '') + u
    return u

def find_img(html, base):
    # prefer og:image, then twitter:image, then profile-ish imgs
    m = re.search(r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["\'][^>]+content=["\']([^"\']+)["\']', html, re.I)
    if not m:
        m = re.search(r'content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\']', html, re.I)
    cands = []
    if m:
        cands.append(abs_url(m.group(1), base))
    for im in re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', html, re.I):
        low = im.lower()
        if any(k in low for k in ('profile', 'talent', 'actor', 'main', 'face')):
            cands.append(abs_url(im, base))
    return cands

def sanitize(name):
    s = re.sub(r'[^\w\u4e00-\u9fff\u3040-\u30ff\u3005\u3006\u30fc]+', '_', str(name))
    return s.strip('_') or 'va'

src = open(MANIFEST, encoding='utf-8').read()
manifest = json.loads(re.search(r'window\.VA_PHOTOS\s*=\s*(\{.*\});?\s*$', src, re.S).group(1))
st = json.load(open(STATE, encoding='utf-8')) if os.path.exists(STATE) else {}

for key, (pages, handle, birth) in TARGETS.items():
    fn = 'va_%s.jpg' % sanitize(key)
    final = os.path.join(OUT_DIR, fn)
    saved = False
    for page in pages:
        if saved: break
        try:
            html = get_html(page)
        except Exception as ex:
            print('%s: page FAIL %s (%s)' % (key, page, str(ex)[:70]))
            continue
        got = False
        for img_url in find_img(html, page)[:6]:
            try:
                data = fetch(img_url)
                tmp = final + '.tmp'
                open(tmp, 'wb').write(data)
                img = Image.open(tmp); img.load()
                w, h = img.size
                # reject banners/icons: want roughly portrait-to-square
                if w < 120 or h < 120 or w / h > 2.2:
                    os.remove(tmp); continue
                if img.mode != 'RGB':
                    bg = Image.new('RGB', img.size, (255, 255, 255))
                    if img.mode in ('RGBA', 'LA', 'P'):
                        bg.paste(img.convert('RGBA'), mask=img.convert('RGBA').split()[-1])
                    else:
                        bg.paste(img)
                    img = bg
                if h > w * 2.4:
                    img = img.crop((0, 0, w, int(w * 1.5)))
                w2, h2 = img.size
                if max(w2, h2) > 300:
                    if w2 >= h2:
                        img = img.resize((300, int(h2 * 300 / w2)), Image.LANCZOS)
                    else:
                        img = img.resize((int(w2 * 300 / h2), 300), Image.LANCZOS)
                img.save(final, 'JPEG', quality=75, optimize=True)
                os.remove(tmp)
                print('%s OK <- %s | %s (%dx%d)' % (key, page, img_url[:80], w, h))
                entry = {'img': '/uma_va/' + fn, 'page': 'https://x.com/' + handle, 'title': '@' + handle, 'birth': birth}
                manifest[key] = entry
                st[key] = {'ok': True, 'entry': entry}
                got = saved = True
                break
            except Exception as ex:
                try: os.remove(tmp)
                except Exception: pass
        if not got:
            print('%s: no usable image on %s' % (key, page))

json.dump(st, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False)
out = ['// auto-generated by fetch_va_photos_moegirl.py']
out.append('window.VA_PHOTOS = %s;' % json.dumps(manifest, ensure_ascii=False))
open(MANIFEST, 'w', encoding='utf-8').write('\n'.join(out))
missing = [k for k in TARGETS if k not in manifest]
print('DONE total=%d missing=%s' % (len(manifest), missing or 'none'))
