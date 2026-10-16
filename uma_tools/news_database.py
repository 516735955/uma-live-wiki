"""Transactional bilingual news archive using the Python standard library."""
import argparse
import datetime as dt
from html.parser import HTMLParser
import html
import json
from pathlib import Path
import re
import sqlite3
import sys
import time


def plain_text(html):
    class Text(HTMLParser):
        def __init__(self):
            super().__init__()
            self.parts = []
        def handle_data(self, data):
            self.parts.append(data)
    parser = Text()
    parser.feed(html or '')
    return '\n'.join(part.strip() for part in parser.parts if part.strip())


def text_nodes(markup):
    return [node for node in re.split(r'(<[^>]+>)', markup or '') if node.strip() and not node.startswith('<')]


def reframe_html(source, translated, updated):
    original = text_nodes(source)
    incoming = text_nodes(updated)
    targets = text_nodes(translated)
    normalize = lambda node: re.sub(r'\s+', ' ', html.unescape(node)).strip()
    if not targets or len(original) != len(targets) or list(map(normalize, original)) != list(map(normalize, incoming)):
        return None
    replacements = iter(targets)
    return ''.join(next(replacements) if node.strip() and not node.startswith('<') else node
                   for node in re.split(r'(<[^>]+>)', updated or ''))


class NewsDatabase:
    def __init__(self, file):
        Path(file).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(file), timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA busy_timeout=30000')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS articles (
                key TEXT PRIMARY KEY, revision INTEGER NOT NULL, owner TEXT NOT NULL,
                checked_at REAL NOT NULL, next_at REAL NOT NULL DEFAULT 0,
                lease_until REAL NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS versions (
                article_key TEXT NOT NULL, revision INTEGER NOT NULL,
                original TEXT NOT NULL, translated TEXT,
                japanese_text TEXT NOT NULL, chinese_text TEXT,
                state TEXT NOT NULL DEFAULT 'pending', translator TEXT,
                created_at TEXT NOT NULL,
                PRIMARY KEY(article_key, revision)
            );
            CREATE INDEX IF NOT EXISTS article_jobs ON articles(owner, next_at, lease_until);
            CREATE TABLE IF NOT EXISTS source_failures (
                key TEXT PRIMARY KEY, checked_at REAL NOT NULL, next_at REAL NOT NULL,
                error TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fragments (
                article_key TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL,
                PRIMARY KEY(article_key,source)
            );
        ''')

    def get(self, key):
        row = self.db.execute('''SELECT a.*, v.original, v.translated, v.state, v.translator
            FROM articles a JOIN versions v ON v.article_key=a.key AND v.revision=a.revision
            WHERE a.key=?''', (key,)).fetchone()
        if not row:
            return None
        result = json.loads(row['original'])
        detail = result['detail']
        if row['translated']:
            translated = json.loads(row['translated'])
            detail.update({name: translated.get(name, '') for name in ('title_zh', 'message_zh')})
        detail['translation_state'] = row['state']
        detail['archive_revision'] = row['revision']
        detail['translation_owner'] = row['owner']
        detail['translator'] = row['translator'] or ''
        detail['archive_checked_at'] = row['checked_at']
        if row['state'] != 'complete':
            detail['archive_fragments'] = dict(self.db.execute('SELECT source,target FROM fragments WHERE article_key=?', (key,)))
        return result

    def put(self, key, data, owner='baidu'):
        detail = dict(data['detail'])
        for name in ('title_zh', 'message_zh', 'translation_state', 'archive_revision', 'translation_owner', 'translator', 'archive_checked_at', 'archive_fragments'):
            detail.pop(name, None)
        original = dict(data, detail=detail)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            current = self.db.execute('''SELECT a.revision, v.original, v.state, v.translated, v.translator FROM articles a
                LEFT JOIN versions v ON v.article_key=a.key AND v.revision=a.revision WHERE a.key=?''', (key,)).fetchone()
            revision = current['revision'] if current else 0
            previous = json.loads(current['original'])['detail'] if current and current['original'] else {}
            changed = not current or not current['original'] or any(previous.get(field, '') != detail.get(field, '') for field in ('title', 'message'))
            if changed:
                revision += 1
                reused = {}
                translator = None
                if current and current['translated']:
                    old = json.loads(current['translated'])
                    if previous.get('title') == detail.get('title'):
                        reused['title_zh'] = old.get('title_zh', '')
                    body = reframe_html(previous.get('message'), old.get('message_zh'), detail.get('message'))
                    if body:
                        reused['message_zh'] = body
                    translator = current['translator']
                complete = bool(reused.get('title_zh') and reused.get('message_zh'))
                translated = dict(detail, **reused) if reused else None
                self.db.execute('''INSERT INTO versions(article_key,revision,original,japanese_text,created_at,translated,chinese_text,state,translator)
                    VALUES(?,?,?,?,?,?,?,?,?)''', (key, revision, json.dumps(original, ensure_ascii=False),
                    plain_text(detail.get('message', '')), dt.datetime.now(dt.timezone.utc).isoformat(),
                    json.dumps(translated, ensure_ascii=False) if translated else None,
                    plain_text(reused.get('message_zh', '')), 'complete' if complete else 'pending', translator))
            else:
                self.db.execute('UPDATE versions SET original=? WHERE article_key=? AND revision=?',
                    (json.dumps(original, ensure_ascii=False), key, revision))
            self.db.execute('''INSERT INTO articles(key,revision,owner,checked_at) VALUES(?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET revision=excluded.revision, checked_at=excluded.checked_at,
                next_at=CASE WHEN articles.revision!=excluded.revision THEN 0 ELSE articles.next_at END,
                owner=CASE WHEN articles.revision!=excluded.revision AND ? THEN excluded.owner ELSE articles.owner END''',
                (key, revision, owner, time.time(), bool(current and current['state'] == 'complete')))
            self.db.execute('DELETE FROM source_failures WHERE key=?', (key,))
        return self.get(key)

    def translate(self, key, revision, detail, translator):
        if not detail.get('message_zh') or not detail.get('title_zh'):
            raise ValueError('Complete title and body are required')
        with self.db:
            row = self.db.execute('SELECT original FROM versions WHERE article_key=? AND revision=?', (key, revision)).fetchone()
            if not row:
                raise ValueError('Unknown article version')
            source = json.loads(row['original'])['detail']
            if detail.get('message') != source.get('message') or detail.get('title') != source.get('title'):
                raise ValueError('Translation does not match the original version')
            self.db.execute('''UPDATE versions SET translated=?,chinese_text=?,state='complete',translator=?
                WHERE article_key=? AND revision=?''', (json.dumps({name: detail[name] for name in ('title_zh', 'message_zh')}, ensure_ascii=False),
                plain_text(detail['message_zh']), translator, key, revision))
            self.db.execute("UPDATE articles SET lease_until=0,error='' WHERE key=? AND revision=?", (key, revision))
            sources, targets = text_nodes(source.get('message')), text_nodes(detail['message_zh'])
            if len(sources) == len(targets):
                for original, target in zip(sources, targets):
                    normalized = re.sub(r'\s*\r?\n\s*', ' ', original.strip())
                    self.db.execute('INSERT OR REPLACE INTO fragments(article_key,source,target) VALUES(?,?,?)',
                                    (key, normalized, target.strip()))
        return self.get(key)

    def jobs(self, owner, limit=10, claim=False):
        with self.db:
            if claim:
                self.db.execute('BEGIN IMMEDIATE')
            rows = self.db.execute('''SELECT a.key FROM articles a JOIN versions v
                ON v.article_key=a.key AND v.revision=a.revision
                WHERE a.owner=? AND v.state!='complete' AND a.next_at<=? AND a.lease_until<=?
                ORDER BY a.checked_at, a.key LIMIT ?''', (owner, time.time(), time.time(), min(100, max(1, limit)))).fetchall()
            if claim:
                for row in rows:
                    self.db.execute('UPDATE articles SET lease_until=? WHERE key=?', (time.time()+300, row['key']))
        return [{'key': row['key'], 'data': self.get(row['key'])} for row in rows]

    def dispatch(self, operation, args):
        if operation == 'register_history':
            with self.db:
                self.db.executemany("INSERT OR IGNORE INTO articles(key,revision,owner,checked_at) VALUES(?,0,'assistant',0)",
                                    [(key,) for key in args['keys']])
            return True
        if operation == 'get':
            return self.get(args['key'])
        if operation == 'source_failure':
            with self.db:
                self.db.execute('INSERT OR REPLACE INTO source_failures(key,checked_at,next_at,error) VALUES(?,?,?,?)',
                                (args['key'], time.time(), time.time()+3600, args.get('error', 'source unavailable')[:200]))
            return True
        if operation == 'source_status':
            row = self.db.execute('SELECT * FROM source_failures WHERE key=?', (args['key'],)).fetchone()
            return dict(row) if row else None
        if operation == 'put':
            return self.put(args['key'], args['data'], args.get('owner', 'baidu'))
        if operation == 'translate':
            return self.translate(args['key'], args['revision'], args['detail'], args['translator'])
        if operation == 'jobs':
            return self.jobs(args.get('owner', 'baidu'), args.get('limit', 10), args.get('claim', False))
        if operation == 'retry':
            with self.db:
                self.db.execute('UPDATE articles SET next_at=?,lease_until=0,error=? WHERE key=?',
                    (time.time()+max(60, args.get('delay', 3600)), args.get('error', 'translation incomplete')[:200], args['key']))
            return True
        if operation == 'stats':
            return [dict(row) for row in self.db.execute('''SELECT a.owner,v.state,count(*) AS count
                FROM articles a JOIN versions v ON v.article_key=a.key AND v.revision=a.revision GROUP BY a.owner,v.state
                UNION ALL SELECT owner,'awaiting_source',count(*) FROM articles WHERE revision=0 GROUP BY owner''')]
        if operation == 'backup':
            destination = sqlite3.connect(args['path'])
            try:
                self.db.backup(destination)
            finally:
                destination.close()
            return True
        raise ValueError('Unknown archive operation')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file')
    args = parser.parse_args()
    archive = NewsDatabase(args.file)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            result = archive.dispatch(request['operation'], request.get('args', {}))
            response = {'id': request.get('id'), 'result': result}
        except Exception as error:
            response = {'id': request.get('id'), 'error': str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)
    archive.db.close()


if __name__ == '__main__':
    main()
