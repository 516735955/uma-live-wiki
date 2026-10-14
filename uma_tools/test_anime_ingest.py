"""Exercise scoped public observations, independent signatures and OCR evidence."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess
from PIL import Image
import anime_credit_text
import anime_web
import sync_anime_credits as credits
import sync_anime_watch as watch
import sync_anime_sources as source


class AnimeIngestTests(unittest.TestCase):
    def test_custom_language_folder_requests_real_tsv_and_removes_processed_image(self):
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory)/'jpn.traineddata'
            model.write_bytes(b'model fixture')
            frame = Path(directory)/'frame.png'
            Image.new('RGB',(200,100),'white').save(frame)
            def run(arguments,timeout=90):
                # Tesseract accepts an absent named config with exit 0 and emits
                # plain text. The collector must not misread that as empty TSV.
                output='監督 山本健'
                if 'tessedit_create_tsv=1' in arguments:
                    output='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t5\t5\t40\t20\t99\t監督\n'
                return subprocess.CompletedProcess(arguments,0,output,'')
            with patch.object(credits,'MODEL',model):
                lines=credits.ocr_image(frame,run=run)
                self.assertEqual(lines[0]['text'],'監督')
                self.assertFalse(frame.with_suffix('.ocr.png').exists())
                with self.assertRaisesRegex(ValueError,'TSV'):
                    credits.ocr_image(frame,run=lambda *args,**kwargs:subprocess.CompletedProcess([],0,'plain text',''))
                self.assertFalse(frame.with_suffix('.ocr.png').exists())

    def test_ocr_columns_do_not_give_people_the_other_columns_role(self):
        lines=[{'text':'監督','confidence':99,'column':0,'left':10,'top':0,'bottom':20},
               {'text':'山本健','confidence':99,'column':0,'left':10,'top':26,'bottom':53},
               {'text':'撮影監督','confidence':99,'column':1,'left':400,'top':0,'bottom':20},
               {'text':'大図佑','confidence':99,'column':1,'left':400,'top':26,'bottom':53}]
        rows=credits.frame_signatures(lines,{'監督','撮影監督'},{'山本健','大図佑'},set(),{}, {})
        self.assertEqual([(row['title'],row['name']) for row in rows],[('監督','山本健'),('撮影監督','大図佑')])

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
        self.assertEqual(anime_credit_text.entity_kind({'title':'制作協力'},'新しい個人',set(),set()),'unresolved')
        self.assertEqual(anime_credit_text.entity_kind({'title':'制作協力','@type':'Person'},'個人',set(),set()),'person')
        self.assertEqual(anime_credit_text.entity_kind({'title':'原作'},'既知の作者',{'既知の作者'},set()),'person')

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
                return subprocess.CompletedProcess(arguments,0,json.dumps({'duration':200,'formats':[{'protocol':'https','url':'https://example.test/video','vcodec':'h264','acodec':'none','height':720,'tbr':500}]}), '')
            if arguments[0]=='ffmpeg':
                pattern=arguments[-1]
                Path(pattern.replace('%03d','001')).write_bytes(b'frame')
                Path(pattern.replace('%03d','002')).write_bytes(b'frame')
            return subprocess.CompletedProcess(arguments,0,'','')
        from contextlib import nullcontext
        with tempfile.TemporaryDirectory() as directory, patch.object(credits,'range_source',return_value=nullcontext('http://127.0.0.1/video')):
            rows=credits.extract({'url':'https://example.test/official'},Path(directory),run=run,recognize=lambda path:[{'text':'監督 山本健','confidence':99}])
            self.assertEqual([row[0] for row in rows],[150,152])
        self.assertIn('-ss',calls[1])
        self.assertIn('-t',calls[1])
        self.assertEqual(list(Path(directory).glob('*')),[])


if __name__=='__main__':
    unittest.main()
