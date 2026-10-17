"""Exercise source identity, date boundaries and bounded maintenance writes."""
import io
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import urllib.error

import auto_setlists as sheets
import knowledge_io
import sync_pedigree_sources as pedigree
from events_pipeline.text import all_dates, event_date_for_day
from events_pipeline.archives import wiki_table_rows
from events_pipeline.events import category_events
from horses_pipeline import races, transport, cli
from horses_pipeline.photos import _url_matches, valid_photo


class SourceBoundaryTests(unittest.TestCase):
    def test_merged_title_starts_a_new_date_block(self):
        rows = [['2026-10-17', 'LIVE', 'M1. A', '甲'], ['2026-10-18', None, 'M1. B', '乙']]
        blocks = sheets.parse_rows(rows)
        self.assertEqual([b['date'] for b in blocks], ['2026-10-17', '2026-10-18'])
        self.assertEqual([len(b['songs']) for b in blocks], [1, 1])
        self.assertNotEqual(sheets.normalized_title('LIVE（昼公演）'), sheets.normalized_title('LIVE（夜公演）'))
        self.assertNotEqual(sheets.session_label('LIVE（昼公演）'), sheets.session_label('LIVE（夜公演）'))

    def test_explicit_dates_and_year_boundary(self):
        self.assertEqual(all_dates('2026年12月31日・1月1日'), ['2026-12-31', '2027-01-01'])
        self.assertEqual(event_date_for_day('2026.10.17、2026.10.24', 1), '2026-10-24')
        catalog = {'other': {'groups': [{'subs': [{'title': 'LIVE', 'date': '2026-10-17', 'days': [{}, {}]}]}]}}
        self.assertEqual([s['date'] for s in sheets.curated_slots(catalog)], ['2026-10-17', '2026-10-18'])

    def test_wiki_headers_and_inline_cells_preserve_first_row(self):
        source = '{| class="wikitable"\n|+ Cap\n! Header !! Other\n|-\n| first || one\n|-\n| second || two\n|}'
        self.assertEqual(wiki_table_rows(source, 'Cap'), [['first', 'one'], ['second', 'two']])

    def test_category_title_edit_preserves_primary_key(self):
        sub = {'title': 'Before', 'date': '2026-10-17', 'days': []}
        source = {'other': {'groups': [{'subs': [sub]}]}}
        first = category_events(source, None, set())[0]['id']
        sub['title'] = 'Corrected'
        self.assertEqual(category_events(source, None, set())[0]['id'], first)

    def test_jbis_wrong_birth_year_does_not_choose_first(self):
        page = '<a href="/horse/abc/" class="txt-link">Horse</a>'
        with patch.object(races.pipeline_transport, 'http_get', side_effect=[page, '生年月日</dt><dd>1999年1月1日</dd>']):
            self.assertEqual(races.search_jbis_url('Horse', 2000), '')

    def test_horse_sex_and_birth_template_are_canonical(self):
        raw = '{{競走馬\n|生 = {{生年月日と馬齢|2000|1|1}}\n|性 = セン\n}}'
        with patch.object(pedigree, 'fetch', return_value=json.dumps({'parse': {'title': 'Horse', 'wikitext': {'*': raw}}})):
            horse = pedigree.horse_page('Horse')
        self.assertEqual((horse['born'], horse['sex']), (2000, 'gelding'))
        source = {'nodes': [{'id': 'h', 'ja': 'Horse', 'parents': {'sire': 's', 'dam': 'd'}}], 'character_mappings': {}}
        pedigree.add_horse(source, {'id': 'h', 'ja': 'Horse'}, lookup=lambda name: {**horse, 'source_url': 'source'})
        self.assertEqual(source['nodes'][0]['born'], 2000)

    def test_response_size_deadline_and_permanent_http_errors(self):
        with self.assertRaises(ValueError):
            knowledge_io.bounded_read(io.BytesIO(b'123456'), limit=5)
        with self.assertRaises(TimeoutError):
            knowledge_io.bounded_read(io.BytesIO(b'data'), deadline=time.monotonic() - 1)
        with patch.object(knowledge_io.urllib.request, 'urlopen', side_effect=urllib.error.HTTPError('url', 404, 'missing', {}, None)) as request:
            with self.assertRaises(urllib.error.HTTPError):
                knowledge_io.fetch('https://example.test/missing')
            self.assertEqual(request.call_count, 1)

    def test_photo_identity_grade_and_owned_cache_eviction(self):
        self.assertTrue(_url_matches('Oguri Cap', 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Oguri_Cap.jpg'))
        self.assertFalse(valid_photo(io.BytesIO(b'not an image' * 1000)))
        self.assertEqual(races.normalized_grade('ＧⅡ'), 'G2')
        self.assertEqual(races.normalized_grade('OP'), 'OP')
        rows = races.parse_wiki_races('==競走成績==\n{|\n|-\n|17/10/2026||US||Track||芝8.5f||OP||Race||55||Jockey||1||10||1||1:00||Other\n|}', 'zh')
        self.assertEqual(rows[0]['distance'], '1710')
        with tempfile.TemporaryDirectory() as root:
            cache = Path(root) / ('a' * 16 + '.txt'); cache.write_text('old')
            detail = Path(root) / 'detail_h.json'; detail.write_text('{}')
            import os
            os.utime(cache, (time.time() - 8 * 86400,) * 2)
            with patch.object(transport.pipeline_common, 'CACHE_DIR', root), patch.object(transport, '_last_cleanup', 0):
                transport.cleanup_cache()
            self.assertFalse(cache.exists())
            self.assertTrue(detail.exists())

    def test_partial_horse_command_retains_unselected_records(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            rows = [{'id': key, 'zh': key, 'ja': key, 'en': key, 'sex': 'male', 'born': 2000,
                     'country': 'JP', 'cids': [], 'photo': '', 'jbis': ''} for key in ('a', 'b')]
            detail, listing = root / 'detail.js', root / 'list.js'
            detail.write_text('window.DETAIL = ' + json.dumps({r['id']: r for r in rows}) + ';')
            listing.write_text('window.LIST = ' + json.dumps(rows) + ';')
            (root / 'detail_a.json').write_text(json.dumps(rows[0]))
            with patch.object(cli.pipeline_common.sys, 'argv', ['crawl_horses.py', '--limit', '1', '--resume']), \
                 patch.object(cli.pipeline_registry, 'load_pedigree_source', return_value={}), \
                 patch.object(cli.pipeline_registry, 'build_horses', return_value=rows), \
                 patch.object(cli.pipeline_common, 'ROOT', str(root)), \
                 patch.object(cli.pipeline_common, 'OUT_DETAIL', str(detail)), \
                 patch.object(cli.pipeline_common, 'OUT_LIST', str(listing)), \
                 patch.object(cli.pipeline_common, 'CACHE_DIR', str(root)):
                self.assertEqual(cli.main(), 0)
            self.assertEqual(len(json.loads(detail.read_text().split('=', 1)[1].strip().rstrip(';'))), 2)
            self.assertEqual(len(json.loads(listing.read_text().split('=', 1)[1].strip().rstrip(';'))), 2)


if __name__ == '__main__':
    unittest.main()
