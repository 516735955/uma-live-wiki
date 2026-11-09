"""Exercise scoped public observations, independent signatures and OCR evidence."""
import json
import io
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
from events_pipeline import program_discovery


class AnimeIngestTests(unittest.TestCase):
    def test_complete_legacy_staff_and_existing_cast_are_reused(self):
        units = ['work-e13', 'work-e14']
        documents = {
            'ending_credits': {'episodes': []},
            'units': {'series': [{'work_id': 'work', 'published_numbers': [13, 14],
                                  'details': {'13': {'staff_status': 'complete'},
                                              '14': {'staff_status': 'complete', 'cast_status': 'partial'}}}]},
            'staff': {'credits': [{'unit_id': unit} for unit in units]},
            'relations': {'relations': [{'source_type': 'anime_unit', 'source_id': unit,
                                          'relation_type': 'credited_cast'} for unit in units]},
            'watch_resources': {'resources': [{'authority': 'official', 'content_type': 'full_episode',
                                               'status': 'active', 'scope': {'id': unit}} for unit in units]}
        }
        jobs, _ = credits.ending_jobs(documents, {}, {}, 172800)
        self.assertEqual([row['scope']['id'] for row in jobs], ['work-e14'])

    def test_episode_publication_uses_exact_identity_and_keeps_curated_dates(self):
        from collect_anime_official import fullgate_publication
        channel='UCAWxPGGuIfWME2KTLUmSCHw'
        metadata={'id':'9FwDmrbvdVQ','channel_id':channel,'release_timestamp':1792929610,
                  'metadata_origin':'official_channel_feed'}
        feed=lambda video,owner:metadata
        rows=fullgate_publication([{'number':5,'youtube_id':metadata['id']}],feed_reader=feed)
        self.assertEqual(rows[0]['release_date'],'2026-10-25')
        self.assertEqual(rows[0]['dates'][0]['display'],'2026-10-25 21:00')
        def unexpected(*args):raise AssertionError('saved publication date must not be fetched again')
        rows=fullgate_publication([{'number':5,'youtube_id':metadata['id']}],{'5':{'release_date':'2026-10-25'}},
                                 feed_reader=unexpected,watch_reader=unexpected)
        self.assertEqual(rows[0]['release_date'],'2026-10-25')
        rows=fullgate_publication([{'number':5,'youtube_id':metadata['id']}],
                                 feed_reader=lambda *args:{**metadata,'channel_id':'different'},
                                 watch_reader=lambda *args:{**metadata,'id':'different'})
        self.assertNotIn('release_date',rows[0])
        self.assertEqual(rows[0]['date_status'],'source_unavailable')

        def unavailable(*args):
            raise OSError('video metadata unavailable')

        official = 'https://umamusume.jp/contents/anime/umayuru-fullgate/episodes/7/'
        rows = fullgate_publication([{'number':7, 'youtube_id':'iRmhghaZ94A', 'source_url':official,
                                      'official_page_published_at':'2026-11-07T15:05:04.883Z'}],
                                    feed_reader=unavailable, watch_reader=unavailable)
        self.assertEqual(rows[0]['release_date'], '2026-11-08')
        self.assertEqual(rows[0]['dates'][0]['source_url'], official)
        self.assertNotIn('published_at', rows[0])

    def test_legacy_verified_staff_is_not_downloaded_again_for_missing_cast_flag(self):
        documents={key:{} for key in ('works','units','relations','staff','people','source_registry','watch_resources','asset_sources','ending_credits')}
        episode={'work_id':'work','number':1,'staff_status':'complete','cast':[]}
        documents.update(units={'series':[{'work_id':'work','released_count':1,'published_numbers':[1]}]},
                         staff={'credits':[]},relations={'relations':[]},people={'people':[]},ending_credits={'episodes':[episode]},
                         watch_resources={'resources':[{'authority':'official','content_type':'full_episode','status':'active',
                             'scope':{'id':'work-e01'},'url':'https://example.test/episode'}]})
        def read(file,*args):
            if file==credits.STATE:return {'attempted_at':{}}
            if file.name=='voice_actor_profiles.json':return {'voice_actors':[]}
            return documents[file.stem]
        with tempfile.TemporaryDirectory() as directory, patch.object(credits,'TEMP',Path(directory)/'jobs'), \
             patch.object(credits,'read_json',side_effect=read),patch.object(credits,'read_window',return_value=[]), \
             patch('sys.argv',['collector','--dry-run']),patch.object(credits,'extract') as extract:
            self.assertEqual(credits.main(),0)
            extract.assert_not_called()
            self.assertNotIn('cast_status',episode, 'unverified cast must not be marked complete')

    def test_reviewed_unit_with_archived_staff_and_cast_skips_the_video(self):
        docs = {
            'ending_credits': {'episodes': []},
            'units': {'series': [{'work_id':'work', 'published_numbers':[1],
                                  'details': {'1': {'staff_status':'complete', 'cast_status':'complete'}}}]},
            'staff': {'credits': [{'unit_id':'work-e01', 'role':'脚本', 'name':'作者'}]},
            'relations': {'relations': [{'source_type':'anime_unit', 'source_id':'work-e01',
                                         'relation_type':'credited_cast'}]},
            'watch_resources': {'resources': [{'authority':'official', 'content_type':'full_episode',
                                               'status':'active', 'scope':{'id':'work-e01'}}]},
        }
        self.assertEqual(credits.ending_jobs(docs, {}, {}, 100000)[0], [])
        docs['relations']['relations'].clear()
        self.assertEqual(len(credits.ending_jobs(docs, {}, {}, 100000)[0]), 1)

    def test_ending_inline_signature_keeps_its_own_role(self):
        lines = [{'text':text,'confidence':99,'left':20,'top':index*30,'bottom':index*30+20,'column':0}
                 for index,text in enumerate(['脚本  日高勝郎','絵コンテ  ささきみつる'])]
        rows = credits.frame_signatures(lines, {'脚本','絵コンテ'}, set(), set(), {}, {})
        self.assertEqual([(row['title'],row['name']) for row in rows], [('脚本','日高勝郎'),('絵コンテ','ささきみつる')])
    def test_ending_source_failure_retries_after_one_hour_and_recovers_to_daily_refresh(self):
        state = {'attempted_at': {}}
        documents = {name: {} for name in ('works','asset_sources')}
        documents.update(units={'series':[{'work_id':'work','released_count':1}]},
                         staff={'credits':[]}, relations={'relations':[]}, people={'people':[]}, source_registry={'sources':[]},
                         ending_credits={'episodes':[]}, voice_actor_profiles={'voice_actors':[]},
                         watch_resources={'resources':[{'authority':'official','content_type':'full_episode',
                           'status':'active','scope':{'id':'work-e01'},'url':'https://example.test/episode'}]})
        def read(file, *args):
            return state if file == credits.STATE else documents[file.stem]
        with tempfile.TemporaryDirectory() as directory, patch.object(credits,'TEMP',Path(directory)/'jobs'), \
             patch.object(credits,'read_json',side_effect=read), patch.object(credits,'read_window',return_value=[]), \
             patch.object(credits.shutil,'which',return_value='/tool'), patch('sys.argv',['collector','--dry-run']), \
             patch.object(credits.time,'time',return_value=100000) as clock, \
             patch.object(credits,'extract',side_effect=ValueError('public source unavailable')) as extract:
            self.assertEqual(credits.main(),1)
            self.assertEqual(state['attempted_at']['work-e01'],100000)
            clock.return_value = 103599
            self.assertEqual(credits.main(),0)
            self.assertEqual(extract.call_count,1)
            clock.return_value = 103601
            extract.side_effect = None
            extract.return_value = []
            signature={'kind':'staff','title':'監督','name':'作者','entity_type':'person'}
            with patch.object(credits,'consensus',return_value=[(1,Path('frame.png'),signature)]), \
                 patch.object(credits,'publish_episode'):
                self.assertEqual(credits.main(),0)
            self.assertEqual(extract.call_count,2)
            self.assertEqual(state['next_attempt_at']['work-e01'],103601+86400)
            self.assertEqual(documents['ending_credits']['episodes'][0]['staff'][0]['name'],'作者')

    def test_episode_cues_recover_after_the_recording_is_registered_without_duplicates(self):
        documents={'works':{'works':[{'id':'work','title_ja':'Work'}]},
                   'units':{'series':[{'work_id':'work','released_count':1,'details':{}}]},
                   'source_registry':{'sources':[]},'relations':{'relations':[]}}
        row={'work_id':'work','number':1,'source_url':'https://example.test/story/1',
             'staff_text':'エンディングテーマ「Song」'}
        source.publish_episode_music(row,documents,[])
        self.assertEqual(documents['units']['series'][0]['details']['1']['music_cues'][0]['title'],'Song')
        self.assertEqual(documents['relations']['relations'],[])
        songs=[{'id':'song','title':'Song','versions':[{'id':'version','title':'Song',
                'releases':[{'album_id':'album','album_name':'Work OST'}]}]}]
        source.publish_episode_music(row,documents,songs)
        documents['relations']['relations'][0]['id']='accepted-manual-id'
        source.publish_episode_music(row,documents,songs)
        self.assertEqual(len(documents['relations']['relations']),1)
        self.assertEqual(documents['relations']['relations'][0]['id'],'accepted-manual-id')

    def test_source_identifier_collision_keeps_the_new_actual_url(self):
        documents={'source_registry':{'sources':[]}}
        first=source.source(documents,'source','https://example.test/old','old')
        newer=source.source(documents,'source','https://example.test/new','new')
        self.assertNotEqual(first['id'],newer['id'])
        self.assertEqual(newer['url'],'https://example.test/new')
        self.assertEqual(source.source(documents,'source','https://example.test/new','new')['id'],newer['id'])
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
        self.assertEqual(anime_credit_text.affiliated_person('田山里奈(イマジン)', {'田山里奈'}, {'イマジン'}), ('田山里奈', ['イマジン']))
        self.assertEqual(anime_credit_text.affiliated_person('田山里奈（別名）', {'田山里奈'}, {'イマジン'}), ('田山里奈（別名）', []))
        self.assertEqual(anime_credit_text.affiliated_person('別人(イマジン)', {'田山里奈'}, {'イマジン'}), ('別人(イマジン)', []))
        rows = anime_credit_text.staff_text_rows('協力：阿部憶人\n協力：岐阜県地方競馬組合', ['協力'])
        self.assertEqual([row['name'] for row in rows],['阿部憶人','岐阜県地方競馬組合'])
        self.assertEqual(anime_credit_text.entity_kind(rows[0],rows[0]['name'],{'阿部憶人'},set()),'person')
        self.assertEqual(anime_credit_text.entity_kind(rows[1],rows[1]['name'],set(),set()),'organization')
        self.assertEqual(anime_credit_text.entity_kind({'title':'協力'},'OCT',set(),set()),'unresolved')
        self.assertEqual(anime_credit_text.entity_kind({'title':'制作協力'},'新しい個人',set(),set()),'unresolved')
        self.assertEqual(anime_credit_text.entity_kind({'title':'制作協力','@type':'Person'},'個人',set(),set()),'person')
        self.assertEqual(anime_credit_text.entity_kind({'title':'原作'},'既知の作者',{'既知の作者'},set()),'person')

    def test_refresh_resolves_parenthesized_staff_affiliation_without_duplicate_credit(self):
        previous = {'work_id': 'work', 'unit_id': 'work-e01', 'role': '音楽', 'name': '田山里奈(イマジン)',
                    'auto_source': True, 'entity_type': 'unresolved'}
        documents = {
            'works': {'works': [{'id': 'work'}]},
            'units': {'series': [{'work_id': 'work', 'released_count': 1}]},
            'ending_credits': {'episodes': []}, 'source_registry': {'sources': []},
            'staff': {'credits': [previous, {'name': 'イマジン', 'organization': 'イマジン'}]},
            'people': {'people': [{'id': 'staff-rina', 'name': '田山里奈', 'aliases': []}]},
        }
        row = {'work_id': 'work', 'number': 1, 'title_ja': '第一話', 'source_url': 'https://example.test/1',
               'staff': [{'title': '音楽', 'name': '田山里奈(イマジン)'}, {'title': '音楽', 'name': '田山里奈'}]}
        source.publish_episode(row, documents, {}, {})
        source.publish_episode(row, documents, {}, {})
        self.assertEqual(len(documents['staff']['credits']), 2)
        self.assertEqual(previous['person_id'], 'staff-rina')
        self.assertEqual(previous['name'], '田山里奈')
        self.assertEqual(previous['credited_name'], '田山里奈(イマジン)')
        self.assertEqual(previous['institutions'], ['イマジン'])
        self.assertNotIn('entity_type', previous)

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

    def test_one_network_outage_does_not_probe_every_youtube_link(self):
        document = {'resources': [{'id': str(i), 'platform': 'youtube', 'url': 'https://www.youtube.com/watch?v='+str(i), 'status': 'active'} for i in range(12)]}
        calls = []
        def unavailable(row):
            calls.append(row['id'])
            return 'source_unavailable', 'public video network timeout or connection failure'
        state = {}
        failures = watch.refresh(document, state, check=unavailable, now=100000)
        self.assertLessEqual(len(calls), 3)
        self.assertEqual(len(failures), len(calls), 'provider-deferred links are not reported as newly failed checks')
        self.assertEqual(state['last_run']['deferred'], 12-len(calls))
        self.assertTrue(all(row['status'] == 'active' for row in document['resources']))
        watch.refresh(document,state,check=unavailable,now=103599)
        self.assertEqual(len(calls),len(failures),'the provider is not probed during backoff')

    def test_youtube_public_metadata_does_not_require_downloading_formats(self):
        row={'platform':'youtube','url':'https://www.youtube.com/watch?v=abcdefghijk'}
        payload={'title':'ウマ娘 第1話','author_name':'ウマ娘公式','thumbnail_url':'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'}
        with patch.object(watch.urllib.request,'urlopen',return_value=io.BytesIO(json.dumps(payload).encode())):
            status,evidence=watch.check_resource(row,run=lambda *args,**kwargs:self.fail('public identity should not require player formats'))
        self.assertEqual(status,'active')
        with patch.object(watch.urllib.request,'urlopen',side_effect=AssertionError('search pages must not be treated as videos')):
            status,_=watch.check_resource({'platform':'youtube','url':'https://www.youtube.com/@UMAMUSUME_official/search?query=movie'})
        self.assertEqual(status,'unverified')
        document={'resources':[{'id':'reviewed','url':row['url'],'status':'region_limited',
                               'availability_check':{'checked_at':'1970-01-02T03:46:40+00:00','status':'active'}}]}
        self.assertEqual(watch.refresh(document,{},now=100001,check=lambda row:self.fail('archived check must be reused')),[])
        watch.refresh(document,{},now=200000,check=lambda row:('active','provider oEmbed identifies the exact public video'))
        self.assertEqual(document['resources'][0]['status'],'region_limited','metadata access does not remove a known region restriction')

    def test_failed_channel_page_preserves_rows_already_received(self):
        result = subprocess.CompletedProcess([], 1, '{"id":"video1","title":"public program"}\n', 'API page timed out')
        with patch.object(program_discovery.pipeline_common.subprocess, 'run', return_value=result):
            rows = program_discovery.discover_channel_feed('videos', 12)
        self.assertEqual(rows[0]['id'], 'video1')
        self.assertIn('network', rows.errors[0])

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
            self.assertEqual([row[0] for row in rows],[150,150.5])
        self.assertIn('fps=2,scale=-2:720', calls[1])
        self.assertIn('-ss',calls[1])
        self.assertIn('-t',calls[1])
        self.assertEqual(list(Path(directory).glob('*')),[])


if __name__=='__main__':
    unittest.main()
