"""Regression cases for interrupted publication and incremental source updates."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import crawl_lantis_news as lantis
import sync_anime_watch as watch
from catalog_publication import publish_catalog
from events_pipeline.common import atomic_json
from news_database import NewsDatabase
from auto_setlists import parse_worksheet


class MainDebugTests(unittest.TestCase):
    def test_publication_recovers_after_each_possible_interruption(self):
        for interrupted_at in range(1, 7):
            with self.subTest(interrupted_at=interrupted_at), tempfile.TemporaryDirectory() as directory:
                outputs = {str(i): Path(directory) / (str(i) + '.json') for i in range(6)}
                old = {key: {'build_id': 'old', 'value': key} for key in outputs}
                new = {key: {'build_id': 'new', 'value': key} for key in outputs}
                for key, file in outputs.items():
                    atomic_json(file, old[key])
                writes = 0

                def interrupted(file, value):
                    nonlocal writes
                    atomic_json(file, value)
                    if file.name != 'catalog_pending.json':
                        writes += 1
                        if writes == interrupted_at:
                            raise RuntimeError('simulated termination')

                with self.assertRaises(RuntimeError):
                    publish_catalog(outputs, new, interrupted)
                pending = Path(directory) / 'auto_update/catalog_pending.json'
                self.assertEqual({value['build_id'] for value in json.loads(pending.read_text()).values()}, {'old'})
                publish_catalog(outputs, new, atomic_json)
                self.assertFalse(pending.exists())
                self.assertEqual({json.loads(file.read_text())['build_id'] for file in outputs.values()}, {'new'})

    def test_old_translation_retry_does_not_delay_new_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = NewsDatabase(Path(directory) / 'news.sqlite')
            try:
                archive.put('official-1', {'detail': {'title': 'ニュース', 'message': '<p>1日</p>'}})
                archive.jobs('baidu', claim=True)
                archive.put('official-1', {'detail': {'title': 'ニュース', 'message': '<p>2日</p>'}})
                archive.dispatch('retry', {'key': 'official-1', 'revision': 1, 'delay': 3600})
                self.assertEqual(len(archive.jobs('baidu', claim=True)), 1)
            finally:
                archive.db.close()

    def test_sheet_header_and_first_song_share_a_row(self):
        class Sheet:
            def iter_rows(self, **kwargs):
                return iter([('2026-10-17', 'LIVE', 'M01 Song', '甲\n乙')])
        self.assertEqual(parse_worksheet(Sheet())[0]['songs'], [{'no': '1', 'name': 'Song', 'performers': ['甲', '乙']}])

    def test_lantis_unknown_layout_and_truncation_fail(self):
        lantis.SOURCE_FAILURES.clear()
        with patch.object(lantis, 'fetch', return_value='<title>Login</title>'):
            self.assertEqual(lantis.crawl_category('https://example.test/', 'https://example.test', set()), [])
        self.assertTrue(lantis.SOURCE_FAILURES)
        lantis.SOURCE_FAILURES.clear()
        page = '<ul class="news_list"><li><span class="list_time">2026.10.17</span><a href="https://example.test/nonnumeric">News</a></li></ul><a>NEXT</a>'
        with patch.object(lantis, 'fetch', return_value=page), patch.object(lantis, 'MAX_PAGES', 1), patch.object(lantis.time, 'sleep'):
            first = lantis.crawl_category('https://example.test/', 'https://example.test', set())
            second = lantis.crawl_category('https://example.test/', 'https://example.test', set())
        self.assertEqual(first[0]['id'], second[0]['id'])
        self.assertRegex(first[0]['id'], r'^lantis-[1-9]\d*$')
        self.assertLess(int(first[0]['id'].split('-')[1]), 2**53)
        self.assertTrue(lantis.SOURCE_FAILURES)

    def test_watch_login_and_generic_pages_are_not_active(self):
        class Response(io.BytesIO):
            status = 200
            def geturl(self):
                return 'https://example.test/series/1'
        resource = {'url': 'https://example.test/series/1', 'platform': 'bilibili'}
        for title, expected in [('Login', 'source_unavailable'), ('Provider', 'source_unavailable'), ('赛马娘 第二季', 'active')]:
            with patch.object(watch.urllib.request, 'urlopen', return_value=Response(('<title>' + title + '</title>').encode())):
                self.assertEqual(watch.check_resource(resource)[0], expected)


if __name__ == '__main__':
    unittest.main()
