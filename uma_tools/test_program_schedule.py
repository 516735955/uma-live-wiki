import datetime
import unittest

from events_pipeline.program_schedule import extract_announced_time, extract_metadata_time, schedule_for_program


class ProgramScheduleTest(unittest.TestCase):
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
