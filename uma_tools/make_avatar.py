# -*- coding: utf-8 -*-
"""头像生成器v2：严格复刻已认可构图(compose_v9) + 投影/软边后处理
用法: python3 make_avatar.py <cid> <透明立绘路径> [窗边长覆盖值]
"""
import io, re, sys, os, json
from PIL import Image, ImageDraw, ImageChops, ImageFilter

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS_DIR)

def hex2rgb(hx):
    hx = hx.lstrip('#')
    return tuple(int(hx[i:i+2], 16) for i in (0, 2, 4))

def compose_avatar(win, main_rgb):
    """Compose a square bust on the established coloured circular background."""
    win = win.convert('RGBA')
    side = win.width
    S, W, DIAM, BUST = 4, 800, 780, 720
    bust = win.resize((BUST, BUST), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    shadow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse((44, 58, 44 + DIAM, 58 + DIAM), fill=(15, 12, 35, 185))
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(26)))
    ImageDraw.Draw(canvas).ellipse((10, 10, W - 10, W - 10), fill=main_rgb + (255,))
    alpha = win.getchannel('A')
    hist_w = hist_x = 0
    for y in range(win.height):
        for x in range(win.width):
            value = alpha.getpixel((x, y))
            if value > 120:
                hist_w += value
                hist_x += x * value
    centre = hist_x / hist_w if hist_w else side / 2
    canvas.paste(bust, (round(W / 2 - centre / side * BUST), 11 * S), bust)
    mask = Image.new('L', (W, W), 0)
    ImageDraw.Draw(mask).ellipse((10, 10, W - 10, W - 10), fill=255)
    canvas.putalpha(ImageChops.multiply(canvas.getchannel('A'), mask.filter(ImageFilter.GaussianBlur(26))))
    return canvas.resize((200, 200), Image.Resampling.LANCZOS)

def main():
    cid = sys.argv[1]
    art_path = sys.argv[2]
    override = int(sys.argv[3]) if len(sys.argv) > 3 else None

    t = io.open(os.path.join(ROOT, 'data', 'character_index_data.js'), encoding='utf-8').read()
    _i = t.find('['); _j = t.rfind(']')
    chars = json.loads(t[_i:_j + 1])
    main_hex = next((c.get('main', '#8c83ff') for c in chars if c['id'] == cid), '#8c83ff')
    main_rgb = hex2rgb(main_hex)

    src = Image.open(art_path).convert('RGBA')
    bb = src.split()[3].point(lambda v: 255 if v > 60 else 0).getbbox()
    if bb: src = src.crop(bb)

    w, h = src.size
    a = src.split()[3].load()
    spans = []
    for y in range(h):
        lo = hi = None
        for x in range(w):
            if a[x, y] > 60:
                if lo is None: lo = x
                hi = x
        spans.append((lo, hi) if lo is not None else None)
    top = next(y for y, s in enumerate(spans) if s)
    probe_end = min(h, top + int(h * 0.12))
    face_w = max(s[1] - s[0] for s in spans[top:probe_end] if s) or int(w * 0.2)
    shoulder = next((y for y in range(top, h) if spans[y] and (spans[y][1] - spans[y][0]) > face_w * 1.9),
                    top + int(h * 0.16))
    cx = (spans[top][0] + spans[top][1]) // 2

    # 已认可窗口：真诚440 / 乐透心430 / 蝴蝶兰420（可覆盖）
    DEFAULTS = {'genuine': 440, 'efforia': 430, 'phalaenopsis': 420}
    side = override or DEFAULTS.get(cid, int(max(face_w / 0.55, (shoulder - top) * 1.15)))

    x0 = max(0, min(w - side, cx - side // 2))
    y0 = max(0, min(h - side, top - int(side * 0.06)))
    win = src.crop((x0, y0, min(w, x0 + side), min(h, y0 + side)))
    if win.size[0] != win.size[1]:
        sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        sq.paste(win, ((side - win.size[0]) // 2, 0))
        win = sq

    final = compose_avatar(win, main_rgb)

    dst = os.path.join(ROOT, 'uma_avatars', cid + '.png')
    final.save(dst, optimize=True)
    print('%s -> %s | 窗=%d' % (cid, dst, side))

if __name__ == '__main__':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    main()
