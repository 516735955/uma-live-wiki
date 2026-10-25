"""Exercise source precedence, full ensembles and retained event links."""
import copy
import unittest

from events_pipeline.events import dedupe_events
from events_pipeline.setlists import apply_sheet, merge_numbered_sources, display_table, curated_performances


class Identities:
    profile_by_id = {'va-a': {'identity': {'zh': '声优甲', 'ja': 'Actor A'}},
                     'va-b': {'identity': {'zh': '声优乙', 'ja': 'Actor B'}}}
    character_by_id = {'char-a': {'zh': '角色甲'}}

    def voice_id(self, name):
        return {'Actor A': 'va-a', 'Actor B': 'va-b'}.get(name, '')

    def character_id(self, name):
        return {'角色甲': 'char-a'}.get(name, '')


class GoogleSetlistTests(unittest.TestCase):
    def test_song_sheet_preserves_non_singing_session_guest(self):
        guest = {'voice_actor_id': 'va-a', 'character_id': 'char-a', 'name': '声优甲',
                 'role': '角色甲', 'evidence': 'official_announcement'}
        event = {'id': 'canonical', 'title': 'ウマ娘2nd EVENT', 'date': '2026-10-17',
                 'series_id': 'numbered-live', 'sources': [],
                 'sessions': [{'id': 's', 'label': 'DAY1', 'date': '2026-10-17',
                               'cast': [guest], 'character_ids': ['char-a']}]}
        block = {'title': 'ウマ娘2nd EVENT', 'date': '2026-10-17',
                 'songs': [{'no': '1', 'name': 'Song', 'performers': ['Actor B']}]}
        apply_sheet([event], [block], Identities())
        self.assertEqual({c['voice_actor_id'] for c in event['sessions'][0]['cast']}, {'va-a', 'va-b'})
        self.assertEqual(event['sessions'][0]['performances'][0]['voice_actor_ids'], ['va-b'])

    def test_merge_keeps_official_time_alongside_curated_songs(self):
        base = {'id': 'e', 'title': 'Event', 'date': '2026-10-17', 'sources': [], 'cast': [], 'character_ids': []}
        song = {**base, 'kind': 'concert', 'sessions': [{'id': 's1', 'date': '2026-10-17', 'label': 'DAY1', 'songs': ['Song']}]}
        official = {**base, 'kind': 'official_program', 'sessions': [{'id': 's2', 'date': '2026-10-17', 'label': 'DAY1',
                     'broadcast_time': '20:00', 'time_source_url': 'https://example.test/schedule'}]}
        merged = dedupe_events([song, official])[0]['sessions'][0]
        self.assertEqual(merged['songs'], ['Song'])
        self.assertEqual(merged['broadcast_time'], '20:00')
        self.assertEqual(merged['time_source_url'], 'https://example.test/schedule')

    def test_curated_table_keeps_roles_sources_notes_and_sections(self):
        table = ('<table><thead><tr><th>歌曲信息</th></tr></thead><tbody>'
                 '<tr><td class="setlist-no">1</td><td class="setlist-song">Finale</td>'
                 '<td class="setlist-perf">全员（2人）</td><td class="setlist-src">原出处（注释）</td></tr>'
                 '<tr><td colspan="4">安可</td></tr>'
                 '<tr><td class="setlist-no">2</td><td class="setlist-song">Solo ※备注</td>'
                 '<td class="setlist-perf"><span class="perf-name">队名：</span><span class="perf-item">'
                 '<img src="a.png" alt="角色甲"><span class="perf-name">角色甲</span></span></td>'
                 '<td class="setlist-src">另一出处</td></tr></tbody></table>')
        cast = [{'voice_actor_id': 'va-a', 'character_id': 'char-a'}]
        block = {'songs': [{'name': 'Finale', 'performers': ['Actor A', 'Actor B']}]}
        rendered = display_table(table, block, cast, Identities())
        self.assertIn('原出处（注释）', rendered)
        self.assertIn('队名：', rendered)
        self.assertIn('Solo ※备注', rendered)
        self.assertIn('<td colspan="4">安可</td>', rendered)
        self.assertEqual(rendered[rendered.index('<tr><td class="setlist-no">2'):], table[table.index('<tr><td class="setlist-no">2'):])
        self.assertIn('>角色甲</span>', rendered)
        self.assertIn('>Actor B</span>', rendered, 'an unconfirmed role stays a named person')
        credits = curated_performances(table, [{'song': 'Finale', 'setlist_no': '1', 'voice_actor_ids': ['va-a', 'va-b'], 'character_ids': ['char-a']}], Identities(), cast)
        self.assertEqual([row['song'] for row in credits], ['Finale', 'Solo ※备注'])
        self.assertEqual(credits[0]['voice_actor_ids'], ['va-a', 'va-b'])

    def test_primary_sheet_replaces_legacy_credits_and_expands_the_whole_event_cast(self):
        session = {'id': 'canonical-session-1', 'label': 'DAY1', 'date': '2026-10-17',
                   'performances': [{'song': 'Old'}], 'songs': ['Old'], 'setlist_html': '<table>Old</table>',
                   'setlist_source': {'file': 'legacy.json'},
                   'cast': [{'voice_actor_id': 'va-a', 'character_id': 'char-a'}]}
        event = {'id': 'canonical', 'title': 'ウマ娘2nd EVENT', 'date': '2026-10-17',
                 'series_id': 'numbered-live', 'sessions': [session], 'sources': [{'kind': 'eventernote', 'url': 'source'}]}
        block = {'title': 'ウマ娘 2nd EVENT@Hall', 'date': '2026-10-17', 'songs': [
            {'no': '1', 'name': 'New', 'performers': ['Actor A']},
            {'no': '2', 'name': 'Finale', 'performers': ['全員']}]}
        raw = {'events': [{'date': '2026-10-17', 'link': 'source', 'actors': [
            {'name': 'Actor A'}, {'name': 'Actor B'}, {'name': 'External Guest'}]}]}
        apply_sheet([event], [block], Identities(), raw)
        self.assertEqual(session['songs'], ['New', 'Finale'])
        finale = session['performances'][-1]
        self.assertEqual(set(finale['voice_actor_ids']), {'va-a', 'va-b'})
        self.assertEqual(finale['guest_performers'], ['External Guest'])
        self.assertEqual(finale['character_ids'], ['char-a'], 'a person credit does not invent a character role')
        self.assertNotIn('>全員<', session['setlist_html'])
        self.assertIn({'file': 'legacy.json'}, session['alternate_setlist_sources'])

    def test_numbered_day_imports_share_one_event_and_keep_old_session_links(self):
        session = {'id': 'main-session-1', 'label': 'DAY1', 'date': '2026-10-17'}
        primary = {'id': 'main', 'title': 'ウマ娘 2nd EVENT『Sound Fanfare!』', 'date': '2026-10-17',
                   'series_id': 'numbered-live', 'kind': 'concert', 'sessions': [session], 'sources': []}
        duplicate = {'id': 'imported', 'title': 'ウマ娘プリティーダービー2nd EVENT「Sound Fanfare！」',
                     'date': '2026-10-17', 'kind': 'onsite', 'sessions': [{**session, 'id': 'imported-session-1', 'label': '本公演'}],
                     'sources': [{'kind': 'curated_live', 'url': '/legacy'}]}
        result = dedupe_events(merge_numbered_sources([primary, duplicate]))
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 'main')
        self.assertIn('imported', result[0]['id_aliases'])
        self.assertIn('imported-session-1', result[0]['sessions'][0]['id_aliases'])
        another_day = copy.deepcopy(duplicate)
        another_day['id'], another_day['date'] = 'different-day', '2026-10-18'
        self.assertEqual(len(dedupe_events(merge_numbered_sources([copy.deepcopy(primary), another_day]))), 2)

    def test_exact_eventernote_identity_merges_importer_copy_and_keeps_alias(self):
        source = 'https://www.eventernote.com/events/424802/'
        primary = {
            'id': 'live-cd-2025-07-26-1-1', 'title': '发售活动【1部】', 'date': '2025-07-26',
            'kind': 'concert', 'sources': [{'kind': 'eventernote', 'url': source}],
            'sessions': [{'id': 'primary-session', 'label': '第1部', 'date': '2025-07-26', 'songs': [], 'character_ids': [], 'cast': [], 'performances': []}],
        }
        imported = {
            'id': 'live-other-source-3ecbf19d7cc8', 'title': '发售活动【第1部】', 'date': '2025-07-26',
            'kind': 'onsite', 'sources': [{'kind': 'eventernote', 'url': 'https://www.eventernote.com/events/424802'}],
            'sessions': [{'id': 'imported-session', 'label': '场次1', 'date': '2025-07-26', 'songs': [], 'character_ids': [], 'cast': [], 'performances': []}],
        }
        result = dedupe_events([primary, imported])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['id'], 'live-cd-2025-07-26-1-1')
        self.assertIn('live-other-source-3ecbf19d7cc8', result[0]['id_aliases'])
        self.assertGreaterEqual(len(result[0]['sessions']), 1)

        another_day = copy.deepcopy(imported)
        another_day['id'] = 'different-day'
        another_day['date'] = '2025-07-27'
        another_day['sessions'][0]['date'] = '2025-07-27'
        self.assertEqual(len(dedupe_events([copy.deepcopy(primary), another_day])), 2)


if __name__ == '__main__':
    unittest.main()
