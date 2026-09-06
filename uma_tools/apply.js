const fs = require('fs');
const path = require('path');

// apply.js - 把待审核(pending.json)中已确认的候选并入 albums.json
// 用法: 先审阅 uma_tools/pending.json（删掉不要的项，或把 candidate 留空即跳过），再运行:
//   node uma_tools/apply.js
const ROOT = path.resolve(__dirname, '..');
const ALBUMS_JSON = path.join(ROOT, 'albums.json');
const PENDING_JSON = path.join(__dirname, 'pending.json');

const norm = (s) => String(s || '').replace(/[『』（）()\[\]「」・ー\u3000\s]/g, '').toLowerCase();

let albums = JSON.parse(fs.readFileSync(ALBUMS_JSON, 'utf8'));
if (!fs.existsSync(PENDING_JSON)) { console.error('未找到 pending.json，先运行 scrape.js'); process.exit(1); }
const report = JSON.parse(fs.readFileSync(PENDING_JSON, 'utf8'));

const names = new Set(albums.map((a) => norm(a.name)));
let added = 0, skippedEmpty = 0, skippedDup = 0;

for (const p of report.candidates || []) {
  const c = p.candidate;
  if (!c || !c.name) { skippedEmpty++; continue; }
  if (names.has(norm(c.name))) { skippedDup++; continue; }
  albums.push(c);
  names.add(norm(c.name));
  added++;
}

fs.writeFileSync(ALBUMS_JSON, JSON.stringify(albums, null, 2), 'utf8');
// 标记已应用并落盘
report.appliedAt = new Date().toISOString();
report.applied = added;
fs.writeFileSync(PENDING_JSON, JSON.stringify(report, null, 2), 'utf8');

console.log('已并入新专辑:', added);
console.log('跳过(无候选):', skippedEmpty, ' 跳过(已存在):', skippedDup);
console.log('albums.json 现有专辑:', albums.length, '曲目:', albums.reduce((n, a) => n + a.songs.length, 0));
console.log('刷新页面(重载 http://localhost:8080/)即可看到新专辑。');