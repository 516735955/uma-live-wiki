import datetime
import unittest

from events_pipeline.program_schedule import extract_announced_time, extract_metadata_time, schedule_for_program


class ProgramScheduleTest(unittest.TestCase):
    def test_multiple_dates_keep_independent_late_night_clocks(self):
        from events_pipeline.program_text import program_session_time
        description = "2025年7月6日（日）25:55 ～ 26:20\n2025年7月13日（日）26:05 ～ 26:30"
        first = program_session_time(description, "2025-07-06")
        second = program_session_time(description, "2025-07-13")
        self.assertEqual((first["broadcast_date"], first["broadcast_time"]), ("2025-07-07", "01:55"))
        self.assertEqual((second["broadcast_date"], second["broadcast_time"]), ("2025-07-14", "02:05"))
        self.assertEqual(program_session_time(description, "2025-07-20"), {})

    def test_japanese_hour_without_minutes(self):
        self.assertEqual(extract_announced_time("「ぱかライブTV' #5」は7月29日20時放送！")["broadcast_time"], "20:00")

    def test_colon_and_minutes(self):
        self.assertEqual(extract_announced_time("10月24日20:30から配信")["broadcast_time"], "20:30")

    def test_chapter_and_deadline_are_not_broadcast_times(self):
        self.assertIsNone(extract_announced_time("番組概要\nchapter 00:00\n报名截止 12:00"))

    def test_after_midnight_is_normalized_to_next_date(self):
        value = schedule_for_program(source_title="24時30分から放送", broadcast_date="2026-10-24")
        self.assertEqual(value["broadcast_time"], "00:30")
        self.assertEqual(value["broadcast_date"], "2026-10-25")

    def test_date_only_does_not_invent_midnight(self):
        self.assertIsNone(extract_announced_time("2026年10月24日に公開"))

    def test_half_hour_and_fullwidth_clock(self):
        self.assertEqual(extract_announced_time('２２時半から放送')['broadcast_time'], '22:30')

    def test_upload_clock_is_publication(self):
        value = schedule_for_program(metadata={'release_timestamp': 0, 'live_status': 'not_live', 'webpage_url': 'https://example.test/video'})
        self.assertEqual(value['published_time'], '09:00')
        self.assertNotIn('broadcast_time', value)
        legacy = schedule_for_program(metadata={'release_timestamp': 0, 'webpage_url': 'https://example.test/video'})
        self.assertEqual(legacy['published_time'], '09:00')
        self.assertNotIn('broadcast_time', legacy)
        live = schedule_for_program(metadata={'release_timestamp': 0, 'was_live': True})
        self.assertEqual(live['broadcast_time'], '09:00')

    def test_verified_metadata_is_jst(self):
        value = extract_metadata_time({"release_timestamp": datetime.datetime(2026, 10, 24, 11, tzinfo=datetime.timezone.utc).timestamp()})
        self.assertEqual(value["broadcast_time"], "20:00")
        self.assertEqual(value["broadcast_time_kind"], "metadata")

    def test_iso_metadata_is_jst(self):
        value = extract_metadata_time({"startTimestamp": "2026-10-24T11:00:00Z"})
        self.assertEqual(value["broadcast_time"], "20:00")

    def test_watch_date_only_does_not_become_midnight(self):
        self.assertIsNone(extract_metadata_time({"metadata_origin": "official_watch_page", "release_timestamp": 1792796400, "release_precision": "date"}))

    def test_text_wins_over_metadata(self):
        value = schedule_for_program(source_title="10月24日20時放送", metadata={"release_timestamp": 0})
        self.assertEqual(value["broadcast_time"], "20:00")


if __name__ == "__main__":
    unittest.main()
