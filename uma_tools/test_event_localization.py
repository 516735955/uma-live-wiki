"""Exercise source updates and concurrent publication without network calls."""
import json
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from event_localization import apply_localizations
from publish_event_sources import preserve_collaborator_changes, parse_source, merge_localizations
from events_pipeline import program_discovery


class EventLocalizationTests(unittest.TestCase):
    def test_publication_keeps_reviewed_copy_and_actual_translator(self):
        reviewed = {'records': {'manual': {'title_ja': '同じ原文', 'title_zh': '人工修正', 'translator': 'assistant'}}}
        runtime = {'records': {
            'manual': {'title_ja': '同じ原文', 'title_zh': '机器版本', 'title_translator': 'baidu'},
            'source': {'summary_ja': '已是中文', 'summary_zh': '已是中文', 'summary_translator': 'source'},
            'new': {'summary_ja': '新しい説明', 'summary_zh': '人工新译文', 'summary_translator': 'assistant'},
            'legacy': {'title_ja': '不明な翻訳', 'title_zh': '旧缓存译文'},
        }}
        merge_localizations(reviewed, runtime)
        self.assertEqual(reviewed['records']['manual']['title_zh'], '人工修正')
        self.assertEqual(reviewed['records']['source']['summary_translator'], 'source')
        self.assertEqual(reviewed['records']['new']['summary_translator'], 'assistant')
        self.assertEqual(reviewed['records']['legacy']['title_translator'], 'unknown')

    def test_stale_metadata_cannot_replace_fresh_fields_or_high_resolution_thumbnail(self):
        from events_pipeline.program_merge import apply_additive_program_refresh
        old = {'id': 'p', 'title': 'ぱかライブTV Vol.1', 'date': '2026-01-01', 'video_id': 'abcdefghijk',
               'source_kind': 'official_youtube', 'metadata_checked_at': 200,
               'thumbnail': 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg', 'duration': 90,
               'summary': '已核实简介', 'published_time': '19:00', 'manual_fields': ['title', 'published_time', 'cast'],
               'cast': [{'name': '人工出演者'}]}
        stale = {**old, 'metadata_checked_at': 100, 'summary': '旧简介', 'duration': 80,
                 'thumbnail': 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', 'title': '旧标题',
                 'published_time': '18:00', 'cast': [{'name': '旧出演者'}]}
        merged, _ = apply_additive_program_refresh({'programs': [old]}, {'programs': [stale]})
        self.assertEqual(merged['programs'][0], old)
        fresh = {**old, 'metadata_checked_at': 300, 'summary': '来源新简介', 'thumbnail': stale['thumbnail']}
        merged, _ = apply_additive_program_refresh({'programs': [old]}, {'programs': [fresh]})
        self.assertEqual(merged['programs'][0]['summary'], '来源新简介')
        self.assertEqual(merged['programs'][0]['thumbnail'], old['thumbnail'])

    def test_complete_past_program_uses_listing_change_signal_and_expiry(self):
        existing = {'title': 'ぱかライブTV Vol.1', 'date': '2020-01-01', 'cast_status': 'verified',
                    'metadata_checked_at': program_discovery.pipeline_common.time.time()}
        listing = {'id': 'abcdefghijk', 'title': '「ウマ娘」ぱかライブTV Vol.1'}
        with patch.object(program_discovery, 'cached_video_metadata', return_value=None):
            self.assertFalse(program_discovery.existing_metadata_is_due(existing, listing))
            self.assertTrue(program_discovery.existing_metadata_is_due(existing, {**listing, 'title': 'ぱかライブTV Vol.2'}))
            self.assertTrue(program_discovery.existing_metadata_is_due({**existing, 'metadata_checked_at': 1}, listing))
    def test_publication_preserves_historical_javascript_data_syntax(self):
        source = "window.CHAR_DETAIL = {demo: {html: '中文简介'}};"
        self.assertEqual(parse_source('data/character_detail_data.js', source), {'demo': {'html': '中文简介'}})
    def test_official_watch_fallback_validates_identity_and_uses_broadcast_date(self):
        player = {'videoDetails': {'videoId': 'abcdefghijk', 'channelId': 'official',
                                  'title': '番組', 'shortDescription': '公式番組', 'lengthSeconds': '60'},
                  'microformat': {'playerMicroformatRenderer': {
                      'publishDate': '2026-10-13T12:00:00+09:00',
                      'liveBroadcastDetails': {'startTimestamp': '2026-10-24T20:00:00+09:00'}}}}
        markup = ('var ytInitialPlayerResponse = '+json.dumps(player)+';').encode()
        with patch.object(program_discovery.pipeline_common.urllib.request, 'urlopen', return_value=io.BytesIO(markup)):
            result = program_discovery.public_watch_metadata('abcdefghijk')
        self.assertEqual(program_discovery._approximate_date(result), '2026-10-24')
        self.assertEqual(result['channel_id'], 'official')
        with patch.object(program_discovery.pipeline_common.urllib.request, 'urlopen', return_value=io.BytesIO(markup)):
            with self.assertRaises(ValueError):
                program_discovery.public_watch_metadata('another-id')

    def test_official_watch_metadata_uses_primary_html_date_when_microformat_is_absent(self):
        page = b'<link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk"><meta content="2026-10-23T02:00:03-07:00" itemprop="datePublished"><meta content="Program title" itemprop="name">'
        with patch.object(program_discovery.pipeline_common.urllib.request, 'urlopen', return_value=io.BytesIO(page)):
            value = program_discovery.public_watch_metadata('abcdefghijk', 'official')
        self.assertEqual(program_discovery._approximate_date(value), '2026-10-23')
        self.assertEqual(value['channel_id'], 'official')

    def test_movie_index_reads_entries_in_both_arrays_without_collecting_promotional_clips(self):
        index = {'latest': [{'url': 'abcdefghijk', 'title': '【ゲーム実況】Gang Beasts'}],
                 'shorts': [{'url': 'lmnopqrstuv', 'title': '新CM公開'}]}
        with tempfile.TemporaryDirectory() as folder, patch.object(program_discovery, 'discover_channel_feed', return_value=program_discovery.DiscoveryRows()), patch.object(program_discovery, 'fetch_json_url', return_value=index), patch.object(program_discovery, 'IGNORED_PROGRAM_CANDIDATES', Path(folder) / 'ignored.jsonl'):
            rows = program_discovery.discover_official_channel()
            self.assertEqual({row['id'] for row in rows}, {'abcdefghijk', 'lmnopqrstuv'})
            self.assertEqual(rows.errors, [])
        self.assertFalse(program_discovery.is_official_program_candidate('Vol.131「カレンブーケドール」【トレセン学園生徒紹介】'))
        self.assertFalse(program_discovery.is_official_program_candidate('[Alexandros] 生演奏 Acoustic ver. (from ぱかライブTV Vol.52)'))

    def test_changed_source_cannot_reuse_stale_reviewed_translation(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            (data / 'events').mkdir()
            (data / 'auto_update').mkdir()
            (data / 'events/localizations.json').write_text(json.dumps({'records': {'one': {
                'title_ja': '旧番組', 'title_zh': '旧节目',
                'summary_ja': '旧紹介', 'summary_zh': '旧介绍',
            }}}))
            events = [{'id': 'one', 'title': '新しい番組', 'summary': '新しい紹介'}]
            apply_localizations(events, data)
            self.assertEqual(events[0]['title'], '新しい番組')
            self.assertEqual(events[0]['summary'], '新しい紹介')
            self.assertEqual(events[0]['localization_state'], 'pending')
            (data / 'auto_update/event_localizations.json').write_text(json.dumps({'records': {'one': {
                'title_ja': '新しい番組', 'title_zh': '新节目',
                'summary_ja': '新しい紹介', 'summary_zh': '新介绍',
            }}}))
            apply_localizations(events, data)
            self.assertEqual(events[0]['title'], '新节目')
            self.assertEqual(events[0]['summary'], '新介绍')
            self.assertEqual(events[0]['localization_state'], 'complete')

    def test_publish_retains_both_new_records_and_latest_main_correction(self):
        before = {'programs': [{'id': 'one', 'title': 'old', 'cast': []}]}
        collected = {'programs': [{'id': 'one', 'title': 'automatic', 'cast': ['new']}, {'id': 'bot'}]}
        latest = {'programs': [{'id': 'one', 'title': 'reviewed', 'cast': []}, {'id': 'collaborator'}]}
        merged = preserve_collaborator_changes(before, collected, latest)
        rows = {row['id']: row for row in merged['programs']}
        self.assertEqual(set(rows), {'one', 'bot', 'collaborator'})
        self.assertEqual(rows['one']['title'], 'reviewed')
        self.assertEqual(rows['one']['cast'], ['new'])


if __name__ == '__main__':
    unittest.main()
