import unittest
from unittest.mock import patch
import auto_albums


class AlbumImportTests(unittest.TestCase):
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
