import unittest

from events_pipeline.event_enrichment import apply_groupings, apply_news_images, apply_source_times, apply_venues


class EventEnrichmentTests(unittest.TestCase):
    def test_known_publication_clocks_survive_an_empty_metadata_cache_rebuild(self):
        import tempfile
        from pathlib import Path
        from unittest.mock import patch
        from events_pipeline import program_discovery
        from events_pipeline.build import build
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(program_discovery, 'PROGRAM_METADATA_CACHE', Path(directory)):
                catalog = build()['catalog']
        for identifier in ('pakatube-20260911-among-us-3d-6', 'pakatube-20260301-among-us-3d-6', 'pakatube-20250628-2wlbgvgv2yi'):
            event = next(e for e in catalog['events'] if e['id'] == identifier)
            self.assertEqual(event['sessions'][0]['published_time'], '19:00')
            self.assertTrue(event['sessions'][0]['publication_source_url'].startswith('https://www.youtube.com/watch?v='))

    def test_manual_session_correction_survives_source_time_refresh(self):
        rows = [{'id': 'e', 'title': '16:30', 'summary': '開演 16:30 終演 17:00',
                 'session_patches': {'s': {'date': '2024-02-24', 'start_time': None, 'end_time': None,
                                          'schedule_note': '末场比赛结束后'}},
                 'sessions': [{'id': 's', 'date': '2024-02-25', 'start_time': '16:30',
                               'songs': ['kept'], 'notes_html': '<b>保留</b>'}]}]
        enriched = apply_source_times(apply_source_times(rows))[0]['sessions'][0]
        self.assertEqual(enriched['date'], '2024-02-24')
        self.assertIsNone(enriched['start_time'])
        self.assertIsNone(enriched['end_time'])
        self.assertEqual(enriched['songs'], ['kept'])
        self.assertEqual(enriched['notes_html'], '<b>保留</b>')

    def test_new_competition_stages_require_identity_and_own_stage_title(self):
        group = {"id": "g", "kind": "competition", "members": [{"event_id": "a"}],
                 "source_identity": {"match": "第1回トレセン学園『Gang Beasts』最強決定戦", "rule": "qualifier A-G"}}
        def event(id, title, official=True):
            return {"id": id, "title": title, "summary": group["source_identity"]["match"],
                    "sources": [{"kind": "official_youtube" if official else "unverified"}]}
        events = [event("a", "予選リーグA"), event("final", "Gang Beasts 決勝"),
                  event("semi", "Gang Beasts 準決勝"), event("trailer", "決勝予告"),
                  event("unrelated", "別企画"), event("unverified", "決勝", False)]
        _, groups = apply_groupings(events, {"groups": [group]})
        members = {m["event_id"]: m["label"] for m in groups[0]["members"]}
        self.assertEqual(set(members), {"a", "final", "semi"})
        self.assertEqual(members["final"], "决赛")
        self.assertEqual(members["semi"], "半决赛")

    def test_grouping_is_relationship_only_and_preserves_ids(self):
        events = [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}]
        enriched, groups = apply_groupings(events, {"groups": [{
            "id": "g", "title": "Group", "members": [
                {"event_id": "a", "label": "预选A组"},
                {"event_id": "missing", "label": "预选B组"},
            ],
        }]})
        self.assertEqual([row["id"] for row in enriched], ["a", "b"])
        self.assertEqual(enriched[0]["group_id"], "g")
        self.assertEqual(enriched[0]["group_label"], "预选A组")
        self.assertEqual(groups[0]["missing_event_ids"], ["missing"])

    def test_duplicate_members_do_not_reassign_event(self):
        enriched, groups = apply_groupings(
            [{"id": "a"}],
            {"groups": [
                {"id": "first", "members": [{"event_id": "a"}]},
                {"id": "second", "members": [{"event_id": "a"}]},
            ]},
        )
        self.assertEqual(enriched[0]["group_id"], "first")
        self.assertEqual(enriched[0]["group_ids"], ["first", "second"])
        self.assertEqual(len(groups), 2)

    def test_venue_keeps_raw_value(self):
        enriched = apply_venues(
            [{"id": "e", "venue": "横浜アリーナ"}],
            {"venues": [{"id": "yokohama", "raw": "横浜アリーナ", "display": "横滨体育馆", "name_zh": "横滨体育馆"}]},
        )
        self.assertEqual(enriched[0]["venue"], "横滨体育馆")
        self.assertEqual(enriched[0]["venue_raw"], "横浜アリーナ")
        self.assertEqual(enriched[0]["venue_id"], "yokohama")
        self.assertEqual(apply_venues(enriched, {"venues": [{"id": "yokohama", "raw": "横浜アリーナ", "display": "横滨体育馆", "aliases": ["横滨体育馆"]}]})[0]['venue_raw'], '横浜アリーナ')

    def test_channels_and_regions_are_not_physical_venues(self):
        for status in ('channel', 'region_placeholder'):
            enriched = apply_venues([{'id': 'e', 'venue': 'raw'}], {'venues': [
                {'id': 'placeholder', 'raw': 'raw', 'display': '已知形式或区域', 'normalization_status': status}
            ]})
            self.assertEqual(enriched[0]['venue_id'], '')
            self.assertEqual(enriched[0]['venue_raw'], 'raw')

    def test_historical_venue_name_uses_event_date(self):
        document = {'venues': [{'id': 'v', 'raw': 'Current Arena', 'display': '新冠名',
            'display_history': [{'before': '2026-02-01', 'display': '旧名称'}]}]}
        rows = apply_venues([{'id': 'old', 'venue': 'Current Arena', 'date': '2024-08-31'},
                             {'id': 'new', 'venue': 'Current Arena', 'date': '2026-08-31'}], document)
        self.assertEqual([r['venue'] for r in rows], ['旧名称', '新冠名'])
        self.assertEqual([r['venue_id'] for r in rows], ['v', 'v'])

    def test_official_news_image_replaces_only_matching_program_placeholder(self):
        events = [
            {"id": "paka-live-tv-62", "title": "PakaLive TV Vol.62", "image": "/placeholder.svg"},
            {"id": "other", "title": "PakaLive TV Vol.61", "image": "/placeholder.svg"},
        ]
        snapshot = {"information_list": [
            {"announce_id": 1, "title": "ぱかライブTV Vol.62 発表まとめ！", "image": "https://img.example/62.png"},
            {"announce_id": 2, "title": "ぱかライブTV Vol.61 発表まとめ！", "image": "https://img.example/61.png"},
        ]}
        enriched = apply_news_images(events, snapshot)
        self.assertEqual(enriched[0]["image"], "https://img.example/62.png")
        self.assertEqual(enriched[0]["image_source"]["announce_id"], 1)
        self.assertEqual(enriched[1]["image"], "https://img.example/61.png")

    def test_source_times_preserve_published_precision(self):
        events = [{"id": "e", "title": "A", "summary": "开场 16:30 开演 17:00 终演 19:00", "sessions": [{"id": "s", "label": "本场"}]}]
        enriched = apply_source_times(events)
        session = enriched[0]["sessions"][0]
        self.assertEqual(session["doors_time"], "16:30")
        self.assertEqual(session["start_time"], "17:00")
        self.assertEqual(session["end_time"], "19:00")
        self.assertEqual(session["time_precision"], "minute")


if __name__ == "__main__":
    unittest.main()
