"""Persistent album IDs and the shared fallback used by Python maintenance tools."""
import hashlib
import re
import unicodedata


def stable_album_id(album):
    current = str(album.get('id') or '').strip()
    if current:
        return current
    catalog = re.sub(r'[^a-z0-9]+', '-', str(album.get('catalog') or '').lower()).strip('-')
    if catalog:
        return 'album-' + catalog
    title = re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(album.get('name') or '')).lower())
    return 'album-' + hashlib.sha1(title.encode('utf-8')).hexdigest()[:12]
