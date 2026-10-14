import unittest
from unittest.mock import patch
import auto_albums
import crawl_events
import update_events
import crawl_horses
from horses_pipeline import transport, common as horse_config
from pathlib import Path
import hashlib
import os
import tempfile
import io


class AlbumImportTests(unittest.TestCase):
    def test_horse_source_cache_rechecks_expired_pages(self):
        url='https://example.test/horse'
        with tempfile.TemporaryDirectory() as directory:
            cached=Path(directory)/(hashlib.sha1(url.encode()).hexdigest()[:16]+'.txt')
            cached.write_text('old source')
            os.utime(cached,(0,0))
            class Opener:
                def open(self,*args,**kwargs):return io.BytesIO(b'new source')
            with patch.object(horse_config,'CACHE_DIR',directory),patch.object(transport,'_opener',return_value=Opener()) as opener:
                self.assertEqual(transport.http_get(url),'new source')
                self.assertEqual(transport.http_get(url),'new source')
                self.assertEqual(opener.call_count,1)
            self.assertEqual(cached.read_text(),'new source')
    def test_historical_birth_precision_keeps_explicit_real_dates(self):
        year=crawl_horses.birth_precision({'born':1700,'birthdate':'1700.01.01'})
        exact=crawl_horses.birth_precision({'born':1764,'birthdate':'1764-04-01'})
        accepted=crawl_horses.birth_precision({'born':1750,'birthdate':'1750-01-01','birth_precision':'day'})
        self.assertEqual(year['birthdate'],'')
        self.assertEqual(exact['birth_precision'],'day')
        self.assertEqual(accepted['birthdate'],'1750-01-01')
    def test_recovered_voice_source_keeps_the_existing_accepted_fields(self):
        original={'records':[{'lookup_name':'山本','status':'source_unavailable','birthday':'1月1日','agency':'curated','sources':[]}]}
        fetched={'records':[{'lookup_name':'山本','status':'complete','birthday':'2月2日','birthplace':'Tokyo','agency':'new source','sources':[]}]}
        result=update_events.apply_additive_voice_detail_refresh(original,fetched)['records'][0]
        self.assertEqual(result['birthday'],'1月1日')
        self.assertEqual(result['agency'],'curated')
        self.assertEqual(result['birthplace'],'Tokyo')
        self.assertEqual(result['status'],'complete')
    def test_truncated_event_listing_preserves_the_detail_roster(self):
        previous={'actors':[{'name':'A','url':'/a'},{'name':'B','url':'/b'}],'title':'old','live':'linked'}
        incoming={'actors':[{'name':'A','url':'/a'}],'title':'correct','live':''}
        result=crawl_events.merge_listing(previous,incoming)
        self.assertEqual(result['actors'],previous['actors'])
        self.assertEqual(result['title'],'correct')
        self.assertEqual(result['live'],'linked')
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
