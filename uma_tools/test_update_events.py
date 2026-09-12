#!/usr/bin/env python3

import hashlib
import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("update_events", ROOT / "uma_tools" / "update_events.py")
UPDATE_EVENTS = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(UPDATE_EVENTS)


class EventPipelineTest(unittest.TestCase):
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
                    "cast": [
                        {"name": "明坂聡美", "role": "実況"},
                        {"name": "天海由梨奈", "role": "ミスターシービー"},
                    ],
                },
                {
                    "label": "DAY2",
                    "date": "2024-03-31",
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

    def test_official_special_scope_includes_cast_commentary(self):
        self.assertTrue(
            UPDATE_EVENTS.is_official_special_video(
                "アニメ「うまよん」特別企画 オーディオコメンタリーリレー第１回"
            )
        )
        self.assertFalse(UPDATE_EVENTS.is_official_special_video("【ラジオ切り抜き】レースの模様をお届け！"))

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

    def test_setlist_song_versions_are_preserved(self):
        self.assertEqual(
            UPDATE_EVENTS.clean_song("winning the soul（GO BEYOND Mix Ver.）"),
            "winning the soul（GO BEYOND Mix Ver.）",
        )
        self.assertEqual(
            UPDATE_EVENTS.clean_song("うまぴょい伝説 ※Short ver."),
            "うまぴょい伝説 ※Short ver.",
        )

    def test_song_catalog_groups_explicit_versions_without_losing_releases(self):
        class Identities:
            @staticmethod
            def character_id(name):
                return {"スペシャルウィーク": "specialweek"}.get(name, "")

            @staticmethod
            def voice_id(_name):
                return ""

            @staticmethod
            def current_character_id(_actor_id):
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
        self.assertEqual(catalog["coverage"], {"songs": 1, "versions": 7, "albums": 1, "release_tracks": 6, "live_performances": 1})
        self.assertEqual(catalog["songs"][0]["title"], "Song A")
        self.assertEqual(len(catalog["songs"][0]["versions"]), 7)
        character_version = next(version for version in catalog["songs"][0]["versions"] if "スペシャルウィーク" in version["title"])
        self.assertEqual(character_version["version_label"], "Game Size / 角色独唱：スペシャルウィーク")
        self.assertEqual(events[0]["sessions"][0]["performances"][0]["song_id"], catalog["songs"][0]["id"])

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
                            locator = {
                                "file": "data/live_cat_data.json",
                                "category": category,
                                "section": section_index if has_sections else None,
                                "group": group_index,
                                "performance": performance_index,
                                "day": day_index,
                            }
                            expected[json.dumps(locator, sort_keys=True)] = day.get("table") or ""
        self.assertEqual(set(actual), set(expected))

        class NoCharacters:
            @staticmethod
            def character_id(_name):
                return ""

        for locator, table in expected.items():
            parsed_songs = [row["song"] for row in UPDATE_EVENTS.table_performances(table, NoCharacters())]
            self.assertEqual(actual[locator]["songs"], parsed_songs, locator)

    def test_only_curated_sessions_may_contain_songs(self):
        built = UPDATE_EVENTS.build()
        for event in built["catalog"]["events"]:
            for session in event.get("sessions") or []:
                expected_status = "verified" if session.get("setlist_source") else "none"
                self.assertEqual(session["setlist_status"], expected_status)
                if session.get("songs") or session.get("performances"):
                    self.assertIn(session.get("setlist_source", {}).get("file"), {
                        "data/live_data.json", "data/live_cat_data.json",
                    })

    def test_every_event_has_a_stable_visible_cover(self):
        built = UPDATE_EVENTS.build()
        for event in built["catalog"]["events"]:
            self.assertTrue(event["image"], event["id"])
            self.assertTrue(event["image_fallback"], event["id"])

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

    def test_character_only_programs_do_not_become_voice_appearances(self):
        built = UPDATE_EVENTS.build()
        character_only_ids = {
            event["id"]
            for event in built["catalog"]["events"]
            if event.get("cast_status") == "character_only"
        }
        voice_event_ids = {
            event["event_id"]
            for actor in built["appearances"]["voice_actors"].values()
            for event in actor["events"]
        }
        self.assertTrue(character_only_ids)
        self.assertTrue(character_only_ids.isdisjoint(voice_event_ids))

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

    def test_wikipedia_search_identity_rejects_unrelated_people(self):
        self.assertEqual(UPDATE_EVENTS.wikipedia_title_key("中島由貴 (声優)"), UPDATE_EVENTS.wikipedia_title_key("中島由貴"))
        self.assertNotEqual(UPDATE_EVENTS.wikipedia_title_key("上田瞳"), UPDATE_EVENTS.wikipedia_title_key("高柳知葉"))

    def test_official_profile_photo_reads_supported_agency_pages(self):
        original_json = UPDATE_EVENTS.fetch_json_url
        original_text = UPDATE_EVENTS.fetch_text_url
        try:
            UPDATE_EVENTS.fetch_json_url = lambda _url: {
                "talent": {"image_path1": "https://across-ent.com/assets/media/portrait.jpg"}
            }
            UPDATE_EVENTS.fetch_text_url = lambda _url: '<meta property="og:image" content="/ogp.jpg"><div class="photo"><img src="/img/talent/32/1.jpg"></div>'
            self.assertEqual(
                UPDATE_EVENTS.official_profile_photo("https://across-ent.com/voice_actor/detail.html?id=110")["photo_url"],
                "https://across-ent.com/assets/media/portrait.jpg",
            )
            self.assertEqual(
                UPDATE_EVENTS.official_profile_photo("https://www.kenproduction.co.jp/talent/32")["photo_url"],
                "https://www.kenproduction.co.jp/img/talent/32/1.jpg",
            )
        finally:
            UPDATE_EVENTS.fetch_json_url = original_json
            UPDATE_EVENTS.fetch_text_url = original_text

    def test_committed_relationships_reference_known_records(self):
        catalog = json.loads((ROOT / "data" / "events_catalog.json").read_text(encoding="utf-8"))
        songs = json.loads((ROOT / "data" / "song_catalog.json").read_text(encoding="utf-8"))
        appearances = json.loads((ROOT / "data" / "appearance_index.json").read_text(encoding="utf-8"))
        profiles = json.loads((ROOT / "data" / "voice_actor_profiles.json").read_text(encoding="utf-8"))["voice_actors"]
        self.assertEqual(UPDATE_EVENTS.validate(catalog, songs, appearances, profiles), [])


if __name__ == "__main__":
    unittest.main()
