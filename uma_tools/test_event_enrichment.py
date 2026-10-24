import unittest

from events_pipeline.event_enrichment import apply_groupings, apply_news_images, apply_source_times, apply_venues


class EventEnrichmentTests(unittest.TestCase):
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
