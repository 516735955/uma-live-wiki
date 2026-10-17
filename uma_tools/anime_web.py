"""Read explicit episode records from official HTML and Nuxt payloads."""
import json
import re
import urllib.parse
from bs4 import BeautifulSoup


def episode_records(markup, work_id, page_url):
    soup = BeautifulSoup(markup, 'html.parser')
    rows = []
    payload = soup.select_one('#__NUXT_DATA__')
    if payload:
        try:
            values = json.loads(payload.string or payload.get_text())
        except (ValueError, TypeError):
            values = []
        if not isinstance(values, list):
            values = []
        def resolve(index, trail=()):
            if not isinstance(index, int) or index < 0 or index >= len(values) or index in trail:
                return None
            value = values[index]
            trail = (*trail, index)
            if isinstance(value, dict):
                return {key: resolve(child, trail) if isinstance(child, int) else child for key, child in value.items()}
            if isinstance(value, list):
                return [resolve(child, trail) if isinstance(child, int) else child for child in value]
            return value
        for index, item in enumerate(values):
            if not isinstance(item, dict) or not {'title', 'name'} & item.keys() or not {'episodeNumber', 'episode_id', 'num', 'no'} & item.keys():
                continue
            record = resolve(index)
            number = next((record[key] for key in ('episodeNumber', 'episode_id', 'num', 'no') if record.get(key) is not None), None)
            if not str(number).isdigit() or not any(key in record for key in ('story', 'text', 'summary', 'images', 'scene', 'cast', 'staff')):
                continue
            images = record.get('images') or record.get('scene') or []
            images = images if isinstance(images, list) else [images]
            def image_url(image):
                if not image:
                    return ''
                if isinstance(image, str):
                    return urllib.parse.urljoin(page_url, image)
                if isinstance(image, dict):
                    return image_url(image.get('image') or image.get('url') or image.get('src') or '')
                return ''
            rows.append({'work_id': work_id, 'number': int(number), 'title_ja': record.get('title') or record.get('name'),
                         'summary_ja': record.get('story') or record.get('text') or record.get('summary') or '',
                         'release_date': str(record.get('release_date') or record.get('datePublished') or '')[:10],
                         'source_url': page_url, 'staff': record.get('staff') or [], 'cast': record.get('cast') or [],
                         'stills': [url for image in images if (url := image_url(image))]})
    title = soup.select_one('.episode-title, .story-title, #storyOnce h2, .story__title, .episode__title')
    summary = soup.select_one('.episode-summary, .story__description, .story-text, #storyOnce p, .story__contents.type-story')
    number_node = soup.select_one('[data-episode-number]')
    number = number_node.get('data-episode-number') if number_node else ''
    if not number:
        match = re.search(r'第\s*(\d+)\s*[話话集]|#\s*(\d+)', title.get_text() if title else '')
        if not match:
            match = re.search(r'/(?:episodes?|story)/(?:[a-z_-]*)(\d+)(?:[./?]|$)', urllib.parse.urlparse(page_url).path)
        if match:
            number = next(value for value in match.groups() if value)
    if title and summary and str(number).isdigit():
        pictures = soup.select('.episode img, .story img, #storyOnce img, .story__contents img')
        rows.append({'work_id': work_id, 'number': int(number), 'title_ja': title.get_text(' ', strip=True),
                     'summary_ja': summary.get_text(' ', strip=True), 'source_url': page_url,
                     'stills': [urllib.parse.urljoin(page_url, image['src']) for image in pictures if image.get('src')],
                     'staff_text': str(soup.select_one('.staff, .episode-staff') or ''),
                     'music_text': str(soup.select_one('.episode-music, .music-list') or '')})
    return rows


def work_metadata(markup):
    soup = BeautifulSoup(markup, 'html.parser')
    result = {}
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            payload = json.loads(script.string or script.get_text())
        except (ValueError, TypeError):
            continue
        records = payload if isinstance(payload, list) else [payload]
        for row in records:
            if not isinstance(row, dict) or row.get('@type') not in ('TVSeries', 'Movie', 'CreativeWorkSeries'):
                continue
            for source, destination in [('startDate', 'start_date'), ('endDate', 'end_date')]:
                if re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(row.get(source, ''))[:10]):
                    result[destination] = str(row[source])[:10]
            if re.search(r'完結|終了|completed|ended', str(row.get('creativeWorkStatus', '')), re.I):
                result['status'] = 'completed'
    return result
