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
