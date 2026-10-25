"""Identity and lyric boundary cases from the main maintenance audit."""
import unittest
import subprocess
import json
from pathlib import Path
from auto_albums import stable_album_id as automatic_album_id
from events_pipeline.song_identity import stable_album_id as catalog_album_id

from music_pipeline.credits import creator_rows, parse_credit_text
from music_pipeline.recordings import match_recording_version, folded_title
from music_pipeline.lyrics import parse_lyric, canonicalize_lyrics, lyric_line_key
from music_pipeline.utaten import artist_match, json_ld_composition
from music_pipeline.timings import apply_lrclib_results


class MusicBoundaryTests(unittest.TestCase):
    def test_album_identity_matches_runtime_for_punctuation_and_unicode(self):
        rows = [{'name': 'A・B'}, {'name': 'We’re Full！'}, {'name': ' ＣＤ １ '}, {'name': '改名', 'id': 'kept-id'}]
        runtime = json.loads(subprocess.check_output(['node', '-e',
            'const {stableAlbumId}=require("./uma_tools/catalog-store");'
            'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map(stableAlbumId)));',
            json.dumps(rows)], cwd=Path(__file__).resolve().parents[1], text=True))
        self.assertEqual([automatic_album_id(row) for row in rows], runtime)
        self.assertEqual([catalog_album_id(row) for row in rows], runtime)

    def test_release_evidence_is_required_even_for_one_title(self):
        recordings = {'v': {'version_id': 'v', 'version_title': 'Song', 'releases': [
            {'album_name': 'Album', 'track_number': 2}]}}
        self.assertEqual(match_recording_version('Song', recordings, 'Other', 2), '')
        self.assertEqual(match_recording_version('Song', recordings, 'Album', 1), '')
        self.assertEqual(match_recording_version('Song', recordings, 'Album', 2), 'v')

    def test_creator_foreign_keys_and_new_aliases_share_identity(self):
        credits = {'versions': {'v': {'manual': True, 'credits': [{'name': 'Alias', 'creator_id': 'canonical'}]},
                                'w': {'credits': [{'name': 'A.B'}, {'name': 'AB'}]}}}
        rows = creator_rows(credits, {'creators': [{'id': 'canonical', 'name': 'Name'}]})
        self.assertEqual(credits['versions']['v']['credits'][0]['creator_id'], 'canonical')
        new = credits['versions']['w']['credits']
        self.assertEqual(new[0]['creator_id'], new[1]['creator_id'])
        self.assertEqual(len(rows), 2)

    def test_bracketed_affiliation_is_not_a_person_separator(self):
        rows = parse_credit_text('作曲：JUN (Digz, Inc. Group)')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['name'], 'JUN')

    def test_japanese_long_vowels_and_multiple_lrc_stamps(self):
        self.assertNotEqual(folded_title('コート'), folded_title('コト'))
        self.assertNotEqual(lyric_line_key('パーティー'), lyric_line_key('パティ'))
        lines, _ = parse_lyric('[offset:1000]\n[00:01.00][00:05.00]歌詞です')
        self.assertEqual([line['start_ms'] for line in lines], [0, 4000])
        self.assertEqual([line['text'] for line in lines], ['歌詞です', '歌詞です'])

    def test_jsonld_graph_and_exact_artist_identity(self):
        composition = json_ld_composition('<script type="application/ld+json">{"@graph":[{"@type":"MusicComposition","recordedAs":{"byArtist":{"name":"ArtistAB"}}}]}</script>')
        self.assertTrue(composition)
        self.assertFalse(artist_match({'artists': ['ArtistA']}, composition))
        self.assertTrue(artist_match({'artists': ['ArtistAB']}, composition))

    def test_utaten_character_ensemble_requires_every_credited_performer(self):
        composition = {'recordedAs': {'byArtist': {'name': '甲(CV. ArtistA),乙（ArtistB）'}}}
        self.assertTrue(artist_match({'artists': ['ArtistA', 'ArtistB']}, composition))
        self.assertFalse(artist_match({'artists': ['ArtistA']}, composition))
        self.assertFalse(artist_match({'artists': ['ArtistA', 'ArtistC']}, composition))

    def test_blank_timing_line_does_not_shift_lyric_ids(self):
        lyrics, timings = canonicalize_lyrics({'v': {'song_id': 's'}},
            {'versions': {'v': {'lines': ['甲', '乙']}}},
            {'versions': {'v': {'lines': [{'start_ms': 0, 'text': ''}, {'start_ms': 10, 'text': '甲'}, {'start_ms': 20, 'text': '乙'}]}}})
        rows = timings['versions']['v']['lines']
        self.assertEqual(rows[0]['line_id'], '')
        self.assertEqual(rows[1]['line_id'], lyrics['documents']['s-lyrics']['lines'][0]['id'])

    def test_translated_recording_keeps_its_own_line_breaks(self):
        lyrics, _ = canonicalize_lyrics({'a': {'song_id': 's'}, 'b': {'song_id': 's'}},
            {'versions': {'a': {'lines': ['甲', '乙']}, 'b': {'lines': ['甲乙'], 'translation': ['AB']}}}, {})
        self.assertEqual(len(lyrics['documents']), 2)

    def test_explicit_timing_refresh_keeps_manual_work(self):
        timings = {'versions': {'v': {'source': 'old'}, 'm': {'manual': True}}}
        result = {'source_id': 1, 'lines': [{'start_ms': 1, 'text': 'a'}]}
        apply_lrclib_results({'v': result, 'm': result}, timings, {'v', 'm'})
        self.assertEqual(timings['versions']['v']['source'], 'lrclib_verified_timing')
        self.assertTrue(timings['versions']['m']['manual'])


if __name__ == '__main__':
    unittest.main()
