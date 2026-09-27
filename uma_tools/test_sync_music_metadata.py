#!/usr/bin/env python3

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("sync_music_metadata", ROOT / "uma_tools" / "sync_music_metadata.py")
SYNC = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SYNC)


class MusicMetadataSyncTest(unittest.TestCase):
    def test_credit_merge_only_fills_blank_roles(self):
        existing = {"versions": {"recording": {
            "credits": [{"role": "composer", "name": "人工确认作曲"}],
            "source": "existing",
        }}}
        incoming = {"recording": {
            "credits": [
                {"role": "composer", "name": "自动来源作曲"},
                {"role": "lyricist", "name": "新增作词"},
            ],
            "source": "community",
        }}

        SYNC.merge_credit_rows(existing, incoming)

        self.assertEqual(existing["versions"]["recording"]["credits"], [
            {"role": "composer", "name": "人工确认作曲"},
            {"role": "lyricist", "name": "新增作词"},
        ])
        self.assertEqual(existing["versions"]["recording"]["source"], "existing")
        self.assertEqual(existing["versions"]["recording"]["supplemental_sources"], ["community"])

    def test_manual_credit_row_is_never_changed(self):
        existing = {"versions": {"recording": {
            "manual": True,
            "credits": [{"role": "composer", "name": "人工确认作曲"}],
        }}}
        SYNC.merge_credit_rows(existing, {"recording": {
            "credits": [{"role": "lyricist", "name": "自动来源作词"}],
            "source": "community",
        }})
        self.assertEqual(len(existing["versions"]["recording"]["credits"]), 1)

    def test_ambiguous_recording_title_is_not_guessed(self):
        recordings = {
            "a": {"version_id": "a", "version_title": "Same Song", "releases": []},
            "b": {"version_id": "b", "version_title": "Same Song", "releases": []},
        }
        self.assertEqual(SYNC.match_recording_version("Same Song", recordings), "")

    def test_wiki_lyrics_use_japanese_column_only(self):
        source = """{{Song
| title_jp = テスト曲
}}
== Lyrics ==
{| class="wikitable lyrics"
! Kanji !! Romaji !! English
|-
| {{Singer}}日本語一行目<br>日本語二行目
| romaji
| English
|-
| 日本語三行目<br>日本語四行目
| romaji
| English
|}
"""
        version_id, lines = SYNC.parse_wiki_song(
            {"wikitext": source, "title": "Test Song"},
            {SYNC.folded_title("テスト曲"): "version-test"},
        )
        self.assertEqual(version_id, "version-test")
        self.assertEqual(lines, ["日本語一行目", "日本語二行目", "日本語三行目", "日本語四行目"])

    def test_creator_rows_merge_typographic_apostrophe_variants(self):
        existing = {"creators": [
            {"id": "creator-heart", "name": "Heart's Cry", "aliases": []},
            {"id": "creator-heart-curly", "name": "Heart’s Cry", "aliases": []},
        ]}
        credits = {"versions": {
            "original": {"credits": [{"role": "composer", "name": "Heart’s Cry"}]},
            "short": {"credits": [{"role": "arranger", "name": "Heart's Cry"}]},
        }}

        rows = SYNC.creator_rows(credits, existing)

        self.assertEqual(rows, [{
            "id": "creator-heart",
            "name": "Heart's Cry",
            "aliases": ["Heart’s Cry"],
            "type": "person",
            "affiliations": [],
        }])
        self.assertEqual(credits["versions"]["original"]["credits"][0]["name"], "Heart's Cry")
        self.assertEqual(credits["versions"]["original"]["credits"][0]["creator_id"], "creator-heart")


if __name__ == "__main__":
    unittest.main()
