#!/usr/bin/env python3

import hashlib
import importlib.util
import json
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("update_events", ROOT / "uma_tools" / "update_events.py")
UPDATE_EVENTS = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(UPDATE_EVENTS)


class EventPipelineTest(unittest.TestCase):
    def test_credited_name_aliases_merge_without_resolving_guests_by_role(self):
        identities = UPDATE_EVENTS.IdentityIndex(
            [{'id': 'oguricap', 'zh': '小栗帽', 'ja': 'オグリキャップ', 'en': 'Oguri Cap', 'cv': '高柳知葉', 'cv_zh': '高柳知叶'}],
            [{'zh': '高柳知叶', 'ja': '高柳知葉'}], {},
            {'voice_aliases': {'Tomoyo Takayanagi': '高柳知葉'}},
            {'voice_actors': [{'id': 'va-test', 'names': ['高柳知葉', '高柳知叶']}]},
        )
        cast = UPDATE_EVENTS.make_cast([
            {'name': '高柳知葉', 'role': 'オグリキャップ', 'source_url': 'https://example.test/ja'},
            {'name': 'Tomoyo Takayanagi', 'role': 'Oguri Cap', 'source_url': 'https://example.test/en'},
            {'name': 'External Musician', 'role': '[Band]'},
            {'name': 'Unregistered Guest', 'role': 'Oguri Cap'},
        ], identities, 'official_announcement')
        self.assertEqual(len(cast), 3)
        actor = next(row for row in cast if row['voice_actor_id'])
        self.assertEqual((actor['voice_actor_id'], actor['character_id']), ('va-test', 'oguricap'))
        self.assertEqual({source['url'] for source in actor['evidence_sources']},
                         {'https://example.test/ja', 'https://example.test/en'})
        self.assertEqual({row['name'] for row in cast if not row['voice_actor_id']},
                         {'External Musician', 'Unregistered Guest'})
        self.assertIn('Tomoyo Takayanagi', identities.profile_by_id['va-test']['identity']['aliases'])

    def test_a_song_character_does_not_override_the_explicit_session_cast(self):
        class Identities:
            profiles = [{'id': 'va-a'}, {'id': 'va-b'}]
            character_by_id = {'a': {'cv': '演员甲'}, 'b': {'cv': '演员乙'}}

            @staticmethod
            def voice_id(name):
                return {'演员甲': 'va-a', '演员乙': 'va-b'}.get(name, '')

        cast = {'voice_actor_id': 'va-b', 'character_id': 'b', 'evidence': 'official'}
        event = {'id': 'event', 'date': '2026-10-13', 'title': '活动', 'cast': [cast], 'sessions': [{
            'id': 'day1', 'label': 'DAY1', 'date': '2026-10-13', 'cast': [cast], 'character_ids': ['a', 'b'],
            'performances': [{'song': '歌曲', 'song_id': 'song', 'version_id': 'recording', 'character_ids': ['a']}]}]}
        index = UPDATE_EVENTS.build_appearance_index([event], {'songs': []}, Identities())
        self.assertEqual(index['voice_actors']['va-a']['events'], [])
        self.assertEqual(index['voice_actors']['va-a']['performed_songs'], [])
        self.assertEqual(index['voice_actors']['va-b']['events'][0]['session_id'], 'day1')

    def test_nested_guest_cast_inherits_the_parent_day(self):
        value = '<div class="cast-line"><span class="cast-label">两日出演：</span>共同演员</div><div class="cast-group"><div class="cast-line"><span class="cast-label">仅4日：</span>甲</div><div class="cast-line"><span class="cast-label">嘉宾：</span>乙</div></div><div class="cast-group"><div class="cast-line"><span class="cast-label">仅5日：</span>丙</div><div class="cast-line"><span class="cast-label">向导：</span>細江純子</div></div>'
        first = ''.join(UPDATE_EVENTS.cast_lines_for_session(value, '2022.5.4-5', 0))
        second = ''.join(UPDATE_EVENTS.cast_lines_for_session(value, '2022.5.4-5', 1))
        self.assertIn('共同演员', first)
        self.assertIn('共同演员', second)
        self.assertIn('乙', first)
        self.assertNotIn('乙', second)
        self.assertNotIn('細江純子', first)
        self.assertIn('細江純子', second)
        guide = next(item for item in UPDATE_EVENTS.parse_cast_text(second) if item['name'] == '細江純子')
        self.assertEqual(guide['participation_label'], '向导')

    def test_curated_media_splits_parts_and_discards_incomplete_urls(self):
        self.assertEqual(
            UPDATE_EVENTS.curated_media(
                [
                    ["https://www.bilibili.com/video/BV1first", "D1"],
                    [
                        "上篇：https://www.bilibili.com/video/BV1upper\n"
                        "下篇：https://ww",
                        "D2",
                    ],
                    ["上篇：待补档\n下篇：https://www.bilibili.com/video/BV1lower", "D3"],
                ]
            ),
            [
                {"url": "https://www.bilibili.com/video/BV1first", "label": "D1"},
                {"url": "https://www.bilibili.com/video/BV1upper", "label": "D2 · 上篇"},
                {"url": "https://www.bilibili.com/video/BV1lower", "label": "D3 · 下篇"},
            ],
        )

    def test_voice_actor_ids_come_from_the_canonical_registry(self):
        with mock.patch('events_pipeline.common.read_json', wraps=UPDATE_EVENTS.read_json) as reader:
            built = UPDATE_EVENTS.build()
        read_paths = {call.args[0] for call in reader.call_args_list}
        self.assertIn(UPDATE_EVENTS.VOICE_IDENTITIES_FILE, read_paths)
        self.assertNotIn(UPDATE_EVENTS.OUTPUT_FILES["profiles"], read_paths)
        registry = UPDATE_EVENTS.read_json(UPDATE_EVENTS.VOICE_IDENTITIES_FILE)
        registered_ids = {row["id"] for row in registry["voice_actors"]}
        generated_ids = {row["id"] for row in built["profiles"]["voice_actors"]}
        self.assertTrue(registered_ids.issubset(generated_ids))
        self.assertTrue(all(actor_id.startswith("va-auto-") for actor_id in generated_ids - registered_ids))

    def test_program_summary_discards_channel_boilerplate(self):
        description = (
            "北海道の動物たちに魅了されたサクラチヨノオーが…… "
            "■イベント開催中！ https://umamusume.jp/news/detail.php?id=1264 "
            "チャンネル登録はこちら！ https://www.youtube.com/@UMAMUSUME_official"
        )
        self.assertEqual(
            UPDATE_EVENTS.concise_program_summary(description),
            "北海道の動物たちに魅了されたサクラチヨノオーが…… ■イベント開催中！",
        )

    def test_program_summary_skips_recording_warning_and_keeps_editorial_copy(self):
        description = (
            "※43分23秒に大きなノイズが発生しております。ご視聴の際はご注意ください。\n"
            "ご迷惑をおかけしまして、誠に申し訳ございません。\n\n"
            "公式生配信番組「ぱかライブTV' #8」を放送します！\n\n"
            "今回は未発表の新たなウマ娘役として廣瀬千夏さんが初出走！\n\n"
            "番組内では新たなウマ娘を発表するほか、新育成シナリオの詳細を発表！\n\n"
            "放送日時：2026年10月24日（土）20:00 ～ 予定\n"
            "出走者："
        )
        summary = UPDATE_EVENTS.program_summary(description)
        self.assertNotIn("ノイズ", summary)
        self.assertIn("廣瀬千夏", summary)
        self.assertIn("新育成シナリオの詳細", summary)
        self.assertNotIn("放送日時", summary)

    def test_program_identity_distinguishes_all_regular_series(self):
        self.assertEqual(
            UPDATE_EVENTS.program_identity("そこそこぱかライブTV Vol.55"),
            ("sokosoko-paka-live-tv-055", "sokosoko-paka-live-tv"),
        )
        self.assertEqual(
            UPDATE_EVENTS.program_identity("「ウマ娘」ぱかライブTV' #6 5.5周年スペシャル！"),
            ("paka-live-tv-prime-006", "paka-live-tv-prime"),
        )
        self.assertEqual(
            UPDATE_EVENTS.program_identity("ぱかライブTV Vol.61"),
            ("paka-live-tv-061", "paka-live-tv"),
        )

    def test_regular_episode_coverage_only_advances_contiguously(self):
        rows = [
            {"title": "ぱかライブTV Vol.63", "channel_id": UPDATE_EVENTS.OFFICIAL_CHANNEL_ID},
            {"title": "ぱかライブTV Vol.564", "channel_id": UPDATE_EVENTS.OFFICIAL_CHANNEL_ID},
        ]
        expected = UPDATE_EVENTS.expected_regular_program_ids(rows)
        self.assertIn(("paka-live-tv", 63), expected)
        self.assertNotIn(("paka-live-tv", 64), expected)
        self.assertNotIn(("paka-live-tv", 564), expected)

    def test_program_summary_articles_are_not_treated_as_broadcast_announcements(self):
        self.assertFalse(
            UPDATE_EVENTS.is_official_program_announcement(
                "次回ガチャ更新情報など！「ぱかライブTV Vol.33」発表まとめ！"
            )
        )
        self.assertTrue(
            UPDATE_EVENTS.is_official_program_announcement(
                "「そこそこぱかライブTV Vol.27」10月13日19時公開！"
            )
        )

    def test_program_cast_parser_stops_before_disclaimer(self):
        description = """出走者：
明坂聡美（実況役）【MC】
高柳知葉（オグリキャップ役）

※番組内容は変更になる場合があります。
"""
        self.assertEqual(
            UPDATE_EVENTS.parse_program_cast(description),
            [
                {"name": "明坂聡美", "role": "実況"},
                {"name": "高柳知葉", "role": "オグリキャップ"},
            ],
        )

    def test_program_cast_parser_supports_role_first_commentary_credits(self):
        description = """出演
スペシャルウィーク役　和氣あず未
サイレンススズカ役　　高野麻里佳

【放送情報】
TOKYO MX
"""
        self.assertEqual(
            UPDATE_EVENTS.parse_program_cast(description),
            [
                {"name": "和氣あず未", "role": "スペシャルウィーク"},
                {"name": "高野麻里佳", "role": "サイレンススズカ"},
            ],
        )

    def test_program_sessions_preserve_day_specific_cast(self):
        description = """■配信予定日
DAY1：2024年3月30日（土）19:00頃開始予定
DAY2：2024年3月31日（日）19:00頃開始予定
■DAY1 出走者
明坂聡美（実況役）
天海由梨奈（ミスターシービー役）
■DAY2 出走者
上田瞳（ゴールドシップ役）
※出走者は変更になる場合があります。
"""
        self.assertEqual(
            UPDATE_EVENTS.parse_program_sessions(description),
            [
                {
                    "label": "DAY1",
                    "date": "2024-03-30",
                    "broadcast_time": "19:00", "broadcast_date": "2024-03-30",
                    "broadcast_time_zone": "Asia/Tokyo", "broadcast_time_kind": "announced", "time_precision": "minute",
                    "source_time_text": "DAY1：2024年3月30日（土）19:00頃開始予定",
                    "cast": [
                        {"name": "明坂聡美", "role": "実況"},
                        {"name": "天海由梨奈", "role": "ミスターシービー"},
                    ],
                },
                {
                    "label": "DAY2",
                    "date": "2024-03-31",
                    "broadcast_time": "19:00", "broadcast_date": "2024-03-31",
                    "broadcast_time_zone": "Asia/Tokyo", "broadcast_time_kind": "announced", "time_precision": "minute",
                    "source_time_text": "DAY2：2024年3月31日（日）19:00頃開始予定",
                    "cast": [{"name": "上田瞳", "role": "ゴールドシップ"}],
                },
            ],
        )

    def test_special_announcement_identity_is_stable(self):
        self.assertEqual(
            UPDATE_EVENTS.announcement_identity(
                "ぱかスペース！ 5th EVENT -YELL- 同時視聴を配信！",
                "",
                "2024-02-10",
            ),
            ("official-special-paka-space-5th-event-yell", "official-special"),
        )
        self.assertEqual(
            UPDATE_EVENTS.announcement_identity(
                "3月16日放送のNHK「Venue101」にウマ娘が出走決定！",
                "",
                "2024-03-16",
            ),
            ("official-special-20240316-venue101", "official-special"),
        )
        self.assertEqual(
            UPDATE_EVENTS.announcement_identity(
                "「ぱかライブTV Vol.33」発表まとめ！",
                "そこそこぱかライブTV Vol.27も公開予定",
                "2023-09-28",
            ),
            ("paka-live-tv-033", "paka-live-tv"),
        )

    def test_date_list_inherits_year_within_one_schedule(self):
        self.assertEqual(
            UPDATE_EVENTS.all_dates("2025年7月6日（日）、7月13日（日）深夜に放送"),
            ["2025-07-06", "2025-07-13"],
        )

    def test_pakatube_scope_includes_programs_but_not_promotional_assets(self):
        included = [
            "【ボドゲ実況】4人でカタンをプレイしたぞ！",
            "【お絵かき配信】ラヴズがイラストを描きながら雑談するぞ！",
            "【TVアニメ第3期】第1話の同時視聴やっちゃうぞ！",
            "【ぴすラジッ！】ウマ娘楽曲でトークしちゃうぞ！",
            "【完全密着】ゴルシちゃんの休日覗いてみるか？",
            "【メカダービー】ゴルシちゃん最速への道～その1～",
        ]
        for title in included:
            self.assertTrue(UPDATE_EVENTS.is_pakatube_character_program(title), title)
        for title in ["【ウマ娘】新シリーズ配信アニメ制作決定！", "4th EVENT ティザーPV", "新CM公開"]:
            self.assertFalse(UPDATE_EVENTS.is_pakatube_character_program(title), title)
        for title in [
            "Vol.131「カレンブーケドール」【トレセン学園生徒紹介】",
            "Vol.130「レッドディザイア」【トレセン学園生徒紹介】",
        ]:
            self.assertFalse(UPDATE_EVENTS.is_pakatube_character_program(title), title)

    def test_cross_franchise_live_program_requires_uma_and_broadcast_evidence(self):
        self.assertTrue(UPDATE_EVENTS.is_official_collaboration_program(
            "ウマ娘×プリンセスコネクト Re:Dive コラボ生放送"
        ))
        self.assertFalse(UPDATE_EVENTS.is_official_collaboration_program(
            "プリンセスコネクト Re:Dive 新CM"
        ))

    def test_numbered_program_title_keeps_real_special_subtitle(self):
        self.assertEqual(
            UPDATE_EVENTS.canonical_program_title("「ウマ娘」ぱかライブTV' #6 5.5周年スペシャル！"),
            "ぱかライブTV' #6 5.5周年スペシャル",
        )
        self.assertEqual(
            UPDATE_EVENTS.canonical_program_title("ぱかライブTV Vol.63 発表まとめ！"),
            "ぱかライブTV Vol.63",
        )

    def test_official_special_scope_includes_cast_commentary(self):
        self.assertTrue(
            UPDATE_EVENTS.is_official_special_video(
                "アニメ「うまよん」特別企画 オーディオコメンタリーリレー第１回"
            )
        )
        self.assertFalse(UPDATE_EVENTS.is_official_special_video("【ラジオ切り抜き】レースの模様をお届け！"))
        self.assertTrue(UPDATE_EVENTS.is_official_program_candidate("【ウマ娘の日常】「ウマ娘消失事件」編"))
        self.assertTrue(UPDATE_EVENTS.is_official_program_candidate("【TVアニメ第3期】第1話の同時視聴やっちゃうぞ！"))
        self.assertFalse(UPDATE_EVENTS.is_official_program_candidate("【ラジオ切り抜き】レースの模様をお届け！"))

    def test_program_refresh_is_additive_and_preserves_reviewed_values(self):
        existing = {
            "schema_version": 2,
            "programs": [{
                "id": "program-1",
                "series_id": "official-special",
                "title": "人工确认标题",
                "manual_fields": ["title", "cast"],
                "date": "",
                "cast": [{"name": "确认声优"}],
                "source_kind": "community_archive",
                "source_url": "https://example.com/archive",
                "sources": [{"kind": "official_announcement", "url": "https://example.com/old"}],
            }],
        }
        discovered = {
            "schema_version": 2,
            "coverage": {"records": 2},
            "programs": [
                {
                    "id": "program-1",
                    "series_id": "official-special",
                    "title": "自动发现的不同标题",
                    "date": "2026-09-20",
                    "cast": [{"name": "自动发现的不同出演者"}],
                    "source_kind": "official_announcement",
                    "source_url": "https://example.com/announcement",
                    "sources": [{"kind": "official_youtube", "url": "https://example.com/new"}],
                },
                {"id": "program-2", "series_id": "official-special", "title": "新节目", "date": "2026-09-21"},
            ],
        }
        merged, report = UPDATE_EVENTS.apply_additive_program_refresh(existing, discovered)
        first = next(row for row in merged["programs"] if row["id"] == "program-1")
        self.assertEqual(first["title"], "人工确认标题")
        self.assertEqual(first["cast"], [{"name": "确认声优"}])
        self.assertEqual(first["date"], "2026-09-20")
        self.assertEqual(first["source_kind"], "official_announcement")
        self.assertEqual(first["source_url"], "https://example.com/announcement")
        self.assertEqual(len(first["sources"]), 2)
        self.assertEqual(report["added_ids"], ["program-2"])
        self.assertEqual(
            report["filled"],
            [{"id": "program-1", "fields": ["date", "source_kind", "source_url", "sources"]}],
        )
        self.assertEqual(
            {(row["id"], row["field"]) for row in report["conflicts"]},
            {("program-1", "cast"), ("program-1", "title")},
        )

    def test_program_refresh_replaces_stale_official_announcement_title(self):
        existing = {"programs": [{
            "id": "paka-live-tv-prime-008",
            "title": "「ぱかライブTV' #8」は10月24日20時に放送！新情報！",
            "source_kind": "official_announcement",
            "source_url": "https://umamusume.jp/news/detail?id=1",
        }]}
        discovered = {"programs": [{
            "id": "paka-live-tv-prime-008",
            "title": "ぱかライブTV' #8",
            "source_title": "「ぱかライブTV' #8」は10月24日20時に放送！新情報！",
            "source_kind": "official_youtube",
            "video_id": "abcdefghijk",
            "source_url": "https://www.youtube.com/watch?v=abcdefghijk",
        }]}
        merged, _ = UPDATE_EVENTS.apply_additive_program_refresh(existing, discovered)
        row = merged["programs"][0]
        self.assertEqual(row["title"], "ぱかライブTV' #8")
        self.assertEqual(row["source_title"], discovered["programs"][0]["source_title"])

    def test_program_refresh_keeps_reviewed_title_against_official_discovery(self):
        existing = {"programs": [{
            "id": "paka-live-tv-prime-008", "title": "人工确认标题",
            "metadata_status": "reviewed", "source_kind": "official_announcement",
        }]}
        discovered = {"programs": [{
            "id": "paka-live-tv-prime-008", "title": "ぱかライブTV' #8",
            "source_kind": "official_youtube",
        }]}
        merged, _ = UPDATE_EVENTS.apply_additive_program_refresh(existing, discovered)
        self.assertEqual(merged["programs"][0]["title"], "人工确认标题")

    def test_program_refresh_joins_different_ids_when_official_video_is_identical(self):
        existing = {"programs": [{
            "id": "official-special-old", "title": "旧标题", "video_id": "abcdefghijk",
            "source_kind": "community_archive", "source_url": "https://archive.example/old",
        }]}
        discovered = {"programs": [{
            "id": "official-special-new", "title": "新标题", "video_id": "abcdefghijk",
            "source_kind": "official_youtube", "source_url": "https://youtube.com/watch?v=abcdefghijk",
            "sources": [{"kind": "official_youtube", "url": "https://youtube.com/watch?v=abcdefghijk"}],
        }]}
        merged, _ = UPDATE_EVENTS.apply_additive_program_refresh(existing, discovered)
        self.assertEqual([row["id"] for row in merged["programs"]], ["official-special-old"])
        self.assertIn("official-special-new", merged["programs"][0]["id_aliases"])
        self.assertIn("https://youtube.com/watch?v=abcdefghijk", [row.get("url") for row in merged["programs"][0].get("sources", [])])

    def test_setlist_relationships_are_parsed_per_song_row(self):
        class Identities:
            @staticmethod
            def character_id(name):
                return {"特别周": "specialweek", "无声铃鹿": "silencesuzuka"}.get(name, "")

        table = """<table><tbody>
        <tr><td class="setlist-song">Song A</td><td><span class="perf-name">特别周</span></td></tr>
        <tr><td class="setlist-song">Song B</td><td><span class="perf-name">无声铃鹿</span></td></tr>
        </tbody></table>"""
        self.assertEqual(
            UPDATE_EVENTS.table_performances(table, Identities()),
            [
                {"song": "Song A", "character_ids": ["specialweek"]},
                {"song": "Song B", "character_ids": ["silencesuzuka"]},
            ],
        )

    def test_non_uma_singers_are_kept_on_their_song_row(self):
        class Identities:
            @staticmethod
            def character_id(name):
                return {"特别周": "specialweek"}.get(name, "")

        table = """<table><tbody><tr>
        <td class="setlist-song">Song C</td>
        <td class="setlist-perf"><span class="perf-name">特别周</span>
        <span class="guest-performer">外部歌手</span></td>
        </tr></tbody></table>"""
        self.assertEqual(
            UPDATE_EVENTS.table_performances(table, Identities()),
            [{
                "song": "Song C",
                "character_ids": ["specialweek"],
                "guest_performers": ["外部歌手"],
            }],
        )

    def test_animax_guests_stay_in_songs_not_uma_cast(self):
        catalog = UPDATE_EVENTS.read_json(ROOT / "data" / "events_catalog.json")
        event = next(row for row in catalog["events"] if row["id"] == "live-other-2023-11-18-animax-musix-2023")
        expected = {"tokaiteio", "vodka", "mrcb", "matikanetannhauser", "kitasanblack", "symbolikriss", "katsuragiace"}
        self.assertEqual({item['character_id'] for item in event['cast'] if item.get('character_id')}, expected)
        self.assertTrue(all(item.get('voice_actor_id') for item in event['cast']))
        table = event["sessions"][0]["setlist_html"]
        for guest in ("伊藤美来", "上坂すみれ", "東山奈央", "羊宮妃那"):
            self.assertIn(f'class="guest-performer">{guest}</span>', table)
        self.assertEqual(set(event["sessions"][0]["performances"][-1]["character_ids"]), expected)
        self.assertIn('伊藤美来', event['sessions'][0]['performances'][-1]['guest_performers'])

    def test_setlist_song_versions_are_preserved(self):
        self.assertEqual(
            UPDATE_EVENTS.clean_song("winning the soul（GO BEYOND Mix Ver.）"),
            "winning the soul（GO BEYOND Mix Ver.）",
        )
        self.assertEqual(
            UPDATE_EVENTS.clean_song("うまぴょい伝説 ※Short ver."),
            "うまぴょい伝説 ※Short ver.",
        )

    def test_new_ensemble_splits_recordings_and_same_ensemble_reissue_stays_shared(self):
        from types import SimpleNamespace
        identities = SimpleNamespace(voice_id=lambda name: '', character_id=lambda name: '',
                                     current_character_id=lambda *args: '', character_payload=lambda key: {},
                                     profile_by_id={}, character_by_id={})
        albums = [{'id':identifier, 'name':identifier, 'release':'2024-01-01',
                   'songs':[{'name':'Ensemble fixture song','artist':artist}]}
                  for identifier,artist in [('first','Singer A'),('second','Singer B'),('reissue','Singer B')]]
        catalog = UPDATE_EVENTS.build_song_catalog(albums, [], identities, '2026-10-25')
        versions = catalog['songs'][0]['versions']
        self.assertEqual(len(versions), 2)
        self.assertEqual(sorted(version['release_count'] for version in versions), [1,2])

    def test_song_catalog_groups_explicit_versions_without_losing_releases(self):
        class Identities:
            @staticmethod
            def character_id(name):
                return {"スペシャルウィーク": "specialweek"}.get(name, "")

            @staticmethod
            def voice_id(_name):
                return ""

            @staticmethod
            def current_character_id(_actor_id, _role=""):
                return ""

            profile_by_id = {}
            character_by_id = {}

            @staticmethod
            def character_payload(_character_id):
                return {}

        albums = [{
            "name": "Album A", "catalog": "ABC-1", "release": "2024-01-01", "type": "专辑", "cover": "cover.jpg",
            "songs": [
                {"name": "Song A", "artist": "Singer", "url": "a"},
                {"name": "Song A (Game Size)", "artist": "Singer", "url": "b"},
                {"name": "Song A (Game Size)（スペシャルウィーク）", "artist": "Singer", "url": "c"},
                {"name": "Song A -Band Ver-", "artist": "Singer", "url": "d"},
                {"name": "Song A (Artist (Band) Remix)", "artist": "Singer", "url": "e"},
                {"name": "Song A (TV Size) [13話EDテーマ]", "artist": "Singer", "url": "f"},
            ],
        }]
        events = [{
            "id": "event-a", "title": "Event A", "date": "2024-02-01", "kind": "concert", "series_id": "test",
            "sessions": [{"id": "event-a-session-1", "label": "DAY1", "date": "2024-02-01", "performances": [{"song": "Song A ※Short ver.", "character_ids": ["specialweek"]}]}],
        }]
        catalog = UPDATE_EVENTS.build_song_catalog(albums, events, Identities(), "2024-02-02T00:00:00+00:00")
        self.assertEqual(catalog["coverage"], {
            "songs": 1, "versions": 6, "albums": 1, "release_tracks": 6, "live_performances": 1,
            "credited_songs": 0, "lyric_songs": 0, "credited_versions": 0, "lyric_versions": 0,
        })
        self.assertEqual(catalog["songs"][0]["title"], "Song A")
        self.assertEqual(len(catalog["songs"][0]["versions"]), 6)
        character_version = next(version for version in catalog["songs"][0]["versions"] if "スペシャルウィーク" in version["title"])
        self.assertEqual(character_version["version_label"], "Game Size / 角色独唱：スペシャルウィーク")
        self.assertEqual(events[0]["sessions"][0]["performances"][0]["song_id"], catalog["songs"][0]["id"])
        self.assertEqual(events[0]["sessions"][0]["performances"][0]["performance_variant"]["label"], "Short Ver.")

    def test_corrected_album_title_preserves_edition_identity_and_original_spelling(self):
        identities = UPDATE_EVENTS.IdentityIndex([], [], {}, {}, {})
        albums = [
            {'name': 'First album', 'catalog': 'ORIG-1', 'release': '2022-01-01',
             'songs': [{'name': 'Correct title', 'artist': 'Singer', 'url': 'first.mp3'}]},
            {'name': 'Second album', 'catalog': 'LATER-1', 'release': '2023-01-01',
             'songs': [{'name': 'Correct title', 'source_name': 'Misspelled title', 'artist': 'Singer',
                        'url': 'second.mp3', 'version_label': 'Second album edition', 'version_id': 'published-edition'}]},
        ]
        original = UPDATE_EVENTS.build_song_catalog(albums[:1], [], identities, 'now')['songs'][0]
        overrides = {'song_versions': {'Correct title': {'legacy_song_ids': ['published-misspelling']}}}
        song = UPDATE_EVENTS.build_song_catalog(albums, [], identities, 'now', overrides)['songs'][0]
        self.assertEqual(song['id'], original['id'])
        self.assertIn('Misspelled title', song['aliases'])
        self.assertIn('published-misspelling', song['legacy_ids'])
        self.assertEqual({v['id'] for v in song['versions']}, {original['versions'][0]['id'], 'published-edition'})
        corrected = next(v for v in song['versions'] if v['id'] == 'published-edition')
        self.assertEqual(corrected['title'], 'Correct title')
        self.assertEqual(corrected['releases'][0]['audio_url'], 'second.mp3')
        self.assertEqual(song['release_count'], 2)

    def test_same_recording_under_two_release_titles_keeps_published_ids(self):
        identities = UPDATE_EVENTS.IdentityIndex([], [], {}, {}, {})
        albums = [
            {'name': 'Original album', 'catalog': 'ORIG-1', 'release': '2022-01-01',
             'songs': [{'name': 'Original title', 'artist': 'Singer', 'url': 'original.mp3'}]},
            {'name': 'Later album', 'catalog': 'LATER-1', 'release': '2023-01-01',
             'songs': [{'name': 'Later title', 'artist': 'Singer', 'url': 'later.mp3'}]},
        ]
        original = UPDATE_EVENTS.build_song_catalog(albums[:1], [], identities, 'now')['songs'][0]
        original_version_id = original['versions'][0]['id']
        sources = {
            'overrides': {
                'song_versions': {'Later title': {
                    'base': 'Original title', 'label': '同音源异名',
                    'version_id': 'published-later-version', 'legacy_song_ids': ['published-later-song'],
                }},
                'versions': {'published-later-version': {
                    'same_recording_as': original_version_id, 'recording_source_url': 'https://example.test/correction',
                }},
            },
            'lyrics': {'versions': {original_version_id: {'lines': ['Original lyric']}}},
        }
        songs = UPDATE_EVENTS.build_song_catalog(albums, [], identities, 'now', music_sources=sources)['songs']
        self.assertEqual(len(songs), 1)
        song = songs[0]
        self.assertEqual(song['id'], original['id'])
        self.assertIn('published-later-song', song['legacy_ids'])
        versions = {row['id']: row for row in song['versions']}
        self.assertEqual(set(versions), {original_version_id, 'published-later-version'})
        later = versions['published-later-version']
        self.assertEqual(later['title'], 'Later title')
        self.assertEqual(later['same_recording_as'], original_version_id)
        self.assertEqual(later['recording_source_url'], 'https://example.test/correction')
        self.assertFalse(later['has_lyrics'])
        self.assertEqual(song['release_count'], 2)

    def test_song_version_override_folds_alias_into_base_work(self):
        class Identities:
            @staticmethod
            def character_id(_name):
                return ""

            @staticmethod
            def voice_id(_name):
                return ""

            @staticmethod
            def current_character_id(_actor_id, _role=""):
                return ""

            profile_by_id = {}
            character_by_id = {}

            @staticmethod
            def character_payload(_character_id):
                return {}

        albums = [{
            "name": "Album A", "catalog": "ABC-1", "release": "2024-01-01", "type": "专辑", "cover": "cover.jpg",
            "songs": [{"name": "Song A", "artist": "Singer", "url": "a"}],
        }]
        events = [{
            "id": "event-a", "title": "Event A", "date": "2024-02-01", "kind": "concert", "series_id": "test",
            "sessions": [{"id": "event-a-session-1", "label": "DAY1", "date": "2024-02-01", "performances": [{"song": "Song B", "character_ids": []}]}],
        }]
        overrides = {"song_versions": {"Song B": "Song A"}}
        catalog = UPDATE_EVENTS.build_song_catalog(albums, events, Identities(), "2024-02-02T00:00:00+00:00", overrides)
        self.assertEqual(catalog["coverage"]["songs"], 1)
        self.assertEqual(catalog["songs"][0]["title"], "Song A")
        self.assertEqual(len(catalog["songs"][0]["versions"]), 1)
        version = catalog["songs"][0]["versions"][0]
        self.assertEqual(version["title"], "Song A")
        self.assertEqual(version["performance_count"], 1)
        self.assertEqual(version["performances"][0]["performance_variant"]["title"], "Song B")
        self.assertEqual(events[0]["sessions"][0]["performances"][0]["song_id"], catalog["songs"][0]["id"])

    def test_song_version_override_preserves_explicit_recording_and_legacy_song_id(self):
        class Identities:
            character_by_id = {}
            profile_by_id = {}
            character_id = staticmethod(lambda _name: "")
            voice_id = staticmethod(lambda _name: "")
            current_character_id = staticmethod(lambda _actor_id: "")
            character_payload = staticmethod(lambda _character_id: {})

        albums = [{
            "name": "Album A", "catalog": "ABC-1", "release": "2024-01-01", "type": "专辑", "cover": "cover.jpg",
            "songs": [
                {"name": "Song A", "artist": "Singer", "url": "a"},
                {"name": "Song A - Special -", "artist": "Singer", "url": "b"},
            ],
        }]
        old_song_id = UPDATE_EVENTS.stable_song_id("Song A - Special -")
        old_version_id = UPDATE_EVENTS.stable_version_id(old_song_id, "Song A - Special -")
        overrides = {"song_versions": {"Song A - Special -": {
            "base": "Song A", "label": "Special", "version_id": old_version_id,
            "legacy_song_ids": [old_song_id],
        }}}

        catalog = UPDATE_EVENTS.build_song_catalog(albums, [], Identities(), "2024-02-02T00:00:00+00:00", overrides)

        self.assertEqual(catalog["coverage"]["songs"], 1)
        self.assertIn(old_song_id, catalog["songs"][0]["legacy_ids"])
        self.assertIn(old_version_id, [version["id"] for version in catalog["songs"][0]["versions"]])

    def test_release_credits_resolve_to_one_actor_and_character(self):
        built = UPDATE_EVENTS.build()
        special_week = next(
            profile for profile in built["profiles"]["voice_actors"]
            if profile["identity"]["zh"] == "和气杏未"
        )
        relations = built["appearances"]["voice_actors"][special_week["id"]]["songs"]
        self.assertTrue(relations)
        self.assertTrue(all(relation["releases"] > 0 for relation in relations))
        credited = [
            vocalist
            for song in built["songs"]["songs"]
            for version in song["versions"]
            for release in version["releases"]
            for vocalist in release["vocalists"]
            if vocalist["voice_actor_id"] == special_week["id"]
        ]
        self.assertTrue(credited)
        self.assertEqual({row["character_id"] for row in credited}, {"specialweek"})

    def test_full_cast_setlist_rows_expand_to_the_correct_day_cast(self):
        class Identities:
            @staticmethod
            def character_id(name):
                return {
                    "特别周": "specialweek",
                    "东海帝王": "tokaiteio",
                    "无声铃鹿": "silencesuzuka",
                    "骏川手纲": "hayakawatazuna",
                }.get(name, "")

        cast = """<div class="cast-line"><span class="cast-label">两日出演：</span>和氣あず未（特别周）</div>
        <div class="cast-line"><span class="cast-label">仅5日：</span>Machico（东海帝王）</div>
        <div class="cast-line"><span class="cast-label">仅6日：</span>高野麻里佳（无声铃鹿）</div>
        <div class="cast-line"><span class="cast-label">向导：</span>藤井ゆきよ（骏川手纲）</div>"""
        table = """<table><tbody><tr><td class="setlist-song">Song A</td>
        <td class="setlist-perf">全员（2人）</td></tr></tbody></table>"""
        day_one = UPDATE_EVENTS.cast_characters_for_session(cast, Identities(), "2022.3.5-6", 0)
        day_two = UPDATE_EVENTS.cast_characters_for_session(cast, Identities(), "2022.3.5-6", 1)
        self.assertEqual(day_one, ["specialweek", "tokaiteio"])
        self.assertEqual(day_two, ["specialweek", "silencesuzuka"])
        self.assertEqual(
            UPDATE_EVENTS.table_performances(table, Identities(), day_two),
            [{"song": "Song A", "character_ids": ["specialweek", "silencesuzuka"]}],
        )

    def test_unlisted_full_cast_rows_use_only_the_declared_regular_cast(self):
        from events_pipeline.setlists import display_table
        from bs4 import BeautifulSoup
        identities = UPDATE_EVENTS.IdentityIndex(
            [{'id': 'specialweek', 'zh': '特别周', 'cv': '和氣あず未', 'av': '/uma_avatars/SpecialWeek.png'},
             {'id': 'tokaiteio', 'zh': '东海帝王', 'cv': 'Machico', 'av': '/uma_avatars/TokaiTeio.png'}],
            [{'ja': '和氣あず未', 'zh': '和气杏未'}, {'ja': 'Machico', 'zh': 'Machico'}], {}, {}, {},
        )
        cast = [{'name': '和氣あず未', 'voice_actor_id': identities.voice_id('和氣あず未'), 'character_id': 'specialweek'},
                {'name': 'Machico', 'voice_actor_id': identities.voice_id('Machico'), 'character_id': 'tokaiteio', 'participation_label': '嘉宾'}]
        table = '<table><tr><td class="setlist-song">Opening</td><td class="setlist-perf">全员（1人）</td></tr></table>'
        result = BeautifulSoup(display_table(table, {'songs': []}, cast, identities), 'html.parser')
        self.assertEqual([node['alt'] for node in result.select('img')], ['特别周'])
        self.assertNotIn('performer-chip-list', display_table(table.replace('1人', '2人'), {'songs': []}, cast, identities))
        guest_table = table.replace('全员（1人）', '全员（1人）嘉宾：<span class="perf-item"><img alt="东海帝王"><span class="perf-name">东海帝王</span></span>')
        guest_result = BeautifulSoup(display_table(guest_table, {'songs': [{'name': 'Opening', 'performers': ['和氣あず未', 'Machico']}]}, cast, identities), 'html.parser')
        self.assertEqual([node['alt'] for node in guest_result.select('img')], ['东海帝王', '特别周'])
        self.assertIn('嘉宾：', guest_result.get_text())

    def test_numbered_event_appearances_use_the_matching_session_date(self):
        built = UPDATE_EVENTS.build()
        event_id = "live-numbered-6th-event-2025-10-18"
        event = next(row for row in built["catalog"]["events"] if row["id"] == event_id)
        day_one, day_two = event["sessions"]
        self.assertNotIn("bikopegasus", day_one["character_ids"])
        self.assertIn("bikopegasus", day_two["character_ids"])
        self.assertIn('alt="黄金旅程"', day_two['setlist_html'])
        self.assertNotIn('guest-performer">田中あいみ</span>', day_two['setlist_html'])

        character_events = [
            row for row in built["appearances"]["characters"]["bikopegasus"]["events"]
            if row["event_id"] == event_id
        ]
        actor_events = [
            row for row in built["appearances"]["voice_actors"]["va-0117"]["events"]
            if row["event_id"] == event_id
        ]
        for rows in (character_events, actor_events):
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["date"], "2025-10-19")
            self.assertEqual(rows[0]["session_id"], day_two["id"])
            self.assertEqual(rows[0]["session_label"], "DAY2")

    def test_unlabelled_performers_survive_an_auxiliary_labeled_cast_line(self):
        class Identities:
            @staticmethod
            def character_id(name):
                return {"特别周": "specialweek", "骏川手纲": "hayakawatazuna"}.get(name, "")

        cast = """<div class="cast-line">和氣あず未（特别周）</div>
        <div class="cast-line"><span class="cast-label">向导：</span>藤井ゆきよ（骏川手纲）</div>"""
        self.assertEqual(
            UPDATE_EVENTS.cast_characters_for_session(cast, Identities(), "2024.1.1", 0),
            ["specialweek"],
        )

    def test_short_character_aliases_require_name_boundaries(self):
        identities = UPDATE_EVENTS.IdentityIndex.__new__(UPDATE_EVENTS.IdentityIndex)
        identities.character_by_alias = {"エル": "elcondorpasa", "スペ": "specialweek"}
        self.assertEqual(
            set(identities.characters_in_text("エルとスペでゲーム実況")),
            {"elcondorpasa", "specialweek"},
        )
        self.assertEqual(identities.characters_in_text("スーパーエルフのゲーム実況"), [])

    def test_unicode_event_title_gets_order_independent_suffix(self):
        suffix = UPDATE_EVENTS.stable_title_suffix("シブヤノオト")
        self.assertRegex(suffix, r"^title-[0-9a-f]{12}$")
        self.assertEqual(suffix, UPDATE_EVENTS.stable_title_suffix("シブヤノオト"))

    def test_build_preserves_curated_live_sources(self):
        paths = [ROOT / "data" / "live_data.json", ROOT / "data" / "live_cat_data.json"]
        before = [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]
        built = UPDATE_EVENTS.build()
        after = [hashlib.sha256(path.read_bytes()).hexdigest() for path in paths]
        self.assertEqual(before, after)
        self.assertTrue(built["catalog"]["events"])
        self.assertTrue(built["appearances"]["voice_actors"])

    def test_every_curated_setlist_day_has_an_exact_source_locator(self):
        built = UPDATE_EVENTS.build()
        actual_locators = [
            json.dumps(session["setlist_source"], sort_keys=True)
            for event in built["catalog"]["events"]
            for session in event.get("sessions") or []
            if session.get("setlist_source")
        ]
        self.assertEqual(len(actual_locators), len(set(actual_locators)))
        actual = {
            json.dumps(session["setlist_source"], sort_keys=True): session
            for event in built["catalog"]["events"]
            for session in event.get("sessions") or []
            if session.get("setlist_source")
        }
        expected = {}
        live = json.loads((ROOT / "data" / "live_data.json").read_text(encoding="utf-8"))
        for group_index, group in enumerate(live):
            for performance_index, performance in enumerate(group.get("subs") or []):
                for day_index, day in enumerate(performance.get("days") or []):
                    if not (day.get("table") or ""):
                        continue
                    locator = {"file": "data/live_data.json", "group": group_index, "performance": performance_index, "day": day_index}
                    expected[json.dumps(locator, sort_keys=True)] = day.get("table") or ""
        categories = json.loads((ROOT / "data" / "live_cat_data.json").read_text(encoding="utf-8"))
        for category, root in categories.items():
            sections = root.get("sections") or [{"groups": root.get("groups") or []}]
            has_sections = bool(root.get("sections"))
            for section_index, section in enumerate(sections):
                for group_index, group in enumerate(section.get("groups") or []):
                    for performance_index, performance in enumerate(group.get("subs") or []):
                        for day_index, day in enumerate(performance.get("days") or []):
                            if not (day.get("table") or ""):
                                continue
                            locator = {
                                "file": "data/live_cat_data.json",
                                "category": category,
                                "section": section_index if has_sections else None,
                                "group": group_index,
                                "performance": performance_index,
                                "day": day_index,
                            }
                            expected[json.dumps(locator, sort_keys=True)] = day.get("table") or ""
        retained = {json.dumps(source, sort_keys=True) for event in built['catalog']['events']
                    for session in event.get('sessions', [])
                    for source in [session.get('setlist_source'), *session.get('alternate_setlist_sources', [])] if source}
        self.assertTrue(set(expected) <= retained, 'legacy source locators remain available after Google replacement and event merging')

        class NoCharacters:
            @staticmethod
            def character_id(_name):
                return ""

        for locator, session in actual.items():
            if locator not in expected:
                self.assertEqual(session['setlist_source']['file'], 'data/events/赛马娘LIVE歌单导出.csv')
                continue
            table = expected[locator]
            parsed_songs = [row["song"] for row in UPDATE_EVENTS.table_performances(table, NoCharacters())]
            self.assertEqual(actual[locator]["songs"], parsed_songs, locator)
            self.assertEqual(actual[locator]["setlist_html"], table, locator)

    def test_only_curated_sessions_may_contain_songs(self):
        built = UPDATE_EVENTS.build()
        for event in built["catalog"]["events"]:
            for session in event.get("sessions") or []:
                expected_status = "verified" if session.get("setlist_source") else "none"
                self.assertEqual(session["setlist_status"], expected_status)
                if session.get("songs") or session.get("performances"):
                    self.assertIn(session.get("setlist_source", {}).get("file"), {
                        "data/live_data.json", "data/live_cat_data.json", "data/events/赛马娘LIVE歌单导出.csv",
                    })
                if session.get("setlist_source"):
                    self.assertTrue(session.get("setlist_html"), session.get("id"))
                else:
                    self.assertNotIn("setlist_html", session)

    def test_curated_source_label_matches_setlist_status(self):
        built = UPDATE_EVENTS.build()
        for event in built["catalog"]["events"]:
            for source in event.get("sources") or []:
                if source.get("kind") != "curated_live":
                    continue
                expected = "站内精调歌单" if event["setlist_status"] == "verified" else "站内精调资料"
                self.assertEqual(source.get("label"), expected, event["id"])

    def test_every_event_has_a_stable_visible_cover(self):
        built = UPDATE_EVENTS.build()
        for event in built["catalog"]["events"]:
            self.assertTrue(event["image"], event["id"])
            self.assertNotIn("image_fallback", event, event["id"])
            self.assertTrue(event["image"].startswith(("/", "https://")), event["id"])
        numbered = [event for event in built["catalog"]["events"] if event.get("series_id") == "numbered-live"]
        self.assertEqual({event["image"] for event in numbered}, {
            "/uma_tools/img/event-covers/numbered/1st.png",
            "/uma_tools/img/event-covers/numbered/2nd.png",
            "/uma_tools/img/event-covers/numbered/3rd.png",
            "/uma_tools/img/event-covers/numbered/4th.png",
            "/uma_tools/img/event-covers/numbered/4th-extra.png",
            "/uma_tools/img/event-covers/numbered/5th.png",
            "/uma_tools/img/event-covers/numbered/6th.png",
            "/uma_tools/img/event-covers/numbered/7th.png",
        })

    def test_catalog_documents_share_one_build_id(self):
        built = UPDATE_EVENTS.build()
        ids = {built[key]["build_id"] for key in ("catalog", "songs", "appearances", "profiles", "manifest")}
        self.assertEqual(len(ids), 1)

    def test_belno_aliases_resolve_to_one_canonical_character(self):
        built = UPDATE_EVENTS.build()
        events = built["catalog"]["events"]
        matching = [
            cast for event in events for cast in event.get("cast") or []
            if cast.get("voice_actor_id") == "va-0115"
        ]
        self.assertTrue(matching)
        self.assertEqual({row["character_id"] for row in matching}, {"zankan_koukou"})
        self.assertEqual({row["role"] for row in matching}, {"崭新光辉"})

    def test_character_programs_do_not_infer_voice_actor_attendance(self):
        built = UPDATE_EVENTS.build()
        programs = [
            event for event in built["catalog"]["events"]
            if event.get("series_id") == "pakatube-character-program" and event.get("character_ids")
        ]
        self.assertTrue(programs)
        voice_appearances = {
            actor_id: {event["event_id"] for event in actor["events"]}
            for actor_id, actor in built["appearances"]["voice_actors"].items()
        }
        for event in programs:
            cast_by_character = {
                row["character_id"]: row["voice_actor_id"]
                for row in event.get("cast") or []
                if row.get("character_id") and row.get("voice_actor_id")
            }
            self.assertFalse(cast_by_character, event['id'])
            self.assertEqual(event["cast_status"], "character_only")
            self.assertFalse(any(event['id'] in ids for ids in voice_appearances.values()), event['id'])

    def test_explicit_alias_merge_preserves_curated_setlist_and_all_evidence(self):
        rows = [
            {
                "id": "same-event", "title": "Curated", "date": "2024-01-01", "kind": "concert",
                "sources": [{"kind": "curated_live", "url": "/curated"}], "cast": [], "character_ids": [],
                "sessions": [{"id": "curated-session", "label": "DAY1", "date": "2024-01-01", "songs": ["Song A"], "character_ids": [], "cast": [], "performances": [], "setlist_source": {"file": "data/live_data.json", "day": 0}}],
            },
            {
                "id": "same-event", "title": "Official", "date": "2024-01-01", "kind": "official_program",
                "sources": [{"kind": "official_announcement", "url": "https://example.test/official"}], "cast": [], "character_ids": [],
                "sessions": [{"id": "program-session", "label": "DAY1", "date": "2024-01-01", "songs": [], "character_ids": [], "cast": [], "performances": []}],
            },
        ]
        merged = UPDATE_EVENTS.dedupe_events(rows)[0]
        self.assertEqual(merged["sessions"][0]["songs"], ["Song A"])
        self.assertEqual(merged["sessions"][0]["setlist_source"]["file"], "data/live_data.json")
        self.assertEqual({source["kind"] for source in merged["sources"]}, {"curated_live", "official_announcement"})

    def test_duplicate_cast_relationship_merges_sources_across_role_languages(self):
        merged = UPDATE_EVENTS.merge_cast_records([
            {
                "voice_actor_id": "va-0040", "name": "和氣あず未", "character_id": "specialweek",
                "role": "特别周", "evidence": "curated_live_cast", "source_url": "",
                "person_type": "voice_actor", "resolution": "resolved",
            },
            {
                "voice_actor_id": "va-0040", "name": "和氣あず未", "character_id": "specialweek",
                "role": "スペシャルウィーク", "evidence": "official_announcement",
                "source_url": "https://example.test/official", "person_type": "voice_actor", "resolution": "resolved",
            },
        ])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["role"], "特别周")
        self.assertEqual(
            {source["kind"] for source in merged[0]["evidence_sources"]},
            {"curated_live_cast", "official_announcement"},
        )

    def test_person_only_cast_evidence_folds_into_one_known_role(self):
        merged = UPDATE_EVENTS.merge_cast_records([
            {
                "voice_actor_id": "va-0040", "name": "和氣あず未", "character_id": "specialweek",
                "role": "特别周", "evidence": "curated_live_cast", "source_url": "",
                "person_type": "voice_actor", "resolution": "resolved",
            },
            {
                "voice_actor_id": "va-0040", "name": "和氣あず未", "character_id": "", "role": "",
                "evidence": "eventernote", "source_url": "https://example.test/event",
                "person_type": "voice_actor", "resolution": "resolved",
            },
        ])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["character_id"], "specialweek")
        self.assertEqual(
            {source["kind"] for source in merged[0]["evidence_sources"]},
            {"curated_live_cast", "eventernote"},
        )

    def test_known_actor_always_uses_its_single_canonical_character(self):
        class Identities:
            profile_by_id = {"va-1": {"identity": {"zh": "声优甲"}}}
            character_by_id = {
                "character-a": {"zh": "角色甲"},
                "character-b": {"zh": "角色乙"},
            }

            @staticmethod
            def voice_id(_name):
                return "va-1"

            @staticmethod
            def character_id(_name):
                return "character-b"

            @staticmethod
            def current_character_id(_actor_id, _role=""):
                return "character-a"

            @staticmethod
            def non_voice_person_type(_name):
                return ""

        cast = UPDATE_EVENTS.make_cast(
            [{"name": "声优甲", "role": "来源误写的角色乙"}],
            Identities(),
            "eventernote",
        )
        self.assertEqual(len(cast), 1)
        self.assertEqual(cast[0]["character_id"], "character-a")
        self.assertEqual(cast[0]["role"], "角色甲")

    def test_non_uma_people_never_enter_public_event_cast(self):
        class Identities:
            profile_by_id = {}
            character_by_id = {}

            @staticmethod
            def voice_id(_name):
                return ""

            @staticmethod
            def current_character_id(_actor_id):
                return ""

        self.assertEqual(
            UPDATE_EVENTS.make_cast(
                [{"name": "外部歌手", "role": "嘉宾", "person_type": "guest_artist"}],
                Identities(),
                "curated_live_cast",
            ),
            [],
        )

    def test_known_franchise_actor_without_catalogued_role_keeps_event_participation(self):
        class Identities:
            profile_by_id = {"va-1": {"identity": {"zh": "声优甲"}, "roles": []}}
            character_by_id = {}

            @staticmethod
            def voice_id(_name):
                return "va-1"

            @staticmethod
            def current_character_id(_actor_id, _role=""):
                return ""

        cast = UPDATE_EVENTS.make_cast(
            [{"name": "声优甲", "role": "已排除的角色"}], Identities(), "official_youtube",
        )
        self.assertEqual(len(cast), 1)
        self.assertEqual(cast[0]["voice_actor_id"], "va-1")
        self.assertEqual(cast[0]["character_id"], "")
        self.assertEqual(cast[0]["role"], "")

    def test_wikipedia_search_identity_rejects_unrelated_people(self):
        self.assertEqual(UPDATE_EVENTS.wikipedia_title_key("中島由貴 (声優)"), UPDATE_EVENTS.wikipedia_title_key("中島由貴"))
        self.assertNotEqual(UPDATE_EVENTS.wikipedia_title_key("上田瞳"), UPDATE_EVENTS.wikipedia_title_key("高柳知葉"))

    def test_official_profile_photo_reads_supported_agency_pages(self):
        from events_pipeline import program_discovery, common
        original_json = program_discovery.fetch_json_url
        original_text = common.fetch_text_url
        try:
            program_discovery.fetch_json_url = lambda _url: {
                "talent": {"image_path1": "https://across-ent.com/assets/media/portrait.jpg"}
            }
            common.fetch_text_url = lambda _url: '<meta property="og:image" content="/ogp.jpg"><div class="photo"><img src="/img/talent/32/1.jpg"></div>'
            self.assertEqual(
                UPDATE_EVENTS.official_profile_photo("https://across-ent.com/voice_actor/detail.html?id=110")["photo_url"],
                "https://across-ent.com/assets/media/portrait.jpg",
            )
            self.assertEqual(
                UPDATE_EVENTS.official_profile_photo("https://www.kenproduction.co.jp/talent/32")["photo_url"],
                "https://www.kenproduction.co.jp/img/talent/32/1.jpg",
            )
        finally:
            program_discovery.fetch_json_url = original_json
            common.fetch_text_url = original_text

    def test_credits_inherit_but_recording_lyrics_require_an_explicit_mapping(self):
        work = {
            "title": "Test Song",
            "versions": {
                "original": {
                    "id": "original", "title": "Test Song", "version_label": "", "instrumental": False,
                    "releases": [{"release_date": "2024-01-01"}],
                },
                "alternate": {
                    "id": "alternate", "title": "Test Song Another Ver.", "version_label": "Another Ver.", "instrumental": False,
                    "releases": [{"release_date": "2024-02-01"}],
                },
                "short": {
                    "id": "short", "title": "Test Song (Game Size)", "version_label": "Game Size", "instrumental": False,
                    "releases": [{"release_date": "2024-03-01"}],
                },
                "off-vocal": {
                    "id": "off-vocal", "title": "Test Song (Off Vocal)", "version_label": "Off Vocal", "instrumental": True,
                    "releases": [{"release_date": "2024-04-01"}],
                },
            },
        }
        credits = {"versions": {"original": {"credits": [
            {"role": "composer", "name": "Composer", "creator_id": "creator-composer"},
        ]}}}
        lyrics = {"versions": {"original": {"language": "ja", "lines": ["原曲歌词"]}}}
        original_id = UPDATE_EVENTS.effective_music_metadata(work, credits, lyrics, {"versions": {}}, {"versions": {}})
        self.assertEqual(original_id, "original")
        self.assertEqual(work["versions"]["alternate"]["credits"], work["versions"]["original"]["credits"])
        self.assertEqual(work["versions"]["alternate"]["lyrics_ref"], "")
        self.assertFalse(work["versions"]["alternate"]["has_lyrics"])
        self.assertEqual(work["versions"]["short"]["lyrics_ref"], "")
        self.assertFalse(work["versions"]["short"]["has_lyrics"])
        self.assertEqual(work["versions"]["off-vocal"]["lyrics_ref"], "")
        self.assertFalse(work["versions"]["off-vocal"]["has_lyrics"])
        UPDATE_EVENTS.effective_music_metadata(work, credits, lyrics, {"versions": {}},
                                               {"versions": {"alternate": {"lyrics_from": "original"}}})
        self.assertEqual(work["versions"]["alternate"]["lyrics_ref"], "original")

    def test_committed_relationships_reference_known_records(self):
        catalog = json.loads((ROOT / "data" / "events_catalog.json").read_text(encoding="utf-8"))
        songs = json.loads((ROOT / "data" / "song_catalog.json").read_text(encoding="utf-8"))
        creators = json.loads((ROOT / "data" / "creator_catalog.json").read_text(encoding="utf-8"))
        appearances = json.loads((ROOT / "data" / "appearance_index.json").read_text(encoding="utf-8"))
        profiles = json.loads((ROOT / "data" / "voice_actor_profiles.json").read_text(encoding="utf-8"))["voice_actors"]
        self.assertEqual(UPDATE_EVENTS.validate(catalog, songs, creators, appearances, profiles), [])


if __name__ == "__main__":
    unittest.main()
