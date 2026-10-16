"""Fetch complete source articles or import reviewed bilingual translations."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup
from news_database import NewsDatabase

ROOT = Path(__file__).resolve().parents[1]


def source_article(item):
    lantis = item.get('source') == 'lantis'
    key = str(item['announce_id']) if lantis else 'official-' + str(item['announce_id'])
    url = item.get('url') if lantis else 'https://umamusume.jp/api/ajax/pr_info_detail?format=json&announce_id=' + str(item['announce_id'])
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://umamusume.jp/news'})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read(8 * 1024 * 1024 + 1)
    if len(body) > 8 * 1024 * 1024:
        raise ValueError('Article exceeds size budget')
    if not lantis:
        data = json.loads(body.decode('utf-8'))
        if data.get('response_code') != 1 or not data.get('detail', {}).get('announce_id'):
            raise ValueError('Official article unavailable')
        detail = data['detail']
        if not detail.get('title') or not detail.get('message'):
            raise ValueError('Official article incomplete')
        detail['url'] = 'https://umamusume.jp/news/detail?id=' + str(item['announce_id'])
        return key, data
    soup = BeautifulSoup(body.decode('utf-8'), 'html.parser')
    content = soup.select_one('.innercon')
    title = soup.select_one('.newsin_title') or soup.title
    if not content or not content.get_text(strip=True) or not title:
        raise ValueError('Lantis article structure unrecognized')
    for element in content.select('script,style,.ban_more'):
        element.decompose()
    for element in content.select('[src],[href]'):
        for attr in ('src', 'href'):
            if element.get(attr):
                element[attr] = urllib.parse.urljoin(url, element[attr])
    return key, {'response_code': 1, 'detail': {
        'announce_id': item['announce_id'], 'title': title.get_text(' ', strip=True),
        'message': content.decode_contents(), 'post_at': item.get('post_at', ''),
        'source': 'lantis', 'url': url, 'image': item.get('image', '')}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=ROOT / 'data/auto_update/news.sqlite')
    parser.add_argument('--snapshot', type=Path, default=ROOT / 'data/news_snapshot.json')
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--owner', choices=('assistant', 'baidu'), default='assistant')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--export-pending', action='store_true')
    parser.add_argument('--import-translations', type=Path)
    parser.add_argument('--backup', type=Path)
    args = parser.parse_args()
    archive = NewsDatabase(args.database)
    if args.fetch:
        rows = json.loads(args.snapshot.read_text(encoding='utf-8'))['information_list']
        if args.owner == 'assistant':
            archive.dispatch('register_history', {'keys': [str(item['announce_id']) if item.get('source') == 'lantis' else 'official-' + str(item['announce_id']) for item in rows]})
        missing = []
        for item in rows:
            key = str(item['announce_id']) if item.get('source') == 'lantis' else 'official-' + str(item['announce_id'])
            data = archive.get(key)
            failure = archive.dispatch('source_status', {'key': key})
            if not data and failure and failure['next_at'] > time.time():
                continue
            if not data or time.time() - data['detail']['archive_checked_at'] >= 86400:
                missing.append(item)
        if args.limit:
            missing = missing[:args.limit]
        complete, failed = 0, 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, max(1, args.workers))) as pool:
            futures = {pool.submit(source_article, item): item for item in missing}
            for future in concurrent.futures.as_completed(futures):
                try:
                    key, data = future.result()
                    archive.put(key, data, args.owner)
                    complete += 1
                except Exception as error:
                    failed += 1
                    item = futures[future]
                    key = str(item['announce_id']) if item.get('source') == 'lantis' else 'official-' + str(item['announce_id'])
                    archive.dispatch('source_failure', {'key': key, 'error': str(error)})
                    print('source failed:', futures[future]['announce_id'], type(error).__name__, file=sys.stderr, flush=True)
                if (complete + failed) % 25 == 0:
                    print('archived', complete, 'failed', failed, 'remaining', len(missing)-complete-failed, flush=True)
        print('source archive:', complete, 'saved,', failed, 'failed', flush=True)
    if args.import_translations:
        records = json.loads(args.import_translations.read_text(encoding='utf-8'))
        for record in records:
            version = archive.db.execute('SELECT original FROM versions WHERE article_key=? AND revision=?',
                                         (record['key'], record['revision'])).fetchone()
            if not version:
                raise ValueError('Reviewed translation has no archived source version: ' + record['key'])
            original = json.loads(version['original'])['detail']
            detail = record.get('detail') or dict(original, title_zh=record['title_zh'], message_zh=record['message_zh'])
            archive.translate(record['key'], record['revision'], detail, 'assistant')
        print('reviewed translations saved:', len(records))
    if args.backup:
        archive.dispatch('backup', {'path': str(args.backup)})
    if args.export_pending:
        for row in archive.jobs('assistant', args.limit or 10):
            print(json.dumps(row, ensure_ascii=False))
    else:
        print(json.dumps(archive.dispatch('stats', {}), ensure_ascii=False))
    archive.db.close()


if __name__ == '__main__':
    main()
