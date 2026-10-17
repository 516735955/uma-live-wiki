"""Plain-text archive extraction and replayable migration checks."""
import json
import tempfile
import unittest
from pathlib import Path

from news_database import NewsDatabase, plain_text


class ArchiveTextTests(unittest.TestCase):
    def test_human_inline_translation_survives_source_serialization_and_old_pending_repair(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / 'news.sqlite'
            archive = NewsDatabase(file)
            article = {'detail': {'title': 'ニュース', 'message': '<p>赛<b>马娘</b>新闻</p>'}}
            archive.put('test', article, owner='assistant')
            archive.translate('test', 1, {**article['detail'], 'title_zh': '新闻', 'message_zh': '<p>完整人工译文</p>'}, 'assistant')
            update = {'detail': {**article['detail'], 'message': '<p class="new">赛<b>马娘</b>新闻</p>'}}
            result = archive.put('test', update)
            self.assertEqual(result['detail']['translation_state'], 'complete')
            self.assertEqual(result['detail']['message_zh'], '<p>完整人工译文</p>')
            self.assertEqual(result['detail']['translation_owner'], 'assistant')
            with archive.db:
                archive.db.execute("UPDATE versions SET state='pending',translated=NULL WHERE revision=2")
                archive.db.execute("UPDATE articles SET owner='baidu'")
                archive.db.execute('PRAGMA user_version=1')
            archive.db.close()
            archive = NewsDatabase(file)
            self.assertEqual(archive.get('test')['detail']['message_zh'], '<p>完整人工译文</p>')
            self.assertEqual(archive.get('test')['detail']['translation_state'], 'complete')
            archive.db.close()

    def test_inline_text_stays_together_and_blocks_keep_boundaries(self):
        self.assertEqual(plain_text('<p>赛<b>马娘</b>新闻</p><p>下一段<br>换行</p>'), '赛马娘新闻\n下一段\n换行')
        self.assertEqual(plain_text('<script>hidden</script><p>正文</p>'), '正文')

    def test_existing_archive_text_is_migrated_without_changing_articles(self):
        with tempfile.TemporaryDirectory() as root:
            file = Path(root) / 'news.sqlite'
            archive = NewsDatabase(file)
            article = {'response_code': 1, 'detail': {'announce_id': 'test', 'title': '标题', 'message': '<p>赛<b>马娘</b>新闻</p>'}}
            archive.put('test', article, owner='assistant')
            with archive.db:
                archive.db.execute("UPDATE versions SET japanese_text='赛\n马娘\n新闻'")
                archive.db.execute('PRAGMA user_version=0')
            archive.db.close()
            archive = NewsDatabase(file)
            row = archive.db.execute('SELECT japanese_text,original FROM versions').fetchone()
            self.assertEqual(row['japanese_text'], '赛马娘新闻')
            self.assertEqual(json.loads(row['original'])['detail']['message'], article['detail']['message'])
            archive.db.close()


if __name__ == '__main__':
    unittest.main()
