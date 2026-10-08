const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// apply.js - 把待审核(pending.json)中已确认的候选并入 albums.json
// 用法: 先审阅 uma_tools/pending.json（删掉不要的项，或把 candidate 留空即跳过），再运行:
//   node uma_tools/apply.js
const ROOT = path.resolve(__dirname, '..');
const ALBUMS_JSON = path.join(ROOT, 'data', 'albums.json');
const PENDING_JSON = path.join(__dirname, 'pending.json');

const norm = (s) => String(s || '').replace(/[『』（）()\[\]「」・ー\u3000\s]/g, '').toLowerCase();
const albumId = (album) => {
  if (album.id) return album.id;
  const catalog = String(album.catalog || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return catalog ? 'album-' + catalog : 'album-' + crypto.createHash('sha1').update(norm(album.name)).digest('hex').slice(0, 12);
};

let albums = JSON.parse(fs.readFileSync(ALBUMS_JSON, 'utf8'));
if (!fs.existsSync(PENDING_JSON)) { console.error('未找到 pending.json，先运行 scrape.js'); process.exit(1); }
const report = JSON.parse(fs.readFileSync(PENDING_JSON, 'utf8'));

const names = new Set(albums.map((a) => norm(a.name)));
let added = 0, skippedEmpty = 0, skippedDup = 0;

for (const p of report.candidates || []) {
  const c = p.candidate;
  if (!c || !c.name) { skippedEmpty++; continue; }
  if (names.has(norm(c.name))) { skippedDup++; continue; }
  c.id = albumId(c);
  albums.push(c);
  names.add(norm(c.name));
  added++;
}

function writeJson(file, value) {
  const temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporary, file);
}
if (added) {
  writeJson(ALBUMS_JSON, albums);
  const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const build = spawnSync(python, [path.join(__dirname, 'update_events.py'), '--music-only'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  if (build.error || build.status !== 0) {
    console.error('专辑已保存，目录重建失败，请运行 uma_tools/update_events.py --music-only。');
    process.exitCode = 1;
    return;
  }
}
// 标记已应用并落盘
report.appliedAt = new Date().toISOString();
report.applied = added;
writeJson(PENDING_JSON, report);

console.log('已并入新专辑:', added);
console.log('跳过(无候选):', skippedEmpty, ' 跳过(已存在):', skippedDup);
console.log('albums.json 现有专辑:', albums.length, '曲目:', albums.reduce((n, a) => n + (a.songs || []).length, 0));
console.log('音乐目录已同步，刷新专辑页面即可查看。');
