import unittest
import urllib.error
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from uma_tools import update_anime


class UpdateAnimeMaintenanceTests(unittest.TestCase):
    def test_empty_parser_value_is_unknown_unless_explicitly_confirmed(self):
        row = update_anime.with_field_status({"summary_ja": "", "stills": []})
        self.assertEqual(row["field_status"]["summary_ja"], "unknown")
        self.assertEqual(row["field_status"]["stills"], "unknown")
        row = update_anime.with_field_status({"summary_ja": "", "stills": []},
                                              {"summary_ja": "confirmed_empty", "stills": "confirmed_empty"})
        self.assertEqual(row["field_status"]["summary_ja"], "confirmed_empty")

    def test_failed_source_preserves_previous_candidates(self):
        old = [{"kind": "unit_field_changed", "work_id": "anime-s3", "unit_number": 2, "field": "staff_ja"}]
        self.assertEqual(update_anime.merge_candidates(old, [], [{"source": "official-cingray", "error": "timeout"}]), old)

    def test_failed_source_reads_old_snapshot_and_reports_actual_error(self):
        with tempfile.TemporaryDirectory() as directory:
            snapshot_dir = Path(directory)
            old = {"schema_version": 1, "units": [{"number": 1, "title_ja": "old"}]}
            (snapshot_dir / "source.json").write_text(json.dumps(old), encoding="utf-8")
            with patch.object(update_anime, "SNAPSHOT_DIR", snapshot_dir):
                observed, error = update_anime._safe_observe("source", lambda at: (_ for _ in ()).throw(TimeoutError("network")), "source.json", "now")
            self.assertEqual(observed["units"][0]["title_ja"], "old")
            self.assertIn("TimeoutError", error["error"])

    def test_successful_source_does_not_clear_pending_staff_change(self):
        old = [{"kind": "source_field_changed", "work_id": "anime-cinderella-gray", "unit_number": 2,
                "field": "staff_ja", "current": "before", "observed": "new"}]
        current = {"source_url": "https://anime-cinderellagray.com/story/",
                   "units": [{"number": 2, "staff_ja": "new", "field_status": {"staff_ja": "observed"}}]}
        self.assertEqual(update_anime.merge_candidates(old, [], [], current), old)

    def test_second_observation_of_same_source_change_keeps_pending_candidate(self):
        old = [{"kind": "source_field_changed", "work_id": "anime-cinderella-gray", "unit_number": 2,
                "field": "staff_ja", "current": "before", "observed": "new"}]
        current = {"source_url": "https://anime-cinderellagray.com/story/",
                   "units": [{"number": 2, "staff_ja": "new", "field_status": {"staff_ja": "observed"}}]}
        first = update_anime.merge_candidates(old, [], [], current)
        second = update_anime.merge_candidates(first, [], [], current)
        self.assertEqual(second, old)

    def test_source_reverting_to_previous_value_resolves_pending_change(self):
        old = [{"kind": "source_field_changed", "work_id": "anime-cinderella-gray", "unit_number": 2,
                "field": "staff_ja", "current": "before", "observed": "new"}]
        reverted = [{"kind": "source_field_changed", "work_id": "anime-cinderella-gray", "unit_number": 2,
                     "field": "staff_ja", "current": "new", "observed": "before"}]
        self.assertEqual(update_anime.merge_candidates(old, reverted, [], {}), [])

    def test_accepted_comparable_source_change_is_removed(self):
        series = update_anime.read_json(update_anime.ANIME_DIR / "units.json")["series"]
        accepted = next(item for item in series if item.get("work_id") == "anime-s1")["titles_ja"][0]
        old = [{"kind": "source_field_changed", "work_id": "anime-s1", "unit_number": 1,
                "field": "title_ja", "current": "old", "observed": accepted}]
        self.assertEqual(update_anime.merge_candidates(old, [], []), [])

    def test_errors_deduplicate_same_candidate_key(self):
        row = {"kind": "new_work", "source": "portal", "observed": {"url": "https://example.test/a"}}
        result = update_anime.merge_candidates([row], [dict(row, extra="second")], [{"source": "portal", "error": "timeout"}])
        self.assertEqual(len(result), 1)

    def test_errors_keep_current_observation_for_same_key(self):
        old = {"kind": "watch_resource_status_changed", "resource_id": "r1", "current": {"status": "reachable"},
               "observed": {"status": "transient"}}
        new = {"kind": "watch_resource_status_changed", "resource_id": "r1", "current": {"status": "transient"},
               "observed": {"status": "reachable"}}
        result = update_anime.merge_candidates([old], [new], [{"source": "watch-links", "error": "other source failed"}])
        self.assertEqual(result, [new])

    def test_unknown_source_field_keeps_previous_candidate(self):
        old = [{"kind": "source_field_changed", "work_id": "anime-cinderella-gray", "unit_number": 2, "field": "staff_ja"}]
        current = {"source_url": "https://anime-cinderellagray.com/story/",
                   "units": [{"number": 2, "field_status": {"staff_ja": "unknown"}}]}
        self.assertEqual(update_anime.merge_candidates(old, [], [], current), old)

    def test_watch_link_scope_and_access_are_preserved(self):
        resources = {"resources": [{"id": "watch-1", "scope": {"type": "unit", "id": "u1"},
                                     "unit_ids": ["u1"], "url": "https://example.test/x",
                                     "access": "membership", "regions": ["CN"]}]}
        with patch.object(update_anime, "read_json", return_value=resources), \
             patch("urllib.request.urlopen") as opener:
            response = opener.return_value.__enter__.return_value
            response.status = 200
            response.geturl.return_value = "https://example.test/final"
            result = update_anime.check_watch_links("2026-10-12T00:00:00+00:00")
        row = result["resources"][0]
        self.assertIsNone(row["work_id"])
        self.assertEqual(row["unit_ids"], ["u1"])
        self.assertEqual(row["access"], "membership")
        self.assertEqual(row["final_url"], "https://example.test/final")

    def test_same_url_resources_retain_distinct_work_and_unit_scope(self):
        unit_map = {"u2": "work-2"}
        work_scope, work_id, work_units = update_anime._resource_scope_metadata(
            {"scope": {"type": "work", "id": "work-1"}, "unit_ids": ["u1"], "url": "same"}, unit_map)
        unit_scope, unit_work, unit_units = update_anime._resource_scope_metadata(
            {"scope": {"type": "unit", "id": "u2"}, "unit_ids": [], "url": "same"}, unit_map)
        self.assertEqual((work_scope["id"], work_id, work_units), ("work-1", "work-1", ["u1"]))
        self.assertEqual((unit_scope["id"], unit_work, unit_units), ("u2", "work-2", ["u2"]))

    def test_head_405_falls_back_to_bounded_get(self):
        resources = {"resources": [{"id": "watch-1", "scope": {"type": "work", "id": "w1"},
                                     "url": "https://example.test/x"}]}
        head_error = urllib.error.HTTPError("https://example.test/x", 405, "method not allowed", {}, None)
        class Response:
            status = 200
            def geturl(self): return "https://example.test/final"
            def read(self, amount): return b"ok"
            def __enter__(self): return self
            def __exit__(self, *args): return False
        with patch.object(update_anime, "read_json", return_value=resources), \
             patch("urllib.request.urlopen", side_effect=[head_error, Response()]) as opener:
            result = update_anime.check_watch_links("2026-10-12T00:00:00+00:00")
        self.assertEqual(result["resources"][0]["http_status"], 200)
        self.assertIn("bounded GET", result["resources"][0]["error"])
        self.assertEqual(opener.call_count, 2)

    def test_rate_limit_is_transient_and_forbidden_is_not_invalid(self):
        self.assertEqual(update_anime._classify_link_status(429), "transient")
        self.assertEqual(update_anime._classify_link_status(403), "auth_or_region")
        self.assertEqual(update_anime._classify_link_status(200), "reachable")

    def test_new_work_and_unit_candidates_have_stable_source_keys(self):
        work = {"kind": "new_work", "source": "portal", "observed": {"url": "https://example.test/a"}}
        unit = {"kind": "new_unit", "work_id": "w1", "observed": {"number": 2}}
        self.assertNotEqual(update_anime._candidate_key(work), update_anime._candidate_key({**work, "observed": {"url": "https://example.test/b"}}))
        self.assertNotEqual(update_anime._candidate_key(unit), update_anime._candidate_key({**unit, "observed": {"number": 3}}))

    def test_accepted_coverage_uses_expanded_titles_and_real_relations(self):
        coverage = update_anime.accepted_coverage()
        season1 = coverage["anime-s1"]
        self.assertEqual(season1["units"], 16)
        self.assertEqual(season1["fields"]["title_ja"]["present"], 16)
        self.assertEqual(season1["fields"]["staff"]["present"], 16)
        self.assertEqual(season1["fields"]["hq_stills"]["present"], 0)
        self.assertEqual(season1["fields"]["hq_stills"]["unknown"], 16)


if __name__ == "__main__":
    unittest.main()
