"""Text responsibilities for the canonical catalog pipeline."""
from __future__ import annotations

from . import common as pipeline_common


def strip_markup(text):
    text = pipeline_common.re.sub(r'<ref[^>]*/>', '', text)
    text = pipeline_common.re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=pipeline_common.re.S)
    text = pipeline_common.re.sub(r'<[^>]+>', '', text)
    text = pipeline_common.re.sub(r'<!--.*?-->', '', text, flags=pipeline_common.re.S)
    text = pipeline_common.re.sub(r'&nbsp;', ' ', text)
    text = pipeline_common.re.sub(r'&amp;', '&', text)
    # 国旗占位模板只保留代码
    text = pipeline_common.re.sub(r'\{\{\s*flag\s*icon\s*\|\s*([^|{}]+?)\s*\}\}', r'\1', text)
    # 模板折叠：取第一个参数（表单名/链接文字），无参数则保留代码文字
    text = collapse_templates(text)
    text = pipeline_common.re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', text)
    text = pipeline_common.re.sub(r"'''", '', text)
    text = pipeline_common.re.sub(r'\s+', ' ', text).strip()
    return text


def extract_template(wikitext, name):
    """在 wikitext 里按花括号配对取出指定模板全文（返回 None 表示未找到）。"""
    start = wikitext.find('{{' + name)
    if start == -1:
        return None
    pos = start + 2
    depth = 1
    while pos < len(wikitext):
        open_pos = wikitext.find('{{', pos)
        close_pos = wikitext.find('}}', pos)
        if close_pos == -1:
            break
        if open_pos != -1 and open_pos < close_pos:
            depth += 1
            pos = open_pos + 2
        else:
            depth -= 1
            pos = close_pos + 2
            if depth == 0:
                return wikitext[start:pos]
    return wikitext[start:]


def infobox_fields(wikitext):
    infobox = extract_template(wikitext, 'Infobox racehorse')
    if not infobox:
        return {}
    fields = {}
    for line in infobox.splitlines():
        match = pipeline_common.re.match(r'\s*\|\s*([^=|]+?)\s*=\s*(.*)$', line)
        if match:
            fields[match.group(1).strip()] = match.group(2).strip()
    return fields


def field_match(fields, aliases):
    for alias in aliases:
        if alias in fields and fields[alias].strip():
            return strip_markup(fields[alias])
    return ''


def valid_date(value):
    """日期字段须含 4 位年份，滤掉 p=0 等解析杂串与 JBIS 龄数后缀。"""
    text = strip_markup(value or '')
    if not pipeline_common.re.search(r'\d{4}', text):
        return ''
    return pipeline_common.re.sub(r'\s*\(?\d+歳\)?\s*$', '', text).strip()


def split_top_level(text, separator='|'):
    """按顶层分隔符切分（避开 {{...}} 模板与 [[链接|显示名]] 的内层竖线）。"""
    parts = []
    depth = 0
    link = 0
    current = []
    i = 0
    while i < len(text):
        if text.startswith('[[', i):
            link += 1
            current.append('[[')
            i += 2
            continue
        if text.startswith(']]', i):
            link = max(link - 1, 0)
            current.append(']]')
            i += 2
            continue
        char = text[i]
        if char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
        elif char == separator and depth == 0 and link == 0:
            parts.append(''.join(current).strip())
            current = []
            i += 1
            continue
        current.append(char)
        i += 1
    parts.append(''.join(current).strip())
    return parts


def collapse_templates(text):
    """反复把最内层 {{...}} 折叠为其第一个参数。"""
    for _ in range(6):
        changed = pipeline_common.re.sub(r'\{\{[^{}]*\}\}', _collapse_simple, text)
        if changed == text:
            break
        text = changed
    return text


def _collapse_simple(match):
    inner = match.group(0)[2:-2]
    if '|' in inner:
        return inner.split('|', 1)[1].split('|', 1)[0].strip()
    return inner.strip()


def template_span(text, start):
    """返回从 start 处 `{{` 开始的配对模板全文。"""
    depth = 0
    pos = start
    while pos < len(text):
        if text.startswith('{{', pos):
            depth += 1
            pos += 2
        elif text.startswith('}}', pos):
            depth -= 1
            pos += 2
            if depth == 0:
                return text[start:pos]
        else:
            pos += 1
    return text[start:]


def parse_medals(infobox):
    wins = []
    for grade, tag in (
        ('G1', 'MedalGI'), ('G2', 'MedalGII'), ('G3', 'MedalGIII'),
        ('G1', 'MedalI'), ('G2', 'MedalII'), ('G3', 'MedalIII'),
    ):
        for match in pipeline_common.re.finditer(r'\{\{\s*%s\b' % tag, infobox):
            full = template_span(infobox, match.start())
            inner = full[len(match.group(0)):]
            if inner.rstrip().endswith('}}'):
                inner = inner.rstrip()[:-2]
            params = split_top_level(inner)
            race = strip_markup(params[1] if len(params) > 1 else '')
            year = strip_markup(params[2] if len(params) > 2 else '')
            wins.append({'grade': grade, 'race': race, 'year': year})
    seen, out = set(), []
    for win in wins:
        key = (win['grade'], win['race'])
        if key in seen:
            continue
        seen.add(key)
        out.append(win)
    return out


def split_extract_sections(extract):
    sections = {}
    current = ''
    for line in extract.splitlines():
        match = pipeline_common.re.match(r'^(=+)\s*(.*?)\s*\1\s*$', line.strip())
        if match:
            current = match.group(2).strip()
            sections[current] = sections.get(current, [])
        elif line.strip():
            parts = sections.setdefault(current, [])
            parts.append(line.strip())
    return sections


def bucket_for_header(header, patterns):
    for bucket, needles in patterns.items():
        for needle in needles:
            if needle in header:
                return bucket
    return None


def collect_paragraphs(sections, patterns):
    result = {'intro': [], 'career': [], 'retirement': [], 'breeding': [],
              'blood': [], 'origins': []}
    for header, paragraphs in sections.items():
        if header and any(skip in header for skip in pipeline_common.SKIP_HEADERS):
            continue
        if not header:
            result['intro'].extend(paragraphs)
            continue
        bucket = bucket_for_header(header, patterns)
        if bucket:
            result[bucket].extend(paragraphs)
    return result


def trim_paragraphs(items, limit, width):
    out = []
    for item in items:
        if len(out) >= limit:
            break
        text = item.strip()
        if len(text) < 8:
            continue
        if len(text) > width:
            text = text[:width].rstrip() + '…'
        out.append(text)
    return out


def strip_tags(value):
    return pipeline_common.re.sub(r'\s+', ' ', pipeline_common.html_lib.unescape(pipeline_common.re.sub(r'<[^>]+>', '', value or ''))).strip()


def plain_lines(html_text):
    """摊平为保留换行结构的纯文本行列表。"""
    text = pipeline_common.re.sub(r'<(?:/div|/tr|/li|/dd|/dt|br|/table)[^>]*>', '\n', html_text)
    text = pipeline_common.re.sub(r'<[^>]+>', '', text)
    text = pipeline_common.html_lib.unescape(text)
    return [line.strip() for line in text.splitlines() if line.strip()]
