"""Check an albums JSON file. Defaults to the repository's albums.json."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'albums.json')
with open(source, encoding='utf-8-sig') as stream:
    d = json.load(stream)
if not isinstance(d, list) or not d:
    sys.exit('Invalid albums: expected a nonempty list')
ids = set()
for index, album in enumerate(d):
    if not isinstance(album, dict) or not isinstance(album.get('name'), str) or not album['name'].strip():
        sys.exit('Invalid album %d: missing name' % index)
    if not isinstance(album.get('songs'), list):
        sys.exit('Invalid album %d: songs must be a list (empty for an announced album)' % index)
    if not isinstance(album.get('id'), str) or not album['id'].strip() or album['id'] in ids:
        sys.exit('Invalid album %d: missing or duplicate id' % index)
    ids.add(album['id'])
print('OK count:', len(d))
print('first album:', d[0].get('name'))
