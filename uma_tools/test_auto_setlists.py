"""Focused checks for the sheet job's non-destructive publication boundary."""

import copy
import unittest

from auto_setlists import compare, fill_from_published_catalog, song_table, attach_discovered_sessions, parse_sheet


CAST = '<div class="cast-line">Machico（东海帝王）、大橋彩香（伏特加）</div>'


def catalog(table="", duplicate=False):
    sub = {
        "title": "Example LIVE", "date": "2026-09-13 Hall", "cast": CAST,
        "days": [{"label": "本公演", "table": table}],
    }
    subs = [sub, copy.deepcopy(sub)] if duplicate else [sub]
    return {"other": {"groups": [{"group": "Example LIVE", "subs": subs}]}}


def sheet(songs=None):
    return [{
        "title": "Example LIVE@Hall(東京)", "date": "2026-09-13",
        "songs": songs or [{"no": "1", "name": "First song", "performers": ["Machico", "Guest"]}],
    }]


class SheetPublicationTests(unittest.TestCase):
    def test_published_generic_session_uses_the_part_already_in_its_title(self):
        for title in ('CygamesFes2018 SPECIAL LIVE DAY1', 'ぱかラジッ！公開録音 2部',
                      'シンデレラグレイ リリースイベント【1部】'):
            with self.subTest(title=title):
                block = {'title': title + '@Hall', 'date': '2026-10-14',
                         'songs': [{'name': 'Song ※備考', 'no': '1', 'performers': ['Machico']}]}
                event = {'title': title, 'date': block['date'],
                         'link': 'https://www.eventernote.com/events/123', 'actors': [{'name': 'Machico'}]}
                published = [{'id': 'existing', 'title': title, 'date': block['date'],
                              'sessions': [{'label': '本公演', 'date': block['date']}]}]
                source = catalog('<table><!--注释--><tr><td>东海帝王 ※备注</td></tr></table>')
                before = copy.deepcopy(source)
                self.assertEqual(attach_discovered_sessions([block], source, [event], published), [])
                self.assertEqual(source, before, 'existing roles, notes and comments remain byte-for-byte intact')

    def test_explicit_session_label_does_not_hide_another_part_on_the_same_date(self):
        block = {'title': 'Example 2部', 'date': '2026-10-14',
                 'songs': [{'name': 'Song', 'no': '1', 'performers': ['Machico']}]}
        event = {'title': block['title'], 'date': block['date'],
                 'link': 'https://www.eventernote.com/events/124', 'actors': [{'name': 'Machico'}]}
        published = [{'id': 'first', 'title': block['title'], 'date': block['date'],
                      'sessions': [{'label': '1部', 'date': block['date']}]}]
        self.assertEqual(len(attach_discovered_sessions([block], {}, [event], published)), 1)

    def test_existing_canonical_event_is_not_registered_again_in_another_category(self):
        block = {'title': 'Uma 1st EVENT@Hall', 'date': '2026-10-14', 'songs': [{'name': 'Song', 'no': '1', 'performers': ['Machico']}]}
        event = {'title': block['title'], 'date': block['date'], 'link': 'https://www.eventernote.com/events/123', 'actors': [{'name': 'Machico'}]}
        source = {}
        published = [{'id': 'live-numbered-1st', 'title': 'Uma 1st EVENT', 'date': block['date']}]
        self.assertEqual(attach_discovered_sessions([block], source, [event], published), [])
        self.assertEqual(source['other']['groups'], [])
        block['title'] = 'Uma 1st EVENT！@Hall'
        event['title'] = block['title']
        published[0]['title'] = 'Uma 1st EVENT!'
        self.assertEqual(attach_discovered_sessions([block], source, [event], published), [])

    def test_identity_equal_catalog_event_is_not_registered_again(self):
        block = {'title': 'アニメウマ娘シンデレラグレイ第1クールエンディング主題歌発売記念リリースイベント2部',
                 'date': '2025-07-26',
                 'songs': [{'name': 'Song', 'no': '1', 'performers': ['Machico']}]}
        event = {'title': block['title'], 'date': block['date'],
                 'link': 'https://www.eventernote.com/events/123', 'actors': [{'name': 'Machico'}]}
        published = [{'id': 'live-cd-2025-07-26-1-2',
                      'title': 'アニメ『ウマ娘 シンデレラグレイ』第1クールエンディング主題歌 : 「∞」発売記念リリースイベント【2部】',
                      'date': '2025-07-26', 'sessions': [{'label': '本公演', 'date': '2025-07-26'}]}]
        source = {}
        self.assertEqual(attach_discovered_sessions([block], source, [event], published), [])
        self.assertEqual(source.get('other', {}).get('groups', []), [])
        block = {'title': 'cygamesfes20182日目ウマ娘プリティーダービーspecialliveday2',
                 'date': '2018-12-16',
                 'songs': [{'name': 'Song', 'no': '1', 'performers': ['Machico']}]}
        event = {'title': block['title'], 'date': block['date'],
                 'link': 'https://www.eventernote.com/events/456', 'actors': [{'name': 'Machico'}]}
        published = [{'id': 'live-other-2018-12-16-cygamesfes2018-2-special-live-day2',
                      'title': 'CygamesFes2018 2日目 ウマ娘プリティーダービーSPECIAL LIVE DAY2',
                      'date': '2018-12-16'}]
        self.assertEqual(attach_discovered_sessions([block], source, [event], published), [])
        self.assertEqual(source.get('other', {}).get('groups', []), [])

    def test_new_sourced_session_is_registered_once_without_guessing_roles(self):
        block = {'title': 'New Uma LIVE', 'date': '2026-10-14', 'songs': [{'name': 'Song', 'no': '1', 'performers': ['Machico']}]}
        event = {'title': block['title'], 'date': block['date'], 'link': 'https://www.eventernote.com/events/123', 'actors': [{'name': 'Machico'}]}
        source = {}
        self.assertEqual(len(attach_discovered_sessions([block], source, [event])), 1)
        self.assertEqual(attach_discovered_sessions([block], source, [event]), [])
        table = source['other']['groups'][0]['subs'][0]['days'][0]['table']
        self.assertIn('guest-performer', table)
        self.assertNotIn('东海帝王', table)
        self.assertEqual(attach_discovered_sessions([block], {}, [event, dict(event)]), [])

    def test_all_data_tabs_are_parsed(self):
        import io
        try:
            import openpyxl
        except ImportError:
            self.skipTest('openpyxl is a declared deployment dependency')
        workbook = openpyxl.Workbook()
        workbook.active.append(['README'])
        for name in ['Later', 'Earlier']:
            sheet = workbook.create_sheet(name)
            sheet.append(['2026-10-14', name, None, None])
            sheet.append([None, None, 'M1 Song', 'Machico'])
        stream = io.BytesIO(); workbook.save(stream); workbook.close()
        self.assertEqual([block['title'] for block in parse_sheet(stream.getvalue())], ['Later', 'Earlier'])

    def test_github_fallback_only_fills_matching_empty_tables(self):
        table = song_table(sheet()[0], CAST)
        source = catalog()
        result = fill_from_published_catalog(catalog(table), source)
        self.assertEqual(len(result['filled']), 1)
        self.assertEqual(source['other']['groups'][0]['subs'][0]['days'][0]['table'], table)
        existing = catalog('<table>human revision</table>')
        self.assertEqual(fill_from_published_catalog(catalog(table), existing)['filled'], [])
        self.assertEqual(existing['other']['groups'][0]['subs'][0]['days'][0]['table'], '<table>human revision</table>')

    def test_github_fallback_requires_unique_identity_and_identical_cast(self):
        table = song_table(sheet()[0], CAST)
        self.assertEqual(fill_from_published_catalog(catalog(table, duplicate=True), catalog())['filled'], [])
        published = catalog(table)
        published['other']['groups'][0]['subs'][0]['cast'] = 'other cast'
        self.assertEqual(fill_from_published_catalog(published, catalog())['filled'], [])

    def test_only_unique_blank_setlist_is_filled(self):
        source = catalog()
        report = compare(sheet(), source)
        table = source["other"]["groups"][0]["subs"][0]["days"][0]["table"]
        self.assertEqual(len(report["filled"]), 1)
        self.assertIn('class="perf-name">东海帝王</span>', table)
        self.assertIn('class="guest-performer">Guest</span>', table)
        self.assertNotIn('class="perf-name">Guest</span>', table)
        self.assertEqual(compare(sheet(), source)["unchanged"], 1)

    def test_day_spacing_in_title_matches_explicit_day_label(self):
        source = {"other": {"groups": [{"group": "Show", "subs": [{
            "title": "Show", "date": "2026-01-01", "cast": CAST,
            "days": [{"label": "DAY1", "table": ""}],
        }]}]}}
        blocks = [{"title": "Show DAY 1", "date": "2026-01-01",
                   "songs": [{"no": "1", "name": "First song", "performers": ["Machico"]}]}]
        report = compare(blocks, source)
        self.assertEqual(len(report["filled"]), 1)
        self.assertEqual(report["review"], [])

    def test_nonempty_setlist_is_never_replaced(self):
        source = catalog("<table>hand-curated</table>")
        report = compare(sheet(), source)
        self.assertEqual(source["other"]["groups"][0]["subs"][0]["days"][0]["table"], "<table>hand-curated</table>")
        self.assertEqual(report["review"][0]["reason"], "nonempty_setlist_differs")

    def test_ambiguous_match_is_not_published(self):
        source = catalog(duplicate=True)
        report = compare(sheet(), source)
        self.assertEqual(report["filled"], [])
        self.assertEqual(report["review"][0]["matches"], 2)

    def test_incomplete_sheet_credit_is_not_published(self):
        source = catalog()
        report = compare(sheet([{"no": "1", "name": "First song", "performers": []}]), source)
        self.assertEqual(report["filled"], [])
        self.assertEqual(report["review"][0]["reason"], "missing_song_performers")


if __name__ == "__main__":
    unittest.main()
