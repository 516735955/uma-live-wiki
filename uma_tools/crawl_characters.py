# -*- coding: utf-8 -*-
"""每日增量：新角色 + 新声优 管线
流程（与 角色与声优爬取流程.md 对应）:
  阶段0 门禁: 萌百登场人物页须已收录新角色(含中文名/CV)
  阶段1 入库: 官方立绘/头像下载, CHAR_INDEX追加并按官方顺序重排
  阶段1.5:   保存 uma_moe 透明立绘；头像默认使用阶段1下载的官方图标
  阶段2:     角色详情(intro本地化)追加进 character_detail_data.js
  阶段3:     提示维护 pedigree_source.json，再生成并校验浏览器血统数据
  阶段4:     新声优照片/生日(Moegill优先)并入 va_photos_data.js
用法: python crawl_characters.py
"""
import io, re, json, sys, os, time, urllib.request, urllib.parse, tempfile
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from PIL import Image, ImageDraw, ImageChops
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'data')
OFFICIAL = 'https://umamusume.jp/character/'
MOE_LIST = ('https://mobile.moegirl.org.cn/%E8%B5%9B%E9%A9%AC%E5%A8%98_Pretty_Derby/'
            '%E7%99%BB%E5%9C%BA%E4%BA%BA%E7%89%A9')
DATE_RE = re.compile(r'(19|20)\d{2}年\d{1,2}月\d{1,2}日')
# 人工翻译/校对过角色介绍的白名单:爬虫不得覆盖这些角色的详情描述
MANUAL_DESC = {'genuine', 'efforia', 'phalaenopsis'}

def write_text_atomic(path, content):
    fd, tmp = tempfile.mkstemp(prefix='.characters-', suffix='.tmp', dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(content)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

def get(url, binary=False, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    raw = urllib.request.urlopen(req, timeout=timeout).read()
    return raw if binary else raw.decode('utf-8', 'replace')

def hex2rgb(hx):
    hx = hx.lstrip('#')
    return tuple(int(hx[i:i+2], 16) for i in (0, 2, 4))

def trim(im):
    bb = im.split()[3].point(lambda v: 255 if v > 60 else 0).getbbox()
    return im.crop(bb) if bb else im

def row_spans(im):
    a = im.split()[3]
    w, h = im.size
    px = a.load()
    out = []
    for y in range(h):
        lo = hi = None
        for x in range(w):
            if px[x, y] > 60:
                if lo is None: lo = x
                hi = x
        out.append((lo, hi) if lo is not None else None)
    return out

def balanced_div(h, start):
    depth, pos, n = 0, start, len(h)
    while pos < n:
        no = h.find('<div', pos); nc = h.find('</div>', pos)
        if nc == -1: break
        if no != -1 and no < nc: depth += 1; pos = no + 4
        else:
            depth -= 1; pos = nc + 6
            if depth == 0: return h[start:pos]
    return ''

def main():
    import datetime
    today = datetime.date.today().isoformat()

    # ---- 现有角色 ----
    idx_path = os.path.join(DATA_DIR, 'character_index_data.js')
    t = io.open(idx_path, encoding='utf-8').read()
    _i = t.find('['); _j = t.rfind(']')
    chars = json.loads(t[_i:_j + 1])
    existing = {c['id'] for c in chars}

    # ---- 阶段0: 官方站检测 ----
    off = get(OFFICIAL)
    order = []
    for m in re.finditer(r'href="/character/([a-z0-9_]+)/?"', off):
        if m.group(1) not in order:
            order.append(m.group(1))
    news_ids = [i for i in order if i not in existing]
    print('官方角色:', len(order), '| 本地:', len(existing), '| 新增:', len(news_ids), flush=True)
    if not news_ids:
        print('无新角色，管线结束。', flush=True)
        return 0

    # ---- 阶段0.5: 萌百登场人物门禁 ----
    list_h = get(MOE_LIST)
    moe_pages = {}   # jp_name -> intro block
    pending_gate = []
    for cid in news_ids:
        ph = get(OFFICIAL + cid)
        jm = re.search(r'<title>([^｜<]+)', ph)
        jp = jm.group(1).strip() if jm else cid
        i = list_h.find(jp)
        ok = False
        info = {}
        if i >= 0:
            blk_s = list_h.rfind('<div', 0, list_h.rfind('umamusume-intro', max(0, i - 3000), i))
            block = balanced_div(list_h, blk_s)
            zm = re.search(r'title="([^"]+)"><span[^>]*>[^<]+<br />', block)
            if zm:
                ok = True
                info['block'] = block
                info['zh'] = zm.group(1)
                cvm = re.search(r'CV：<a[^>]*title="([^"]+)"', block)
                info['cv'] = cvm.group(1) if cvm else ''
                cm = re.search(r'umamusume-intro" style="color:([#0-9a-fA-F]+)', block)
                info['color'] = (cm.group(1) if cm else '').lower()
                am = re.search(r'src="(https://storage\.moegirl\.org\.cn/moegirl/commons/[^"]+?\.png)', block)
                info['updch'] = (am.group(1).split('!')[0]) if am else ''
        if ok:
            moe_pages[cid] = info
            print('  [门禁通过]', cid, '=', info['zh'], flush=True)
        else:
            pending_gate.append(cid)
            print('  [等待萌百]', cid, '(' + jp + ')', flush=True)
    if not moe_pages:
        print('萌百尚未更新任何新角色，结束。', flush=True)
        return 0
    whitelisted = [cid for cid in moe_pages if cid in MANUAL_DESC]
    if whitelisted:
        print('  [白名单保护] 跳过人工翻译角色详情:', ', '.join(whitelisted), flush=True)
        moe_pages = {cid: info for cid, info in moe_pages.items() if cid not in MANUAL_DESC}
    if not moe_pages:
        print('新角色均在人工翻译白名单内，管线结束。', flush=True)
        return 0

    # ---- 阶段1&1.5&2: 逐个入库 ----
    det_path = os.path.join(DATA_DIR, 'character_detail_data.js')
    t2 = io.open(det_path, encoding='utf-8').read().rstrip()
    head2 = t2[:-2].rstrip()
    if not head2.endswith(','):
        head2 += ','
    add_detail = []
    va_targets = []

    for cid, info in moe_pages.items():
        ph = get(OFFICIAL + cid)
        urls = re.findall(r'https://images\.microcms-assets\.io[^"\'\s)]+', ph)
        u_art = next((u for u in urls if u.rsplit('/', 1)[-1].startswith(cid + '_01.png')), None)
        u_icon = next((u for u in urls if u.rsplit('/', 1)[-1].startswith(cid + '_icon.png')), None)

        def shrink(src_im, dst, box_w=None, box_h=None, quality=None):
            w, hh = src_im.size
            s = min((box_w / w) if box_w else 9e9, (box_h / hh) if box_h else 9e9,
                    9e9 if quality is None else 9e9)
            s = min(s, 9e9)
            out_im = src_im.resize((int(w * s), int(hh * s)), Image.LANCZOS) if s < 1 else src_im
            if quality:
                rgb = out_im.convert('RGB')
                rgb.save(dst, 'JPEG', quality=quality, optimize=True)
            else:
                out_im.save(dst, optimize=True)

        tmp = os.path.join(ROOT, '_tmp_char.img')
        if u_art:
            open(tmp, 'wb').write(get(u_art, binary=True))
            im = Image.open(tmp).convert('RGBA')
            w0, h0 = im.size
            s0 = 389.0 / h0 if h0 > 389 else 1.0
            im = im.resize((max(1,int(w0*s0)), max(1,int(h0*s0))), Image.LANCZOS)
            bg = Image.new('RGB', im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            bg.save(os.path.join(ROOT, 'uma_official', '%s.png' % cid), optimize=True)
        if u_icon:
            open(tmp, 'wb').write(get(u_icon, binary=True))
            im = Image.open(tmp).convert('RGBA')
            side = min(im.size)
            im = im.crop(((im.size[0]-side)//2, (im.size[1]-side)//2,
                          (im.size[0]-side)//2+side, (im.size[1]-side)//2+side))
            im.thumbnail((200, 200), Image.LANCZOS)
            im.save(os.path.join(ROOT, 'uma_avatars', '%s.png' % cid), optimize=True)
        os.path.exists(tmp) and os.remove(tmp)

        # uma_moe 透明立绘（副本操作，符合铁律）
        upd = info.get('updch')
        if upd:
            raw = get(upd, binary=True)
            moe = Image.open(io.BytesIO(raw)).convert('RGBA')
            moe = trim(moe)
            mw, mh = moe.size
            s = min(600.0 / mw, (1056 * 0.84) / mh, 1.0)
            moe = moe.resize((int(mw*s), int(mh*s)), Image.LANCZOS)
            canvas = Image.new('RGBA', (600, 1056), (0, 0, 0, 0))
            canvas.paste(moe, ((600 - moe.size[0]) // 2, (1056 - moe.size[1]) // 2), moe)
            canvas.save(os.path.join(ROOT, 'uma_moe', '%s.png' % cid))

        # 详情页条目
        block = info['block'].replace('\r', '')
        block = re.sub(r'src="https://storage\.moegirl\.org\.cn/moegirl/commons/[^"]+"',
                       'src="/uma_moe/%s.png"' % cid, block)
        block = re.sub(r'href="/(?!%)', 'href="https://mobile.moegirl.org.cn/', block)
        obj = {'html': block, 'zh': info['zh'], 'ja': '', 'en': '',
               'cv_zh': info['cv'], 'color': info['color']}
        jm2 = re.search(r'<span lang="ja">\s*([^<]+?)\s*</span>', info['block'])
        if jm2: obj['ja'] = jm2.group(1).strip()
        enm = re.search(r'>([A-Za-z][A-Za-z\s]{3,30})<', info['block'])
        if enm: obj['en'] = enm.group(1).strip()
        add_detail.append("  '%s': %s" % (cid, json.dumps(obj, ensure_ascii=False)))

        # CHAR_INDEX 条目
        chars.append({'id': cid, 'zh': info['zh'], 'ja': obj['ja'], 'en': obj['en'],
                      'cv_zh': info['cv'], 'cv': info['cv'],
                      'img': '/uma_official/%s.png' % cid,
                      'page': 'https://zh.moegirl.org.cn/' + urllib.parse.quote(info['zh']),
                      'main': info['color'] or '#8c83ff', 'sub': '#ffffff'})
        va_targets.append(info['cv'])

    # 重排（官方顺序）+ 写回
    pos = {c: i for i, c in enumerate(order)}
    chars.sort(key=lambda c: pos.get(c['id'], 999))
    write_text_atomic(idx_path,
                      'window.CHAR_INDEX = ' + json.dumps(chars, ensure_ascii=False, separators=(',', ':')) + ';')
    t2 = head2 + '\n' + ',\n'.join(add_detail) + '\n};\n'
    write_text_atomic(det_path, t2)
    print('CHAR_INDEX:', len(chars), '| 详情追加:', len(add_detail), flush=True)

    # ---- 阶段4: 新声优 ----
    man_path = os.path.join(DATA_DIR, 'va_photos_data.js')
    man_raw = io.open(man_path, encoding='utf-8').read()
    man_j = man_raw.find('{'); man_J = man_raw.rfind('}') + 1
    manifest = json.loads(man_raw[man_j:man_J])

    def api_quote(x):
        return urllib.parse.quote(x.replace(' ', '_'), safe='')

    for name in dict.fromkeys(va_targets):
        if not name or name in manifest and manifest[name].get('img'):
            continue
        title = None
        try:
            r = json.loads(get('https://zh.moegirl.org.cn/api.php?action=opensearch&search=%s&limit=3&format=json'
                               % api_quote(name)))
            for cand in (r[1] if len(r) > 1 else []):
                if name in cand: title = cand; break
            if not title and r[1]: title = r[1][0]
        except Exception as ex:
            print('VA搜索失败', name, str(ex)[:50]); continue
        if not title:
            print('VA无萌百词条:', name); continue
        birth = ''
        ph = None
        try:
            rr = json.loads(get('https://zh.moegirl.org.cn/api.php?action=query&titles=%s'
                                '&prop=pageimages&piprop=thumbnail&pithumbsize=560&format=json'
                                % api_quote(title)))
            for _, pg in rr.get('query', {}).get('pages', {}).items():
                th = (pg.get('thumbnail') or {}).get('source')
                if th: ph = th
        except Exception:
            pass
        try:
            html = get('https://zh.moegirl.org.cn/' + api_quote(title))
            for row in re.findall(r'<tr[^>]*>((?:(?!</tr>).)*?(?:出生|生日)(?:(?!</tr>).)*?)</tr>', html, re.S):
                mm = DATE_RE.search(re.sub(r'<[^>]+>', ' ', row))
                if mm: birth = mm.group(0); break
        except Exception:
            pass
        if ph:
            fn = 'va_%s.jpg' % name
            data = urllib.request.urlopen(urllib.request.Request(ph, headers=UA), timeout=60).read()
            tmp = os.path.join(ROOT, 'uma_va', '_tmp.jpg')
            open(tmp, 'wb').write(data)
            img = Image.open(tmp)
            if img.mode != 'RGB':
                bg = Image.new('RGB', img.size, (255, 255, 255))
                bg.paste(img.convert('RGBA'), mask=img.convert('RGBA').split()[-1])
                img = bg
            if max(img.size) > 300:
                img.thumbnail((300, 300), Image.LANCZOS)
            img.save(os.path.join(ROOT, 'uma_va', fn), 'JPEG', quality=75, optimize=True)
            os.remove(tmp)
            e = manifest.setdefault(name, {})
            e.update({'img': '/uma_va/' + fn, 'page': 'https://zh.moegirl.org.cn/' + api_quote(title),
                      'title': title, 'birth': birth})
            print('VA入库:', name, '|', fn, flush=True)
        time.sleep(0.4)

    out = ['// auto-generated by fetch_va_photos_moegirl.py']
    out.append('window.VA_PHOTOS = %s;' % json.dumps(manifest, ensure_ascii=False))
    write_text_atomic(man_path, '\n'.join(out))

    # ---- 阶段3: 血统源数据待办提示 ----
    if moe_pages:
        print('\n[待人工] 请在 data/pedigree_source.json 补充以下角色的节点、原型映射和亲本事实:')
        for cid in moe_pages:
            print('   -', cid, '(' + moe_pages[cid]['zh'] + ')')
        print('完成后运行:')
        print('   python3 uma_tools/build_pedigree.py')
        print('   python3 uma_tools/check_pedigree.py')

    print('DONE total_chars=%d' % len(chars), flush=True)
    return 0

if __name__ == '__main__':
    sys.exit(main())
