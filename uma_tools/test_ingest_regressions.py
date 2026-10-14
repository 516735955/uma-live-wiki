import unittest
from unittest.mock import patch
import auto_albums


class AlbumImportTests(unittest.TestCase):
    def test_official_failure_is_not_an_empty_success(self):
        with patch.object(auto_albums, 'http_json', return_value=None):
            with self.assertRaises(RuntimeError):
                auto_albums.get_official_goods()

    def test_digital_single_and_existing_audio_recovery(self):
        self.assertEqual(auto_albums.infer_type('デジタルシングル「Test」'), '单曲')
        album = {'name': 'Test', 'cover': 'curated', 'songs': [{'name': 'Track', 'artist': 'manual', 'url': ''}]}
        tracks = [{'id': 1, 'name': 'Track', 'artists': [{'name': 'source'}]}]
        with patch.object(auto_albums, 'netease_search', return_value=({'id': 1}, 100)), patch.object(auto_albums, 'netease_detail', return_value={'songs': tracks, 'picUrl': 'automatic'}), patch.object(auto_albums, 'full_audio_ids', return_value={1}), patch.object(auto_albums.time, 'sleep'):
            self.assertTrue(auto_albums.enrich_entry(album))
        self.assertEqual(album['cover'], 'curated')
        self.assertEqual(album['songs'][0]['artist'], 'manual')
        self.assertTrue(album['songs'][0]['url'])

    def test_versions_remain_distinct(self):
        for left, right in [
            ('ANIMATION DERBY Season 2 Vol.1', 'ANIMATION DERBY Season 3 Vol.1'),
            ('WINNING LIVE 01', 'WINNING LIVE 01 Remix'),
            ('WINNING MELODY', 'WINNING MELODY (2021 Remastered Version)'),
        ]:
            self.assertNotEqual(auto_albums.norm_key(left), auto_albums.norm_key(right))
            self.assertEqual(auto_albums.score_album(left, right), 0)

    def test_only_complete_audio_is_imported(self):
        tracks = [{'id': i, 'name': str(i), 'duration': 180000} for i in range(1, 5)]
        result = {'data': [
            {'id': 1, 'code': 200, 'url': 'full', 'time': 180000},
            {'id': 2, 'code': 200, 'url': 'trial', 'time': 30000},
            {'id': 3, 'code': 200, 'url': 'trial', 'time': 180000, 'freeTrialInfo': {'start': 0}},
            {'id': 4, 'code': 404, 'time': 0},
        ]}
        with patch.object(auto_albums, 'http_json', return_value=result):
            songs = auto_albums.build_songs(tracks, 'cover')
        self.assertTrue(songs[0]['url'])
        self.assertEqual([song['url'] for song in songs[1:]], ['', '', ''])
        self.assertEqual(len(songs), 4)


if __name__ == '__main__':
    unittest.main()
