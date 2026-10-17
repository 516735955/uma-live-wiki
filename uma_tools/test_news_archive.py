"""Exercise persisted versions, independent readers, leases and online backups."""
import tempfile
import json
import subprocess
import sqlite3
import sys
from pathlib import Path
import unittest
from news_database import NewsDatabase


class NewsArchiveTest(unittest.TestCase):
    def test_background_result_cannot_replace_review_and_ambiguous_fragments_are_not_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'news.sqlite'
            archive = NewsDatabase(file)
            source = {'detail': {'title': '同じ', 'message': '<p>同じ</p><p>同じ</p><p>別</p>'}}
            archive.put('official-1', source)
            archive.jobs('baidu', claim=True)
            reviewed = dict(source['detail'], title_zh='人工核对', message_zh='<p>相同</p><p>一样</p><p>另一条</p>')
            archive.translate('official-1', 1, reviewed, 'assistant')
            stale = dict(source['detail'], title_zh='机器', message_zh='<p>旧</p><p>旧</p><p>旧</p>')
            archive.translate('official-1', 1, stale, 'baidu')
            self.assertEqual(archive.get('official-1')['detail']['title_zh'], '人工核对')
            # Reopening an old schema rebuilds the ambiguous fragment cache from full texts.
            archive.db.execute('ALTER TABLE fragments DROP COLUMN ambiguous')
            archive.db.commit()
            archive.db.close()
            restored = NewsDatabase(file)
            updated = {'detail': dict(source['detail'], message=source['detail']['message'] + '<p>新</p>')}
            fragments = restored.put('official-1', updated)['detail']['archive_fragments']
            self.assertNotIn('同じ', fragments)
            self.assertEqual(fragments['別'], '另一条')
            self.assertEqual(restored.db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            restored.db.close()

    def test_glossary_maintenance_preserves_versions_urls_and_reusable_fragments(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'news.sqlite'
            archive = NewsDatabase(file)
            source = {'detail': {'announce_id': 1, 'title': 'ぱかライブTV',
                                 'message': '<p>ぱかライブTV</p><a href="https://example.com/ぱかライブTV">URL</a>'}}
            article = archive.put('official-1', source, 'assistant')
            archive.translate('official-1', 1, dict(article['detail'], title_zh='ぱか直播TV',
                              message_zh='<p>ぱか直播TV</p><a href="https://example.com/ぱかライブTV">URL</a>'), 'assistant')
            archive.db.close()
            command = [sys.executable, str(Path(__file__).with_name('archive_news.py')), '--database', str(file), '--normalize-terms']
            subprocess.run(command, check=True, capture_output=True)
            subprocess.run(command, check=True, capture_output=True)
            restored = NewsDatabase(file)
            detail = restored.get('official-1')['detail']
            self.assertEqual(detail['archive_revision'], 1)
            self.assertEqual(detail['translator'], 'assistant')
            self.assertEqual(detail['title_zh'], 'PakaLive TV')
            self.assertIn('href="https://example.com/ぱかライブTV"', detail['message_zh'])
            self.assertEqual(restored.db.execute('SELECT target FROM fragments WHERE source=?', ('ぱかライブTV',)).fetchone()[0], 'PakaLive TV')
            restored.db.close()

    def test_existing_archive_migrates_titles_without_changing_full_text(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'news.sqlite'
            source = {'detail': {'title': 'ニュース', 'message': '<p>原文</p>'}}
            translated = {'title_zh': '归档新闻', 'message_zh': '<p>译文</p>'}
            connection = sqlite3.connect(file)
            connection.executescript('''
                CREATE TABLE versions(article_key TEXT,revision INTEGER,original TEXT,translated TEXT,
                    japanese_text TEXT,chinese_text TEXT,state TEXT,translator TEXT,created_at TEXT,
                    PRIMARY KEY(article_key,revision));
            ''')
            connection.execute('INSERT INTO versions VALUES(?,?,?,?,?,?,?,?,?)',
                ('official-1', 1, json.dumps(source), json.dumps(translated), '原文', '译文', 'complete', 'assistant', '2026-10-17'))
            connection.commit()
            connection.close()
            archive = NewsDatabase(file)
            archive.db.execute('INSERT INTO articles(key,revision,owner,checked_at) VALUES(?,?,?,?)',
                ('official-1', 1, 'assistant', 0))
            archive.db.commit()
            self.assertEqual(archive.dispatch('titles', {}), {'official-1': {'title': 'ニュース', 'title_zh': '归档新闻'}})
            self.assertEqual(archive.get('official-1')['detail']['message_zh'], '<p>译文</p>')
            archive.db.close()

    def test_reviewed_import_retains_its_source_version_after_a_source_update(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'news.sqlite'
            archive = NewsDatabase(file)
            source = {'detail': {'announce_id': 1, 'title': 'ニュース', 'message': '<p>10月17日</p>'}}
            archive.put('official-1', source, 'assistant')
            archive.put('official-1', {'detail': dict(source['detail'], message='<p>10月18日</p>')})
            archive.db.close()
            reviewed = Path(directory) / 'reviewed.json'
            reviewed.write_text(json.dumps([{'key': 'official-1', 'revision': 1,
                                              'title_zh': '新闻', 'message_zh': '<p>10月17日</p>'}], ensure_ascii=False), encoding='utf-8')
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('archive_news.py')),
                                     '--database', str(file), '--import-translations', str(reviewed)],
                                    capture_output=True, text=True, encoding='utf-8', timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            restored = NewsDatabase(file)
            current = restored.get('official-1')['detail']
            self.assertEqual(current['archive_revision'], 2)
            self.assertEqual(current['translation_state'], 'pending')
            self.assertFalse(current.get('message_zh'))
            previous = restored.db.execute('SELECT state,translated FROM versions WHERE article_key=? AND revision=1', ('official-1',)).fetchone()
            self.assertEqual(previous['state'], 'complete')
            self.assertEqual(json.loads(previous['translated'])['message_zh'], '<p>10月17日</p>')
            restored.db.close()

    def test_versions_and_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'news.sqlite'
            first = NewsDatabase(file)
            first.dispatch('register_history', {'keys': ['official-1']})
            source = {'detail': {'announce_id': 1, 'title': 'ニュース', 'message': '<p>10月17日</p>'}}
            article = first.put('official-1', source)
            self.assertEqual(article['detail']['translation_owner'], 'assistant')
            detail = dict(article['detail'], title_zh='新闻', message_zh='<p>10月17日</p>')
            first.translate('official-1', 1, detail, 'assistant')
            self.assertEqual(first.dispatch('titles', {})['official-1']['title_zh'], '新闻')
            second = NewsDatabase(file)
            self.assertEqual(second.get('official-1')['detail']['message_zh'], '<p>10月17日</p>')
            self.assertEqual(second.put('official-1', source)['detail']['archive_revision'], 1)
            self.assertEqual(second.jobs('assistant'), [])
            layout = {'detail': dict(source['detail'], message='<section><p>10月17日</p><img src="new.webp"></section>')}
            reused = second.put('official-1', layout)
            self.assertEqual(reused['detail']['archive_revision'], 2)
            self.assertEqual(reused['detail']['translation_state'], 'complete')
            self.assertEqual(reused['detail']['message_zh'], '<section><p>10月17日</p><img src="new.webp"></section>')
            updated = {'detail': dict(source['detail'], message='<p>10月18日</p>')}
            self.assertEqual(second.put('official-1', updated)['detail']['archive_revision'], 3)
            self.assertFalse(second.get('official-1')['detail'].get('message_zh'))
            self.assertEqual(second.dispatch('titles', {})['official-1']['title_zh'], '新闻')
            self.assertEqual(second.get('official-1')['detail']['archive_fragments']['10月17日'], '10月17日')
            with self.assertRaises(ValueError):
                second.translate('official-1', 3, detail, 'assistant')
            self.assertEqual(len(first.jobs('baidu', claim=True)), 1)
            self.assertEqual(second.jobs('baidu', claim=True), [])
            backup = Path(directory) / 'backup.sqlite'
            first.dispatch('backup', {'path': str(backup)})
            restored = NewsDatabase(backup)
            self.assertEqual(restored.get('official-1')['detail']['archive_revision'], 3)
            second.put('official-1', {'detail': dict(updated['detail'], title='新しいニュース')})
            self.assertNotIn('official-1', second.dispatch('titles', {}))
            restored.db.close()
            first.db.close()
            second.db.close()


if __name__ == '__main__':
    unittest.main()
