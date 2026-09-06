const fs = require('fs');
const path = 'G:\\学习\\AI\\赛马娘LIVE相关.html';
const body = fs.readFileSync(path, 'utf8');
// current page still embeds inline ALBUMS
const m = body.match(/const ALBUMS = (\[.*?\]);\s*\n/s);
if (!m) { console.error('ALBUMS not found inline'); process.exit(1); }
const albums = JSON.parse(m[1]);
// add an "id" derivation + keep shape used by the page
fs.writeFileSync('G:\\学习\\AI\\albums.json', JSON.stringify(albums, null, 2), 'utf8');
console.log('wrote albums.json albums:', albums.length, 'songs:', albums.reduce((n, a) => n + a.songs.length, 0));