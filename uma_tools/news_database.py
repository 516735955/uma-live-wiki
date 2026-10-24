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
            self.hidden = 0
        def handle_starttag(self, tag, attrs):
            if tag in ('script', 'style'):
                self.hidden += 1
            if tag in ('p', 'div', 'li', 'br', 'section', 'article', 'tr', 'h1', 'h2', 'h3', 'blockquote'):
                self.parts.append('\n')
        def handle_endtag(self, tag):
            if tag in ('script', 'style'):
                self.hidden = max(0, self.hidden - 1)
            if tag in ('p', 'div', 'li', 'section', 'article', 'tr', 'h1', 'h2', 'h3', 'blockquote'):
                self.parts.append('\n')
        def handle_data(self, data):
            if not self.hidden:
                self.parts.append(re.sub(r'\s+', ' ', data))
    parser = Text()
    parser.feed(html or '')
    return '\n'.join(line.strip() for line in ''.join(parser.parts).splitlines() if line.strip())


def text_nodes(markup):
    return [node for node in re.split(r'(<[^>]+>)', markup or '') if node.strip() and not node.startswith('<')]


def reframe_html(source, translated, updated):
    original = text_nodes(source)
    incoming = text_nodes(updated)
    targets = text_nodes(translated)
    normalize = lambda node: re.sub(r'\s+', ' ', html.unescape(node)).strip()
    if not targets or len(original) != len(targets) or list(map(normalize, original)) != list(map(normalize, incoming)):
        if not plain_text(source) or plain_text(source) != plain_text(updated) or not translated:
            return None

        class Resources(HTMLParser):
            def __init__(self, markup):
                super().__init__(convert_charrefs=True)
                self.rows = []
                self.feed(markup or '')
            def handle_starttag(self, tag, attrs):
                self.rows.extend((tag, key, value or '') for key, value in attrs if key in ('src', 'href'))
            handle_startendtag = handle_starttag

        before, after = Resources(source).rows, Resources(updated).rows
        if [(tag, key) for tag, key, _ in before] != [(tag, key) for tag, key, _ in after]:
            return None
        replacements = {}
        for (tag, key, previous), (_, _, value) in zip(before, after):
            identity = (key, previous)
            if identity in replacements and replacements[identity] != value:
                return None
            replacements[identity] = value

        def sync_tag(match):
            def sync_attribute(attribute):
                prefix, quote, value = attribute.groups()
                key = prefix.split('=')[0].strip().lower()
                replacement = replacements.get((key, html.unescape(value)), value)
                return prefix + quote + html.escape(replacement, quote=True) + quote
            return re.sub(r'(\b(?:src|href)\s*=\s*)(["\'])(.*?)\2', sync_attribute, match.group(0), flags=re.I)

        return re.sub(r'<[^>]+>', sync_tag, translated)
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
                original_title TEXT NOT NULL DEFAULT '', translated_title TEXT NOT NULL DEFAULT '',
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
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            columns = {row['name'] for row in self.db.execute('PRAGMA table_info(versions)')}
            if 'original_title' not in columns:
                self.db.execute("ALTER TABLE versions ADD COLUMN original_title TEXT NOT NULL DEFAULT ''")
                self.db.execute("ALTER TABLE versions ADD COLUMN translated_title TEXT NOT NULL DEFAULT ''")
                for row in self.db.execute('SELECT article_key,revision,original,translated FROM versions').fetchall():
                    original = json.loads(row['original'])['detail']
                    translated = json.loads(row['translated']) if row['translated'] else {}
                    self.db.execute('UPDATE versions SET original_title=?,translated_title=? WHERE article_key=? AND revision=?',
                        (original.get('title', ''), translated.get('title_zh', ''), row['article_key'], row['revision']))
            fragment_columns = {row['name'] for row in self.db.execute('PRAGMA table_info(fragments)')}
            if 'ambiguous' not in fragment_columns:
                self.db.execute('ALTER TABLE fragments ADD COLUMN ambiguous INTEGER NOT NULL DEFAULT 0')
                self.db.execute('DELETE FROM fragments')
                for row in self.db.execute('SELECT article_key,original,translated FROM versions WHERE translated IS NOT NULL ORDER BY revision').fetchall():
                    self.store_fragments(row['article_key'], json.loads(row['original'])['detail'].get('message', ''),
                                         json.loads(row['translated']).get('message_zh', ''))
            if self.db.execute('PRAGMA user_version').fetchone()[0] < 1:
                for row in self.db.execute('SELECT article_key,revision,original,translated FROM versions'):
                    original = json.loads(row['original'])['detail']
                    translated = json.loads(row['translated']) if row['translated'] else {}
                    self.db.execute('UPDATE versions SET japanese_text=?,chinese_text=? WHERE article_key=? AND revision=?',
                                    (plain_text(original.get('message', '')), plain_text(translated.get('message_zh', '')), row['article_key'], row['revision']))
                self.db.execute('PRAGMA user_version=1')
            if self.db.execute('PRAGMA user_version').fetchone()[0] < 3:
                pending = self.db.execute('''SELECT a.key,a.revision,v.original,old.original AS previous,
                    old.translated,old.translator FROM articles a JOIN versions v
                    ON v.article_key=a.key AND v.revision=a.revision JOIN versions old
                    ON old.article_key=a.key AND old.revision<a.revision
                    WHERE v.state!='complete' AND old.state='complete' ORDER BY a.key,old.revision DESC''').fetchall()
                repaired = set()
                for row in pending:
                    if row['key'] in repaired:
                        continue
                    source = json.loads(row['original'])['detail']
                    previous = json.loads(row['previous'])['detail']
                    accepted = json.loads(row['translated'])
                    if html.unescape(source.get('title', '')) != html.unescape(previous.get('title', '')) or not accepted.get('title_zh'):
                        continue
                    body = reframe_html(previous.get('message'), accepted.get('message_zh'), source.get('message'))
                    if not body:
                        continue
                    accepted['message_zh'] = body
                    self.db.execute('''UPDATE versions SET translated=?,chinese_text=?,translated_title=?,state='complete',translator=?
                        WHERE article_key=? AND revision=?''', (json.dumps(accepted, ensure_ascii=False), plain_text(body), accepted['title_zh'], row['translator'], row['key'], row['revision']))
                    self.db.execute("UPDATE articles SET owner=?,error='',lease_until=0 WHERE key=?", (row['translator'] or 'assistant', row['key']))
                    self.store_fragments(row['key'], source.get('message'), body)
                    repaired.add(row['key'])
                self.db.execute("UPDATE articles SET owner='assistant' WHERE EXISTS (SELECT 1 FROM versions v WHERE v.article_key=articles.key AND v.revision=articles.revision AND v.state='complete' AND v.translator='assistant')")
                self.db.execute('PRAGMA user_version=3')

    def store_fragments(self, key, original, translated):
        self.db.execute('DELETE FROM fragments WHERE article_key=?', (key,))
        sources, targets = text_nodes(original), text_nodes(translated)
        if len(sources) != len(targets):
            return
        grouped = {}
        for source, target in zip(sources, targets):
            normalized = re.sub(r'\s*\r?\n\s*', ' ', source.strip())
            grouped.setdefault(normalized, set()).add(target.strip())
        for source, choices in grouped.items():
            ambiguous = len(choices) != 1
            self.db.execute('INSERT OR REPLACE INTO fragments(article_key,source,target,ambiguous) VALUES(?,?,?,?)',
                            (key, source, '' if ambiguous else next(iter(choices)), ambiguous))

    def get(self, key, revision=None):
        row = self.db.execute('''SELECT a.*, v.original, v.translated, v.state, v.translator
            FROM articles a JOIN versions v ON v.article_key=a.key AND v.revision=a.revision
            WHERE a.key=? AND v.revision=COALESCE(?, a.revision)''', (key, revision)).fetchone()
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
            detail['archive_fragments'] = dict(self.db.execute('SELECT source,target FROM fragments WHERE article_key=? AND ambiguous=0', (key,)))
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
            translation_incomplete = False
            if changed:
                revision += 1
                reused = {}
                translator = None
                if current and current['translated']:
                    old = json.loads(current['translated'])
                    if html.unescape(previous.get('title', '')) == html.unescape(detail.get('title', '')):
                        reused['title_zh'] = old.get('title_zh', '')
                    body = reframe_html(previous.get('message'), old.get('message_zh'), detail.get('message'))
                    if body:
                        reused['message_zh'] = body
                    # A changed node shape cannot be aligned safely; invalidate
                    # only projections whose source node disappeared. Unique
                    # nodes that remain in the new body stay reusable.
                    if len(text_nodes(previous.get('message'))) != len(text_nodes(detail.get('message'))):
                        surviving = sorted({re.sub(r'\s*\r?\n\s*', ' ', node.strip())
                                            for node in text_nodes(detail.get('message'))})
                        if surviving:
                            marks = ','.join('?' for _ in surviving)
                            self.db.execute('DELETE FROM fragments WHERE article_key=? AND source NOT IN (' + marks + ')',
                                            (key, *surviving))
                        else:
                            self.db.execute('DELETE FROM fragments WHERE article_key=?', (key,))
                    translator = current['translator']
                complete = bool(reused.get('title_zh') and reused.get('message_zh'))
                translation_incomplete = not complete
                translated = dict(detail, **reused) if reused else None
                self.db.execute('''INSERT INTO versions(article_key,revision,original,japanese_text,created_at,translated,chinese_text,state,translator,original_title,translated_title)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?)''', (key, revision, json.dumps(original, ensure_ascii=False),
                    plain_text(detail.get('message', '')), dt.datetime.now(dt.timezone.utc).isoformat(),
                    json.dumps(translated, ensure_ascii=False) if translated else None,
                    plain_text(reused.get('message_zh', '')), 'complete' if complete else 'pending', translator,
                    detail.get('title', ''), reused.get('title_zh', '')))
            else:
                self.db.execute('UPDATE versions SET original=? WHERE article_key=? AND revision=?',
                    (json.dumps(original, ensure_ascii=False), key, revision))
            self.db.execute('''INSERT INTO articles(key,revision,owner,checked_at) VALUES(?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET revision=excluded.revision, checked_at=excluded.checked_at,
                next_at=CASE WHEN articles.revision!=excluded.revision THEN 0 ELSE articles.next_at END,
                lease_until=CASE WHEN articles.revision!=excluded.revision THEN 0 ELSE articles.lease_until END,
                owner=CASE WHEN articles.revision!=excluded.revision AND ? THEN excluded.owner ELSE articles.owner END''',
                (key, revision, owner, time.time(), bool(current and current['state'] == 'complete' and translation_incomplete)))
            self.db.execute('DELETE FROM source_failures WHERE key=?', (key,))
        return self.get(key)

    def translate(self, key, revision, detail, translator):
        if not detail.get('message_zh') or not detail.get('title_zh'):
            raise ValueError('Complete title and body are required')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self.db.execute('SELECT original,state FROM versions WHERE article_key=? AND revision=?', (key, revision)).fetchone()
            if not row:
                raise ValueError('Unknown article version')
            source = json.loads(row['original'])['detail']
            if detail.get('message') != source.get('message') or detail.get('title') != source.get('title'):
                raise ValueError('Translation does not match the original version')
            if translator == 'baidu' and row['state'] == 'complete':
                return self.get(key)
            self.db.execute('''UPDATE versions SET translated=?,chinese_text=?,state='complete',translator=?,translated_title=?
                WHERE article_key=? AND revision=?''', (json.dumps({name: detail[name] for name in ('title_zh', 'message_zh')}, ensure_ascii=False),
                plain_text(detail['message_zh']), translator, detail['title_zh'], key, revision))
            self.db.execute("UPDATE articles SET lease_until=0,error='' WHERE key=? AND revision=?", (key, revision))
            current = self.db.execute('SELECT revision FROM articles WHERE key=?', (key,)).fetchone()
            if current and current['revision'] == revision:
                self.store_fragments(key, source.get('message'), detail['message_zh'])
        return self.get(key)

    def jobs(self, owner, limit=10, claim=False):
        payload = []
        with self.db:
            if claim:
                self.db.execute('BEGIN IMMEDIATE')
            rows = self.db.execute('''SELECT a.key,a.revision FROM articles a JOIN versions v
                ON v.article_key=a.key AND v.revision=a.revision
                WHERE a.owner=? AND v.state!='complete' AND a.next_at<=? AND a.lease_until<=?
                ORDER BY a.checked_at, a.key LIMIT ?''', (owner, time.time(), time.time(), min(100, max(1, limit)))).fetchall()
            if claim:
                for row in rows:
                    self.db.execute('UPDATE articles SET lease_until=? WHERE key=?', (time.time()+300, row['key']))
            # Read the claimed revision while the write lock is held. A later
            # put() must not change the body paired with this lease.
            payload = [{'key': row['key'], 'data': self.get(row['key'], row['revision'])} for row in rows]
        return payload

    def dispatch(self, operation, args):
        if operation == 'register_history':
            with self.db:
                self.db.executemany("INSERT OR IGNORE INTO articles(key,revision,owner,checked_at) VALUES(?,0,'assistant',0)",
                                    [(key,) for key in args['keys']])
            return True
        if operation == 'get':
            return self.get(args['key'])
        if operation == 'titles':
            return {row['key']: {'title': row['original_title'], 'title_zh': row['translated_title']}
                    for row in self.db.execute('''SELECT a.key,v.original_title,v.translated_title
                        FROM articles a JOIN versions v ON v.article_key=a.key AND v.revision=a.revision
                        WHERE v.translated_title!='' ''')}
        if operation == 'search':
            query = str(args.get('q', '')).strip().casefold()
            if not query:
                return []
            limit = min(200, max(1, int(args.get('limit', 50))))
            like = '%' + query + '%'
            rows = self.db.execute('''SELECT a.key,a.revision,v.original_title,v.translated_title,v.state,
                    v.japanese_text,v.chinese_text
                FROM articles a JOIN versions v ON v.article_key=a.key AND v.revision=a.revision
                WHERE lower(v.original_title) LIKE ? OR lower(v.translated_title) LIKE ?
                   OR lower(v.japanese_text) LIKE ? OR lower(COALESCE(v.chinese_text,'')) LIKE ?
                ORDER BY a.checked_at DESC LIMIT ?''', (like, like, like, like, limit)).fetchall()
            return [dict(row) for row in rows]
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
                self.db.execute('UPDATE articles SET next_at=?,lease_until=0,error=? WHERE key=? AND revision=?',
                    (time.time()+max(60, args.get('delay', 3600)), args.get('error', 'translation incomplete')[:200], args['key'], args['revision']))
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
