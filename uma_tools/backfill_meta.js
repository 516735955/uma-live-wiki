const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALBUMS_JSON = path.join(ROOT, 'data', 'albums.json');
const BACKUP = path.join(ROOT, 'archive', 'live-page-snapshots', '赛马娘LIVE相关_备份_原版_20260805.html');

const norm = (s) => String(s || '').replace(/[『』（）()\[\]「」・ー\u3000\s]/g, '').toLowerCase();

const html = fs.readFileSync(BACKUP, 'utf8');
const cardRe = /<div class="album-card" data-album="(\d+)" data-release="([^"]*)" data-company="([^"]*)">[\s\S]*?<div class="album-name">(.*?)<\/div>/g;
const meta = new Map();
let m;
while ((m = cardRe.exec(html))) {
  meta.set(norm(m[4]), { release: m[2], company: m[3] });
}
console.log('backup cards parsed:', meta.size);

const albums = JSON.parse(fs.readFileSync(ALBUMS_JSON, 'utf8'));
let filled = 0, unmatched = 0;
for (const a of albums) {
  const md = meta.get(norm(a.name));
  if (!md) { unmatched++; console.log('NO MATCH:', a.name); continue; }
  if (!a.release) a.release = md.release;
  if (!a.company) a.company = md.company;
  if (a.release || a.company) filled++;
}
fs.writeFileSync(ALBUMS_JSON, JSON.stringify(albums, null, 2), 'utf8');
const er = albums.filter((x) => !x.release).length;
const ec = albums.filter((x) => !x.company).length;
console.log('filled albums:', filled, '| unmatched:', unmatched, '| still empty release:', er, 'company:', ec);
