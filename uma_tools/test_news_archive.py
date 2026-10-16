"""Exercise persisted versions, independent readers, leases and online backups."""
import tempfile
from pathlib import Path
import unittest
from news_database import NewsDatabase


class NewsArchiveTest(unittest.TestCase):
    def test_versions_and_restarts(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'news.sqlite'
            first = NewsDatabase(file)
            source = {'detail': {'announce_id': 1, 'title': 'ニュース', 'message': '<p>10月17日</p>'}}
            article = first.put('official-1', source, 'assistant')
            detail = dict(article['detail'], title_zh='新闻', message_zh='<p>10月17日</p>')
            first.translate('official-1', 1, detail, 'assistant')
            second = NewsDatabase(file)
            self.assertEqual(second.get('official-1')['detail']['message_zh'], '<p>10月17日</p>')
            self.assertEqual(second.put('official-1', source)['detail']['archive_revision'], 1)
            self.assertEqual(second.jobs('assistant'), [])
            layout = {'detail': dict(source['detail'], message='<section><p>10月17日</p><img src="new.webp"></section>')}
            reused = second.put('official-1', layout)
            self.assertEqual(reused['detail']['archive_revision'], 2)
            self.assertEqual(reused['detail']['translation_state'], 'complete')
            self.assertEqual(reused['detail']['message_zh'], '<section><p>10月17日</p><img src="new.webp"></section>')
            updated = {'detail': dict(source['detail'], message='<p>10月18日</p>')}
            self.assertEqual(second.put('official-1', updated)['detail']['archive_revision'], 3)
            self.assertFalse(second.get('official-1')['detail'].get('message_zh'))
            self.assertEqual(second.get('official-1')['detail']['archive_fragments']['10月17日'], '10月17日')
            with self.assertRaises(ValueError):
                second.translate('official-1', 3, detail, 'assistant')
            self.assertEqual(len(first.jobs('baidu', claim=True)), 1)
            self.assertEqual(second.jobs('baidu', claim=True), [])
            backup = Path(directory) / 'backup.sqlite'
            first.dispatch('backup', {'path': str(backup)})
            restored = NewsDatabase(backup)
            self.assertEqual(restored.get('official-1')['detail']['archive_revision'], 3)
            restored.db.close()
            first.db.close()
            second.db.close()


if __name__ == '__main__':
    unittest.main()
