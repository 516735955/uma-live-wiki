"""Exercise scoped public observations, independent signatures and OCR evidence."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess
import anime_credit_text
import anime_web
import sync_anime_credits as credits
import sync_anime_watch as watch
import sync_anime_sources as source


class AnimeIngestTests(unittest.TestCase):
    def test_official_html_episode_and_explicit_work_end_date(self):
        markup = '<h2 class="episode-title">第3話 最終話</h2><p class="story-text">官方简介</p><div class="episode"><img src="/3.jpg"></div>'
        rows = anime_web.episode_records(markup,'work','https://example.test/story/3/')
        self.assertEqual(rows[0]['number'],3)
        self.assertEqual(rows[0]['stills'],['https://example.test/3.jpg'])
        metadata = {'@type':'TVSeries','startDate':'2026-01-01','endDate':'2026-10-14','creativeWorkStatus':'completed'}
        self.assertEqual(anime_web.work_metadata('<script type="application/ld+json">'+json.dumps(metadata)+'</script>')['status'],'completed')

    def test_nuxt_explicit_episode_records_are_read(self):
        values = [{'no':1,'title':2,'text':3,'images':4},3,'第三话','简介',[]]
        rows = anime_web.episode_records('<script id="__NUXT_DATA__">'+json.dumps(values)+'</script>','work','https://example.test/')
        self.assertEqual(rows[0]['number'],3)

    def test_people_and_organizations_are_independent_and_unknown_names_stay_unclassified(self):
        rows = anime_credit_text.staff_text_rows('協力：阿部憶人\n協力：岐阜県地方競馬組合', ['協力'])
        self.assertEqual([row['name'] for row in rows],['阿部憶人','岐阜県地方競馬組合'])
        self.assertEqual(anime_credit_text.entity_kind(rows[0],rows[0]['name'],{'阿部憶人'},set()),'person')
        self.assertEqual(anime_credit_text.entity_kind(rows[1],rows[1]['name'],set(),set()),'organization')
        self.assertEqual(anime_credit_text.entity_kind({'title':'協力'},'OCT',set(),set()),'unresolved')

    def test_ocr_requires_repeated_original_spellings_and_keeps_distinct_names(self):
        a={'kind':'staff','title':'原画','name':'楊烈駿','entity_type':'person'}
        b={**a,'name':'楊烈瞬'}
        rows=credits.consensus([(1,Path('1.png'),[a,b]),(4,Path('2.png'),[a]),(7,Path('3.png'),[b])])
        self.assertEqual({row[2]['name'] for row in rows},{'楊烈駿','楊烈瞬'})
        self.assertEqual(credits.consensus([(1,Path('1.png'),[a])]),[])

    def test_watch_transient_failure_keeps_existing_status_and_definitive_removal_updates_it(self):
        document={'resources':[{'id':'good','url':'https://example.test/good','status':'active'},{'id':'removed','url':'https://example.test/gone','status':'active'}]}
        failures=watch.refresh(document,{},check=lambda row:('source_unavailable','offline') if row['id']=='good' else ('expired','removed'),now=100000)
        self.assertEqual(failures,['good'])
        self.assertEqual(document['resources'][0]['status'],'active')
        self.assertEqual(document['resources'][1]['status'],'expired')

    def test_clip_extraction_is_bounded_and_frames_have_time_positions(self):
        calls=[]
        def run(arguments, timeout=90):
            calls.append(arguments)
            if arguments[0]=='yt-dlp' and '--skip-download' in arguments:
                return subprocess.CompletedProcess(arguments,0,json.dumps({'duration':200}), '')
            if arguments[0]=='yt-dlp':
                pattern=Path(arguments[arguments.index('-o')+1]); Path(str(pattern).replace('%(ext)s','mp4')).write_bytes(b'clip')
            else:
                pattern=arguments[-1]
                Path(pattern.replace('%03d','001')).write_bytes(b'frame')
                Path(pattern.replace('%03d','002')).write_bytes(b'frame')
            return subprocess.CompletedProcess(arguments,0,'','')
        with tempfile.TemporaryDirectory() as directory:
            rows=credits.extract({'url':'https://example.test/official'},Path(directory),run=run,recognize=lambda path:[{'text':'監督 山本健','confidence':99}])
            self.assertEqual([row[0] for row in rows],[30,33])
        self.assertIn('--download-sections',calls[1])
        self.assertIn('--max-filesize',calls[1])


if __name__=='__main__':
    unittest.main()
