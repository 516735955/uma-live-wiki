"""Focused checks for the sheet job's non-destructive publication boundary."""

import copy
import unittest

from auto_setlists import compare


CAST = '<div class="cast-line">Machico（东海帝王）、大橋彩香（伏特加）</div>'


def catalog(table="", duplicate=False):
    sub = {
        "title": "Example LIVE", "date": "2026-09-13 Hall", "cast": CAST,
        "days": [{"label": "本公演", "table": table}],
    }
    subs = [sub, copy.deepcopy(sub)] if duplicate else [sub]
    return {"other": {"groups": [{"group": "Example LIVE", "subs": subs}]}}


def sheet(songs=None):
    return [{
        "title": "Example LIVE@Hall(東京)", "date": "2026-09-13",
        "songs": songs or [{"no": "1", "name": "First song", "performers": ["Machico", "Guest"]}],
    }]


class SheetPublicationTests(unittest.TestCase):
    def test_only_unique_blank_setlist_is_filled(self):
        source = catalog()
        report = compare(sheet(), source)
        table = source["other"]["groups"][0]["subs"][0]["days"][0]["table"]
        self.assertEqual(len(report["filled"]), 1)
        self.assertIn('class="perf-name">东海帝王</span>', table)
        self.assertIn('class="guest-performer">Guest</span>', table)
        self.assertNotIn('class="perf-name">Guest</span>', table)
        self.assertEqual(compare(sheet(), source)["unchanged"], 1)

    def test_nonempty_setlist_is_never_replaced(self):
        source = catalog("<table>hand-curated</table>")
        report = compare(sheet(), source)
        self.assertEqual(source["other"]["groups"][0]["subs"][0]["days"][0]["table"], "<table>hand-curated</table>")
        self.assertEqual(report["review"][0]["reason"], "nonempty_setlist_differs")

    def test_ambiguous_match_is_not_published(self):
        source = catalog(duplicate=True)
        report = compare(sheet(), source)
        self.assertEqual(report["filled"], [])
        self.assertEqual(report["review"][0]["matches"], 2)

    def test_incomplete_sheet_credit_is_not_published(self):
        source = catalog()
        report = compare(sheet([{"no": "1", "name": "First song", "performers": []}]), source)
        self.assertEqual(report["filled"], [])
        self.assertEqual(report["review"][0]["reason"], "missing_song_performers")


if __name__ == "__main__":
    unittest.main()
