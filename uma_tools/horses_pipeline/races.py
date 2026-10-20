"""Races responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common
from . import text as pipeline_text
from . import transport as pipeline_transport
from . import wikipedia as pipeline_wikipedia


def search_jbis_url(name, born=''):
    """按马名在 JBIS 搜索马档案页，返回 URL；找不到返回 ''。
    同名多匹时按档案页生年月日与 born 年份消歧。"""
    if not name:
        return ''
    want_year = pipeline_common.re.sub(r'\D', '', str(born or ''))[:4]
    for mode in ('exact', 'prefix'):
        url = ('https://www.jbis.or.jp/horse/result/?sid=horse&match=%s&keyword=%s'
               % (mode, pipeline_common.urllib.parse.quote(name)))
        try:
            html = pipeline_transport.http_get(url)
        except Exception:  # noqa: BLE001
            continue
        ids = []
        prefix_id = ''
        # 卡片标题链接 class 精确为 txt-link（父母行是 txt-link txt-overflow，不匹配）
        for match in pipeline_common.re.finditer(r'<a href="(/horse/([0-9a-f]+)/)" class="txt-link">([^<]+)</a>', html):
            label = pipeline_common.html_lib.unescape(match.group(3)).strip()
            base = pipeline_common.re.sub(r'\([^)]*\)\s*$', '', label).strip()
            hid = match.group(2)
            if label == name or base == name:
                if hid not in ids:
                    ids.append(hid)
            elif mode == 'prefix' and not prefix_id and (base.startswith(name) or name.startswith(base)):
                prefix_id = hid
        if not ids and prefix_id:
            ids = [prefix_id]
        if not ids:
            continue
        if not want_year:
            if len(ids) != 1:
                return ''
            return 'https://www.jbis.or.jp/horse/%s/' % ids[0]
        # 同名多匹：按生年消歧
        for hid in ids:
            try:
                page = pipeline_transport.http_get('https://www.jbis.or.jp/horse/%s/' % hid)
                m = pipeline_common.re.search(r'生年月日</dt>\s*<dd[^>]*>([^<]+)', page)
                birth = pipeline_common.html_lib.unescape(m.group(1)).strip() if m else ''
            except Exception:  # noqa: BLE001
                continue
            year = pipeline_common.re.search(r'(?:17|18|19|20)\d{2}', birth)
            if year and year.group() == want_year:
                return 'https://www.jbis.or.jp/horse/%s/' % hid
        return ''
    return ''


def parse_tables(html_text):
    """从 JBIS 档案页提取档案字段 / 表彰 / 年度累计 / 主要成绩。
    表格区块用摊平文本解析（JBIS 行结构与嵌套 div 不稳定）。
    返回 dict；解析失败时返回空结构。"""
    data = {'profile': {}, 'awards': [], 'yearly': [], 'major': [],
            'pedigree': [], 'photo': ''}
    photo_match = pipeline_common.re.search(r'/horse/images/([0-9a-f]+_\d)/', html_text)
    if photo_match:
        data['photo'] = 'https://www.jbis.or.jp/horse/images/%s/' % photo_match.group(1)

    # --- 血统（父 / 母 及祖）---
    pedigree_block = None
    m = pipeline_common.re.search(r'<h2>血統情報</h2>(.*?)<h2>プロフィール</h2>', html_text, pipeline_common.re.S)
    if m:
        pedigree_block = m.group(1)
    if pedigree_block:
        for match in pipeline_common.re.finditer(
            r'<a href="(/horse/[0-9a-f]+/)" class="txt-link">([^<]+)</a>',
            pedigree_block,
        ):
            data['pedigree'].append({
                'ja': pipeline_common.html_lib.unescape(match.group(2)).strip(),
                'url': 'https://www.jbis.or.jp' + match.group(1),
            })

    # --- 档案 dl（第一个 data-4-1）---
    first_dl = pipeline_common.re.search(r'<dl class="data-4-1">(.*?)</dl>', html_text, pipeline_common.re.S)
    if first_dl:
        block = first_dl.group(1)
        for match in pipeline_common.re.finditer(
            r'<dt>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>', block, pipeline_common.re.S
        ):
            key = pipeline_text.strip_tags(match.group(1))
            value = pipeline_text.strip_tags(match.group(2))
            if key and value:
                data['profile'][key] = value

    # --- 表彰（后续 data-4-1）---
    for dl_match in pipeline_common.re.finditer(r'<dl class="data-4-1">(.*?)</dl>', html_text, pipeline_common.re.S):
        block = dl_match.group(1)
        if pipeline_common.re.search(r'<dt>\d{4}年度</dt>', block):
            for match in pipeline_common.re.finditer(r'<dt>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>', block, pipeline_common.re.S):
                year = pipeline_text.strip_tags(match.group(1))
                title = pipeline_text.strip_tags(match.group(2))
                if year and title:
                    data['awards'].append({'year': year.replace('年度', ''), 'title': title})

    # --- 年度别累计（token 流状态机重建行）---
    # JBIS 每个单元格一个 <div>，摊平后一行一个 cell；以年份/合計行触发新行。
    yearly_seg = pipeline_common.re.search(r'年度別累計成績</h2>(.*?)(?:SSI|主な成績|</main>)', html_text, pipeline_common.re.S)
    if yearly_seg:
        section = ''
        current = None
        pending = []
        for line in pipeline_text.plain_lines(yearly_seg.group(1)):
            if line in ('中央', '地方', '海外'):
                section = line
                continue
            if pipeline_common.re.fullmatch(r'\d{4}', line) or line in ('合計', '通算'):
                if current is not None:
                    pending.append(current)
                current = {'year': line, 'section': section, 'cell': []}
                continue
            if current is not None and line not in (
                '年', '出走', '回数', '1着', '2着', '3着', '着外', '賞金', '開催場所',
            ):
                current['cell'].append(line)
        if current is not None:
            pending.append(current)
        for row in pending:
            ints = []
            rest = []
            for cell in row['cell']:
                if pipeline_common.re.fullmatch(r'\d+', cell):
                    ints.append(cell)
                else:
                    rest.append(cell)
                if len(ints) > 5:
                    break
            earnings = next((t for t in rest if '円' in t), '')
            venue = [t for t in rest if t != earnings]
            if row['section']:
                venue.insert(0, row['section'])
            data['yearly'].append({
                'year': row['year'],
                'starts': ints[0] if len(ints) > 0 else '',
                'wins': ints[1] if len(ints) > 1 else '',
                'seconds': ints[2] if len(ints) > 2 else '',
                'thirds': ints[3] if len(ints) > 3 else '',
                'unplaced': ints[4] if len(ints) > 4 else '',
                'earnings': earnings,
                'venue': ' '.join(venue),
            })

    # --- 主要成绩（每个直接子 div 是一场比赛，海外行可能只有年份）---
    major_seg = pipeline_common.re.search(r'主な成績</h2>(.*?)(?:<footer|トップへ|</main>)', html_text, pipeline_common.re.S)
    if major_seg:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(major_seg.group(1), 'html.parser')
        for row in soup.select('.data-6-2 > div'):
            cells = row.find_all('div', recursive=False)
            if len(cells) != 7:
                continue
            values = [cell.get_text(' ', strip=True) for cell in cells]
            if not pipeline_common.re.fullmatch(r'\d{4}(?:\.\d\d\.\d\d)?', values[0]) or not values[3].isdigit():
                continue
            race_link = cells[2].find('a')
            grade_element = cells[2].find('span')
            race = race_link.get_text(' ', strip=True) if race_link else values[2]
            grade_token = grade_element.get_text(strip=True) if grade_element else ''
            grade = normalized_grade(grade_token)
            data['major'].append({
                'date': values[0],
                'track': values[1],
                'race': race,
                'grade': grade,
                'place': int(values[3]),
                'surface': values[4],
                'distance': values[5],
                'beaten': values[6],
            })
    return data


def _grade_like(token):
    """判断 JBIS 战绩行里隔位处是否像比赛格付（G1/G2/G3/OP/L 等），而非赛事名。"""
    text = str(token or '').replace('Ｇ', 'G').replace('Ⅰ', 'I').replace('Ⅱ', 'II').replace('Ⅲ', 'III').replace('３', '3').replace('２', '2').replace('１', '1')
    return bool(normalized_grade(text))


def normalized_grade(raw):
    import unicodedata
    text = unicodedata.normalize('NFKC', pipeline_text.strip_markup(raw)).upper().strip()
    japanese = pipeline_common.re.search(r'(?<![A-Z])JPN\s*(III|II|I|[123])(?![A-Z0-9])', text)
    if japanese:
        return 'Jpn' + {'I': '1', 'II': '2', 'III': '3'}.get(japanese.group(1), japanese.group(1))
    match = pipeline_common.re.search(r'(?<![A-Z])(?:J[・. -]?)?G\s*(III|II|I|[123])(?![A-Z0-9])', text)
    if match:
        level = {'I': '1', 'II': '2', 'III': '3'}.get(match.group(1), match.group(1))
        return ('JG' if pipeline_common.re.search(r'J[・. -]?G', match.group()) else 'G') + level
    if text in ('OP', 'L', 'LISTED', '重賞', '八大競走', '八'):
        return 'L' if text == 'LISTED' else 'G1' if text in ('八大競走', '八') else text
    return ''


def parse_wiki_races(wikitext, lang):
    """从维基「競走成績/詳細賽績」表格提取逐场战绩（兼容 zh/ja 多种列式）。
    统一输出：{date,track,race,place,surface,distance,condition,field,number,
              popularity,jockey,weight,time,margin,winner,bodyweight,prize,grade}"""
    headers = list(pipeline_common.re.finditer(
        r'^==+\s*(?:競走成績|詳細賽績|戰績|战绩|詳細戰績|成績|成绩|戦績|賽績|赛績)\s*==+\s*$',
        wikitext, pipeline_common.re.M))
    bodies = []
    for pos, h in enumerate(headers):
        start_ = h.end()
        end_ = headers[pos + 1].start() if pos + 1 < len(headers) else len(wikitext)
        nxt = pipeline_common.re.search(r'^==', wikitext[start_:], pipeline_common.re.M)
        if nxt:
            end_ = min(end_, start_ + nxt.start())
        bodies.append(wikitext[start_:end_])
    if not bodies:
        return []

    def cell_text(value):
        text = pipeline_common.re.sub(r'^[^|]*=\s*"[^"]*"\s*\|', '', (value or '').strip())
        text = pipeline_common.re.sub(r'<ref[^>]*/>', '', text)
        text = pipeline_common.re.sub(r'<ref[^>]*/?>.*?</ref>', '', text, flags=pipeline_common.re.S)
        text = pipeline_common.re.sub(r'\{\{\s*0\s*(?:\|[^{}]*)?\}\}', '', text)  # 隐藏填充 {{0}} / {{0|0000.}}
        text = pipeline_common.re.sub(r'\{\{\s*[Cc]olor\|[^|{}]*\|([^{}]*)\}\}', r'\1', text)
        text = pipeline_common.re.sub(r'\{\{\s*(?:small|nowrap)\s*\|([^{}]*)\}\}', r'\1', text)
        return pipeline_text.strip_markup(text)

    def grade_of(raw):
        return normalized_grade(raw)

    def place_of(raw):
        text = cell_text(raw)
        m = pipeline_common.re.search(r'(\d+)\s*着', text)
        if m:
            return m.group(1)
        if pipeline_common.re.fullmatch(r'\d+', text):
            return text
        return text if text in ('除外', '取消', '中止', '失格', '除', '取消') else ''

    def dist_of(raw):
        m = pipeline_common.re.search(r'(芝|草|ダ|泥|障)\s*(\d+(?:\.\d+)?)\s*(mi|m|f)?', raw)
        if not m:
            return '', '', ''
        surface = {'草': '芝', '泥': 'ダ'}.get(m.group(1), m.group(1))
        dist = float(m.group(2))
        if (m.group(3) or '').lower() == 'f':
            dist *= 201.168
        elif (m.group(3) or '').lower() == 'mi':
            dist *= 1609.344
        return surface, str(round(dist)), raw.replace(m.group(0), '')

    races = []
    for body in bodies:
        year_hint = ''
        for block in pipeline_common.re.split(r'(?m)^\s*\|-\s*$', body):
            cells = []
            for line in block.splitlines():
                line = line.strip()
                if line.startswith('|') or line.startswith('!'):
                    line = pipeline_common.re.sub(r'\s+\|(?=\{\{|\[|\d)', '||', line)
                    cells.extend(pipeline_common.re.split(r'\|\||!!', line.lstrip('|!')))
            cells = [c.strip() for c in cells]
            if len(cells) < 6:
                continue

            def at(idx):
                return cell_text(cells[idx]) if 0 <= idx < len(cells) else ''

            date = track = race = grade = place = surface = distance = ''
            condition = field = number = popularity = jockey = weight = ''
            time_ = margin = winner = bodyweight = ''
            dist_raw = ''
            c0 = pipeline_common.re.sub(r'\s+', '', at(0))  # 容忍 '1941. 3.15' 这类带空格日期
            dm = pipeline_common.re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})', c0)
            dfull = pipeline_common.re.fullmatch(r'(\d{4})\.(\d{1,2})\.(\d{1,2})', c0)
            dshort = pipeline_common.re.fullmatch(r'(\d{1,2})\.(\d{1,2})', c0)
            if dm:  # zh：日期(D/M/Y)/國家/馬場/距離/級別/賽事/負重/騎師/馬號/出馬/名次/時間/頭馬（二馬）
                date = '%s.%02d.%02d' % (dm.group(3), int(dm.group(2)), int(dm.group(1)))
                track, dist_raw = at(2), at(3)
                grade = grade_of(cells[4])
                race, weight, jockey = at(5), at(6), at(7)
                number, field = at(8), at(9)
                place = place_of(cells[10])
                time_, winner = at(11), at(12)
            elif dfull or dshort:  # ja 单行日期式：按着順/距離相对位置分派
                if dfull:
                    year_hint = dfull.group(1)
                    date = '%s.%02d.%02d' % (dfull.group(1), int(dfull.group(2)), int(dfull.group(3)))
                elif year_hint:
                    date = '%s.%02d.%02d' % (year_hint, int(dshort.group(1)), int(dshort.group(2)))
                else:
                    continue
                track, race = at(1), at(2)
                dist_idx = next((i for i, c in enumerate(cells)
                                 if pipeline_common.re.search(r'(芝|草|ダ|泥|障)\s*\d+', cell_text(c))), -1)
                place_idx = next((i for i, c in enumerate(cells)
                                  if pipeline_common.re.search(r'\d+\s*着', cell_text(c))
                                  or cell_text(c) in ('除外', '取消', '中止', '失格')), -1)
                if dist_idx < 0 or place_idx < 0:
                    continue
                for c in cells:
                    g = grade_of(c)
                    if g:
                        grade = g
                        break
                dist_raw = at(dist_idx)
                place = place_of(cells[place_idx])
                if place_idx >= 1 and pipeline_common.re.match(r'\d+人', cell_text(cells[place_idx - 1])):
                    popularity = pipeline_common.re.sub(r'\D', '', cell_text(cells[place_idx - 1]))
                gap = dist_idx - place_idx
                if gap == -1:  # 外战紧凑列：距離/着順/騎手/着差/勝ち馬
                    jockey, margin, winner = at(place_idx + 1), at(place_idx + 2), at(place_idx + 3)
                elif gap == 1:  # 老式列：着順/距離/斤量/タイム/騎手/着差/勝ち馬
                    weight = at(dist_idx + 1)
                    time_ = at(dist_idx + 2)
                    jockey, margin, winner = at(dist_idx + 3), at(dist_idx + 4), at(dist_idx + 5)
                elif gap == 3:  # 日式紧凑列：着順/騎手/斤量/距離/タイム/着差/勝ち馬
                    jockey, weight = at(place_idx + 1), at(place_idx + 2)
                    time_, margin, winner = at(dist_idx + 1), at(dist_idx + 2), at(dist_idx + 3)
                else:  # 地方竞马列：距離/頭数/枠/馬番/人気/着順/タイム/着差/騎手/斤量/勝ち馬
                    field = at(dist_idx + 1)
                    time_, margin = at(place_idx + 1), at(place_idx + 2)
                    jockey, weight, winner = at(place_idx + 3), at(place_idx + 4), at(place_idx + 5)
            else:  # ja 分列式：[年]/月/日 分列，着順定位后按列距分派
                ym = pipeline_common.re.fullmatch(r'(\d{4})', c0)
                if ym:
                    year_hint = ym.group(1)
                    base = 1
                else:
                    base = 1 if c0 == '' else 0
                month = pipeline_common.re.sub(r'\D', '', at(base))
                day = pipeline_common.re.sub(r'\D', '', at(base + 1))
                if not (year_hint and month and day):
                    continue
                date = '%s.%02d.%02d' % (year_hint, int(month), int(day))
                track, race = at(base + 2), at(base + 3)
                for c in cells[base + 4:]:
                    g = grade_of(c)
                    if g:
                        grade = g
                        break
                place_idx = next((i for i, c in enumerate(cells)
                                  if pipeline_common.re.search(r'\d+\s*着', cell_text(c))
                                  or cell_text(c) in ('除外', '取消', '中止', '失格')), -1)
                dist_idx = next((i for i, c in enumerate(cells)
                                 if pipeline_common.re.search(r'(芝|草|ダ|泥|障)\s*\d+', cell_text(c))), -1)
                if dist_idx < 0:
                    continue
                dist_raw = at(dist_idx)
                gap = dist_idx - place_idx if place_idx >= 0 else -1
                tail = len(cells) - (dist_idx + 1)
                if gap == 3:  # 着順/騎手/斤量/距離（馬場）/タイム/着差/勝ち馬/馬体重
                    jockey, weight = at(place_idx + 1), at(place_idx + 2)
                    time_, margin, winner = at(dist_idx + 1), at(dist_idx + 2), at(dist_idx + 3)
                elif tail >= 5:  # 着順/距離/タイム/着差/騎手/斤量/勝ち馬
                    time_, margin = at(dist_idx + 1), at(dist_idx + 2)
                    jockey, weight, winner = at(dist_idx + 3), at(dist_idx + 4), at(dist_idx + 5)
                else:  # 着順/距離/タイム/騎手/着差/勝ち馬
                    time_, jockey = at(dist_idx + 1), at(dist_idx + 2)
                    margin, winner = at(dist_idx + 3), at(dist_idx + 4)
                if place_idx >= 0:
                    place = place_of(cells[place_idx])
                    ninki_idx = place_idx - 1
                    popularity = pipeline_common.re.sub(r'\D', '', at(ninki_idx))
                    field = at(ninki_idx - 3)
            surface, distance, rest = dist_of(dist_raw)
            cm = pipeline_common.re.search(r'[（(]([^）)]*)[）)]', rest)
            condition = cm.group(1) if cm else ''
            if not date or not race or not date[:4].isdigit() or not (1850 <= int(date[:4]) <= 2100):
                continue
            if pipeline_common.re.fullmatch(r'[\d.,:\s%]+', race):
                continue  # 数值串（体重/均速等）不是赛事名，跳过
            races.append({
                'date': date, 'track': track, 'race': race, 'place': place,
                'surface': surface, 'distance': distance, 'condition': condition,
                'field': field, 'number': number, 'popularity': popularity,
                'jockey': jockey, 'weight': weight, 'time': time_, 'margin': margin,
                'winner': winner, 'bodyweight': bodyweight, 'prize': '', 'grade': grade,
            })
    return races


def wiki_races_for(record):
    """按缓存里的 wiki 词条（zh 优先）取逐场战绩表。"""
    wiki = record.get('wiki') or {}
    candidates = []
    if wiki.get('lang'):
        candidates.append((wiki['lang'], wiki.get(wiki['lang']) or ''))
    for lang, key in (('zh', 'zh'), ('ja', 'ja')):
        name = record.get(key) or ''
        if name:
            candidates.append((lang, name))
            candidates.append((lang, name + (' (競走馬)' if lang == 'ja' else ' (賽馬)')))
    seen = set()
    for lang, title in candidates:
        if not title or (lang, title) in seen:
            continue
        seen.add((lang, title))
        try:
            rows = parse_wiki_races(pipeline_wikipedia.wiki_wikitext(lang, title) or '', lang)
        except Exception:  # noqa: BLE001
            continue
        if rows:
            return rows
    return []


def battle_count(record):
    """从战绩文本取出赛数 N（「22戰10冠」「国内：1戦 | 海外：15戦」等分段求和）。"""
    text = ((record.get('facts') or {}).get('record') or '')
    parts = pipeline_common.re.findall(r'(\d+)\s*[戰战戦]', text)
    return sum(int(p) for p in parts) if parts else 0


def jbis_birth_matches(record):
    """JBIS 档案页的生年月日是否与源 born 年份一致（同名错马防线）。"""
    url = record.get('jbis') or ''
    if 'jbis.or.jp' not in url:
        return True
    born_raw = str(record.get('born') or '')
    if '約' in born_raw or '约' in born_raw:
        return True  # 约XXXX 年为考据值，不做生年校验
    by = pipeline_common.re.sub(r'\D', '', born_raw)[:4]
    if len(by) < 4:
        return True
    try:
        page = pipeline_transport.http_get(url)
    except Exception:  # noqa: BLE001
        return True
    m = pipeline_common.re.search(r'生年月日</dt>\s*<dd[^>]*>([^<]+)', page)
    if not m:
        return True
    bb = pipeline_common.re.sub(r'\D', '', pipeline_common.html_lib.unescape(m.group(1)))[:4]
    return (not bb) or bb == by


def merge_races(base, extra):
    """按日期去重合并（同日必同场，跨语言命名也能对上），base 优先。"""
    def key(row):
        return row.get('date') or ''
    seen = {key(r) for r in base}
    out = list(base)
    for row in extra:
        k = key(row)
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(row)
    out.sort(key=lambda r: r.get('date') or '')
    return out


def fill_races(record, jbis_rows):
    """JBIS 行已覆盖大头时只信 JBIS（维基行常有日期/列位噪声）；
    JBIS 缺/稀时才用维基出赛表补全。"""
    target = battle_count(record)
    if jbis_rows and (not target or len(jbis_rows) >= int(target * 0.6)):
        return jbis_rows
    return merge_races(jbis_rows, wiki_races_for(record))


def parse_races(html_text):
    """从 JBIS /horse/<id>/record/ 提取完整逐场战绩。
    行以日付单元格起头的 div 块；用「人気+骑师链」双重特征排除年度/主要成绩表混入。
    返回 [{date, track, race, place, surface, distance, condition, field, number,
           popularity, jockey, weight, time, margin, winner, bodyweight, prize}]。"""
    races = []
    starts = [m.start() for m in pipeline_common.re.finditer(r'<div>(\d{4}\.\d\d\.\d\d)</div>', html_text)]
    for pos, start in enumerate(starts):
        chunk = html_text[start: starts[pos + 1] if pos + 1 < len(starts) else len(html_text)]
        if not pipeline_common.re.search(r'\d+人気', chunk) or '/horse/jockey/' not in chunk:
            continue
        head = pipeline_common.re.match(r'<div>(\d{4}\.\d\d\.\d\d)</div>\s*<div>([^<]*)</div>', chunk)
        race_m = pipeline_common.re.search(r'data-6__tag">\s*<a[^>]*>([^<]+)</a>', chunk)
        place = ''
        place_m = pipeline_common.re.search(r'number-\d+">([^<]*)</span>', chunk)
        if place_m:
            place = pipeline_text.strip_markup(place_m.group(1))
        else:
            odd = pipeline_common.re.search(r'<div>\s*(中止|取消|除外|失格)\s*</div>', chunk)
            place = odd.group(1) if odd else ''
        time_margin = pipeline_common.re.search(
            r'data-6__lyt-1 jc-right">\s*<span class="ta-right">([^<]*)</span>\s*<span class="ta-right">([^<]*)</span>',
            chunk)
        winner = ''
        win_m = pipeline_common.re.search(r'<div class="jc-left">(.*?)</div>', chunk, pipeline_common.re.S)
        if win_m:
            winner = pipeline_text.strip_markup(win_m.group(1))
        races.append({
            'date': head.group(1) if head else '',
            'track': pipeline_text.strip_markup(head.group(2)) if head else '',
            'race': pipeline_text.strip_markup(race_m.group(1)) if race_m else '',
            'place': place,
            'surface': (pipeline_common.re.search(r'<div>(芝|ダ)</div>', chunk) or [None, ''])[1],
            'distance': (pipeline_common.re.search(r'(\d+)m', chunk) or [None, ''])[1],
            'condition': pipeline_text.strip_markup((pipeline_common.re.search(r'<div>(良|稍重|重|不良)', chunk) or [None, ''])[1]),
            'field': (pipeline_common.re.search(r'(\d+)頭', chunk) or [None, ''])[1],
            'number': (pipeline_common.re.search(r'(\d+)番', chunk) or [None, ''])[1],
            'popularity': (pipeline_common.re.search(r'(\d+)人気', chunk) or [None, ''])[1],
            'jockey': pipeline_text.strip_markup((pipeline_common.re.search(r'/horse/jockey/[^"]*"[^>]*>([^<]+)<', chunk) or [None, ''])[1]),
            'weight': pipeline_text.strip_markup((pipeline_common.re.search(r'ta-right">\s*([\d.]+)', chunk) or [None, ''])[1]),
            'time': pipeline_text.strip_markup(time_margin.group(1)) if time_margin else '',
            'margin': pipeline_text.strip_markup(time_margin.group(2)) if time_margin else '',
            'winner': winner,
            'bodyweight': (pipeline_common.re.search(r'(\d+（(?:[+\-]\d+|0)）)', chunk) or [None, ''])[1],
            'prize': (pipeline_common.re.search(r'([\d,]+(?:\.\d+)?万円)', chunk) or [None, ''])[1].replace(',', ''),
        })
    return races
