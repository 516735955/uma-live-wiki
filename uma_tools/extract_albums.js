const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const source = path.resolve(process.argv[2] || path.join(ROOT, '赛马娘LIVE相关.html'));
const output = path.resolve(process.argv[3] || path.join(ROOT, 'data', 'albums.json'));
const body = fs.readFileSync(source, 'utf8');
// current page still embeds inline ALBUMS
const m = body.match(/const ALBUMS = (\[.*?\]);\s*\n/s);
if (!m) { console.error('ALBUMS not found inline'); process.exit(1); }
const albums = JSON.parse(m[1]);
if (!Array.isArray(albums) || !albums.length) {
  console.error('ALBUMS is empty; refusing to overwrite ' + output);
  process.exit(1);
}
// add an "id" derivation + keep shape used by the page
fs.writeFileSync(output, JSON.stringify(albums, null, 2), 'utf8');
console.log('wrote ' + output + ' albums:', albums.length, 'songs:', albums.reduce((n, a) => n + a.songs.length, 0));
