"""Check an albums JSON file. Defaults to the repository's albums.json."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'albums.json')
d=json.load(open(source, encoding='utf-8-sig'))
print('OK count:', len(d))
print('first album:', d[0].get('name'))
