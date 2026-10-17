"""Exercise source precedence, full ensembles and retained event links."""
import copy
import unittest

from events_pipeline.events import dedupe_events
from events_pipeline.setlists import apply_sheet, merge_numbered_sources


class Identities:
    profile_by_id = {'va-a': {'identity': {'zh': '声优甲', 'ja': 'Actor A'}},
                     'va-b': {'identity': {'zh': '声优乙', 'ja': 'Actor B'}}}
    character_by_id = {'char-a': {'zh': '角色甲'}}

    def voice_id(self, name):
        return {'Actor A': 'va-a', 'Actor B': 'va-b'}.get(name, '')


class GoogleSetlistTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
