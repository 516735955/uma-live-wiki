"""Exercise incremental publication, source failures and restart scheduling."""

import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import knowledge_io
import sync_anime_sources as anime
import sync_character_sources as characters
import sync_knowledge as runner
import sync_pedigree_sources as pedigree


class KnowledgeTests(unittest.TestCase):
    def test_official_order_is_dom_order_and_local_entries_stay_stable(self):
        values = [{'id': 1, 'name': 2, 'category': 3, 'cv': 4}, 'azuma', '吾妻', [5], 'CV', 'トレセン学園関係者',
                  {'id': 7, 'name': 8, 'category': 9, 'cv': 4}, 'winmarilyn', 'ウインマリリン', [10], 'ウマ娘']
        markup = '<a href="/character/winmarilyn"></a><a href="/character/azuma"></a><script id="__NUXT_DATA__">' + json.dumps(values) + '</script>'
        categories = characters.official_character_ids(markup)
        rows = [{'id': cid} for cid in ['local-a', 'azuma', 'local-b', 'winmarilyn']]
        self.assertEqual([row['id'] for row in characters.order_characters(rows, categories)], ['winmarilyn','azuma','local-a','local-b'])
        self.assertEqual(categories['azuma'], 'human')

    def test_official_assets_use_list_and_bust_not_full_body_or_social_image(self):
        values = [{'id':1,'list_thumb':2,'top_thumb':3},'new',{'url':4},{'url':5},'https://example.test/list.png','https://example.test/top.png','https://example.test/new_01.png','https://example.test/new_icon.png']
        markup = '<script id="__NUXT_DATA__">' + json.dumps(values) + '</script>'
        self.assertEqual(characters.official_card_assets(markup, 'new'), ('https://example.test/list.png','https://example.test/top.png'))

    def test_automatic_pedigree_requires_localized_names_and_sourced_unknowns(self):
        source = {'nodes':[{'id':'new','zh':'Running Heroine','ja':'ランニングヒロイン','sex':'female','born':1993}], 'character_mappings':{'new':{'horse':'new'}}}
        missing = pedigree.incomplete_visualization(source,'new')
        self.assertIn('new:Chinese name', missing)
        self.assertIn('new:country', missing)
        self.assertIn('new:en', missing)

    def test_automatic_translation_has_one_owner_for_each_data_domain(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(runner, 'ROOT', Path(folder)), patch.object(runner, 'STATE', Path(folder) / 'state.json'), patch.object(runner, 'STEPS', [('event-localization', ['localize_events.js']), ('entity-localization', ['localize_entities.js'])]):
            for github in ('true', 'false'):
                calls = []
                def execute(command, **kwargs):
                    calls.append(command)
                    return subprocess.CompletedProcess(command, 0, 'saved', '')
                with patch.dict(os.environ, {'GITHUB_ACTIONS': github}):
                    runner.run_updates(force=True, run=execute)
                self.assertEqual('--no-api' in calls[0], github != 'true')
                self.assertEqual('--no-api' in calls[1], github == 'true')
    def test_dependencies_rebuild_only_after_an_input_changes_even_on_partial_failure(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(runner, 'ROOT', Path(folder)), patch.object(runner, 'STATE', Path(folder) / 'state.json'), patch.object(runner, 'STEPS', [('events', ['a.py']), ('catalogs', ['b.py'])]):
            data = Path(folder) / 'data'; data.mkdir()
            runner.STATE.write_text(json.dumps({'steps': {'catalogs': {'next_at': 99999}}}))
            calls = []
            publish = False
            def execute(command, **kwargs):
                name = Path(command[1]).name; calls.append(name)
                if name == 'a.py' and publish:
                    (data / 'events_data.json').write_text('{"events":[{"id":"new"}]}')
                return subprocess.CompletedProcess(command, 1 if name == 'a.py' else 0, 'partial source', 'offline')
            runner.run_updates(run=execute, clock=lambda:100)
            self.assertEqual(calls, ['a.py'])
            publish = True; calls.clear()
            runner.run_updates(run=execute, clock=lambda:4000)
            self.assertEqual(calls, ['a.py', 'b.py'])

    def test_curated_pedigree_missing_parent_is_filled_without_changing_known_facts(self):
        source = {'nodes': [{'id': 'known', 'ja': '新馬', 'zh': '人工名称', 'parents': {'dam': 'old-dam'}}, {'id': 'father', 'ja': '父馬'}], 'character_mappings': {}, 'horse_pages': []}
        facts = {'ja': '新馬', 'zh': '自动名称', 'sire_name': '父馬', 'source_url': 'https://example.test/source'}
        pedigree.add_horse(source, {'id': 'new', 'ja': '新馬', 'zh': '新马'}, lookup=lambda name: facts if name == '新馬' else None)
        self.assertEqual(source['nodes'][0]['parents']['sire'], 'father')
        self.assertEqual(source['nodes'][0]['parents']['dam'], 'old-dam')
        self.assertEqual(source['nodes'][0]['zh'], '人工名称')

    def test_daily_state_survives_restart_and_failed_sources_retry(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(runner, 'STATE', Path(folder) / 'state.json'), patch.object(runner, 'STEPS', [('failed', ['a.py']), ('healthy', ['b.py'])]):
            calls = []
            def execute(command, **kwargs):
                calls.append(Path(command[1]).name)
                return subprocess.CompletedProcess(command, 1 if command[1].endswith('a.py') else 0, 'published', 'upstream unavailable')
            self.assertEqual(runner.run_updates(run=execute, clock=lambda: 100), 1)
            self.assertEqual(calls, ['a.py', 'b.py'])
            calls.clear()
            runner.run_updates(run=execute, clock=lambda: 200)
            self.assertEqual(calls, [])
            runner.run_updates(run=execute, clock=lambda: 3800)
            self.assertEqual(calls, ['a.py'])
            state = json.loads(runner.STATE.read_text())
            self.assertEqual(state['steps']['healthy']['last_success_at'], 100)
            self.assertEqual(state['steps']['failed']['status'], 'failed')

    def test_historical_js_and_noop_preserves_original_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'detail.js'
            original = "window.CHAR_DETAIL = {'existing': {\"html\": \"checked\"}};\n"
            path.write_text(original)
            data = knowledge_io.read_window(path)
            knowledge_io.write_window(path, 'CHAR_DETAIL', data)
            self.assertEqual(path.read_text(), original)

    def test_official_character_does_not_require_paid_translation_or_moegirl(self):
        markup = '<div class="character-detail__text"><div class="name">新キャラ</div><div class="en">New Horse</div><div class="cv"><p>CV：新声優</p></div><dl class="profile"><dt>誕生日</dt><dd>4月13日</dd><dt>身長</dt><dd>158cm</dd></dl><div class="detail-text">公式紹介&lt;script&gt;</div></div>'
        row, detail, _, _ = characters.parse_character(markup, 'newhorse')
        self.assertEqual(row['cv'], '新声優')
        self.assertEqual(row['birth'], '4月13日')
        self.assertEqual(row['height'], '158')
        self.assertEqual(detail['language'], 'ja')
        self.assertIn('uma-description', detail['html'])
        self.assertNotIn('<script>', detail['html'])

    def test_official_school_members_are_classified_as_non_uma(self):
        values = [{'id': 1, 'name': 2, 'category': 3, 'cv': 4}, 'new-uma', '新马娘', [5], '声优', 'ウマ娘',
                  {'id': 7, 'name': 8, 'category': 9, 'cv': 4}, 'commentator', '解说员', [10], 'トレセン学園関係者']
        markup = '<script id="__NUXT_DATA__" type="application/json">' + json.dumps(values) + '</script>'
        self.assertEqual(characters.official_character_ids(markup), {'new-uma': 'uma', 'commentator': 'human'})

    def test_prototype_reuses_existing_parent_and_does_not_guess_missing_dam(self):
        source = {'nodes': [{'id': 'father', 'ja': '父馬'}], 'character_mappings': {}, 'horse_pages': []}
        facts = {'ja': '新馬', 'born': 2020, 'sex': 'male', 'metadata_source_url': 'https://example.test/horse', 'source_url': 'https://example.test/horse', 'sire_name': '父馬', 'dam_name': '未掲載母馬'}
        horse = pedigree.add_horse(source, {'id': 'new', 'ja': '新馬', 'zh': '新马', 'page': 'https://example.test/character'}, lookup=lambda name: facts if name == '新馬' else None)
        self.assertEqual(horse, 'new')
        self.assertEqual(source['nodes'][1]['parents']['sire'], 'father')
        self.assertNotIn('dam', source['nodes'][1]['parents'])
        self.assertEqual(len(source['nodes']), 2)
        self.assertEqual(source['character_mappings']['new']['kind'], 'horse')

    def test_unknown_prototype_is_not_marked_original_or_assigned_a_horse(self):
        source = {'nodes': [], 'character_mappings': {}, 'horse_pages': []}
        pedigree.add_horse(source, {'id': 'new', 'ja': '未確認', 'zh': '新角色', 'page': 'https://example.test/character'}, lookup=lambda name: None)
        self.assertEqual(source['character_mappings']['new']['kind'], 'unknown')
        self.assertEqual(source['horse_pages'], [])
        self.assertNotIn('parents', source['nodes'][0])

    def documents(self):
        return {'works': {'works': [{'id': 'work', 'title_ja': '新しいアニメ作品', 'aliases': []}]},
                'units': {'series': [{'work_id': 'work', 'released_count': 1, 'count': 12, 'details': {'1': {'title_ja': 'checked title', 'summary_zh': '人工简介'}}}]},
                'relations': {'relations': []}, 'staff': {'credits': [{'work_id': 'work', 'unit_id': 'work-e01', 'role': '協力', 'name': '独立机构', 'organization': '独立机构'}]},
                'people': {'people': []}, 'source_registry': {'sources': []}, 'watch_resources': {'resources': []},
                'asset_sources': {'assets': []}, 'ending_credits': {'episodes': []}}

    def test_episode_publication_is_idempotent_and_keeps_curated_fields(self):
        documents = self.documents()
        observation = {'work_id': 'work', 'number': 1, 'title_ja': 'new source title', 'summary_ja': '公式紹介', 'source_url': 'https://example.test/episode',
                       'staff': [{'title': '協力', 'name': '独立机构'}, {'title': '監督', 'name': '新監督'}]}
        anime.publish_episode(observation, documents, {}, {}, save_image=lambda asset: None)
        first = copy.deepcopy(documents)
        anime.publish_episode(observation, documents, {}, {}, save_image=lambda asset: None)
        self.assertEqual(first, documents)
        detail = documents['units']['series'][0]['details']['1']
        self.assertEqual(detail['title_ja'], 'checked title')
        self.assertEqual(detail['summary_zh'], '人工简介')
        self.assertEqual(len(documents['staff']['credits']), 2)
        self.assertNotIn('institutions', documents['staff']['credits'][1])

    def test_episode_gap_is_not_published_as_a_complete_sequence(self):
        documents = self.documents()
        anime.publish_episode({'work_id': 'work', 'number': 4, 'title_ja': '第四话', 'source_url': 'https://example.test/4'}, documents, {}, {})
        self.assertEqual(documents['units']['series'][0]['published_numbers'], [1, 4])
        from build_anime_catalog import expand_units
        units = expand_units(documents['units']['series'], {'work': documents['works']['works'][0]})
        self.assertEqual([unit['number'] for unit in units], [1, 4])
        anime.publish_episode({'work_id':'work','number':2,'title_ja':'第二话','source_url':'https://example.test/2'},documents,{}, {})
        self.assertEqual(documents['units']['series'][0]['published_numbers'], [1, 2, 4])

    def test_later_official_images_keep_existing_image_identity(self):
        documents = self.documents()
        output = 'uma_tools/img/anime/stills/work-e01-auto-01.webp'
        documents['units']['series'][0]['details']['1']['stills'] = [{'url': '/' + output, 'original': 'https://example.test/old.jpg'}]
        documents['asset_sources']['assets'] = [{'output': output, 'source_url': 'https://example.test/old.jpg'}]
        saved = []
        anime.publish_episode({'work_id': 'work', 'number': 1, 'title_ja': '第一话', 'source_url': 'https://example.test/1',
            'stills': ['https://example.test/new.jpg', 'https://example.test/old.jpg']}, documents, {}, {}, save_image=saved.append)
        self.assertEqual(len(saved), 1)
        self.assertNotEqual(saved[0]['output'], output)
        self.assertEqual(documents['units']['series'][0]['details']['1']['stills'][0]['original'], 'https://example.test/old.jpg')

    def test_structured_episode_does_not_create_cast_from_a_name_mention(self):
        markup = '<script type="application/ld+json">' + json.dumps({'@type': 'TVEpisode', 'name': '第二话', 'episodeNumber': 2, 'description': '剧情提到某人', 'actor': {'name': '演员', 'characterName': '角色'}}) + '</script>'
        rows = anime.structured_episodes(markup, 'work', 'https://example.test/2')
        self.assertEqual(rows[0]['cast'], [{'title': '角色', 'name': '演员'}])
        self.assertNotIn('剧情提到某人', str(rows[0]['cast']))

    def test_animation_event_matching_keeps_seasons_separate(self):
        documents = self.documents()
        documents['works']['works'] = [{'id': 's1', 'title_ja': 'ウマ娘 プリティーダービー'}, {'id': 's2', 'title_ja': 'ウマ娘 プリティーダービー Season 2'}]
        event = {'id': 'premiere', 'title': 'ウマ娘 プリティーダービー Season 2 先行上映', 'sources': [{'url': 'https://example.test/event'}]}
        anime.relate_public_entities(documents, [event], [])
        self.assertEqual(documents['relations']['relations'][0]['source_id'], 's2')
        anime.relate_public_entities(documents, [event], [])
        self.assertEqual(len(documents['relations']['relations']), 1)

    def test_live_bluray_screening_is_not_a_first_season_anime_event(self):
        documents = self.documents()
        documents['works']['works'] = [{'id': 'anime-s1', 'title_ja': 'ウマ娘 プリティーダービー'}]
        event = {'id': 'live-screening', 'title': 'ウマ娘 プリティーダービー 6th EVENT Blu-ray 発売記念上映イベント', 'sources': [{'url': 'https://example.test/live'}]}
        anime.relate_public_entities(documents, [event], [])
        self.assertEqual(documents['relations']['relations'], [])


if __name__ == '__main__':
    unittest.main()
