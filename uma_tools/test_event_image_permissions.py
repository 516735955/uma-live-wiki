import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import sync_event_images


@unittest.skipIf(os.name == 'nt', 'POSIX permissions are enforced by nginx on Linux')
class EventImagePermissions(unittest.TestCase):
    def test_publication_reuses_old_cache_and_a_partial_batch_saves_progress(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir()
            catalog=root/'data/events_catalog.json'
            catalog.write_text(json.dumps({'events':[{'id':'one','image':'https://example.test/one.jpg'}]}))
            data=io.BytesIO();Image.new('RGB',(40,30),'blue').save(data,'JPEG')
            with patch.object(sync_event_images,'fetch',return_value=data.getvalue()) as fetch:
                sync_event_images.run(root)
                state=root/'data/auto_update/event_images.json';saved=json.loads(state.read_text())
                saved['items']['one']['checked_at']=1;state.write_text(json.dumps(saved))
                self.assertEqual(sync_event_images.run(root,missing_only=True)['updated'],0)
                self.assertEqual(fetch.call_count,1,'publication does not refetch stale-but-complete artwork')
                catalog.write_text(json.dumps({'events':[{'id':'two','image':'https://example.test/two.jpg'},
                                                        {'id':'three','image':'https://example.test/three.jpg'}]}))
                result=sync_event_images.run(root,limit=1)
                self.assertEqual(result['updated'],1);self.assertEqual(result['deferred'],1)
                self.assertIn('two',json.loads(state.read_text())['items'],'completed work is checkpointed before another batch')

    def test_new_and_existing_public_artwork_is_readable_without_refetch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            (root / 'data/events_catalog.json').write_text(json.dumps({'events': [
                {'id': 'event', 'image': 'https://i.ytimg.com/vi/example/hqdefault.jpg'}
            ]}))
            source = io.BytesIO()
            Image.new('RGB', (40, 30), 'blue').save(source, 'JPEG')
            with patch.object(sync_event_images, 'fetch', return_value=source.getvalue()) as fetch:
                self.assertEqual(sync_event_images.run(root)['updated'], 1)
                state = json.loads((root / 'data/auto_update/event_images.json').read_text())
                images = [root / state['items']['event'][key].lstrip('/')
                          for key in ('image_url', 'hero_image_url', 'original_url')]
                for file in images:
                    self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o644)
                    file.chmod(0o600)
                self.assertEqual(sync_event_images.run(root)['updated'], 0)
                self.assertEqual(fetch.call_count, 1)
                for file in images:
                    self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o644)


if __name__ == '__main__':
    unittest.main()
