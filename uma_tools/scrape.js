// scrape.js - 检测官网新出 CD -> 从网易云补全详情 -> 生成待审核预览 pending.json + pending_preview.md
// 用法: node uma_tools/scrape.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALBUMS_JSON = path.join(ROOT, 'data', 'albums.json');
const PENDING_JSON = path.join(ROOT, 'uma_tools', 'pending.json');
const PREVIEW_MD = path.join(ROOT, 'uma_tools', 'pending_preview.md');

const MICROCMS_URL = 'https://6azuq3sitt-aw4monxblm4y4x0oos66.microcms.io/api/v1/goods';
const MICROCMS_KEY = 'xCZfLPNnbazeFHih87prlh1pomFsB1LFq6qZ';
const NETEASE_SEARCH = 'https://music.163.com/api/search/get/web';
const METING = 'https://api.injahow.cn/meting/?server=netease&type=url&id=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, opts = {}, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(25000) });
      if (r.status === 200) return await r.json();
      if (r.status === 429) { await sleep(1200 * i); continue; }
      throw new Error('HTTP ' + r.status);
    } catch (e) {
      if (i === tries) throw e;
      await sleep(800 * i);
    }
  }
}

function norm(s) {
  return String(s || '').replace(/[『』（）()\[\]「」・ー\u3000\s]/g, '').toLowerCase();
}
// 只忽略盘种包装；季数与录音版本参与匹配。
function normKey(s) {
  return norm(s).replace(/op主題歌|ed主題歌|【通常盤】|【bd付限定盤】|【bd版】/gi, '');
}
const versionKey = (title) => (norm(title).match(/season\d+|(?:20\d\d)?remaster(?:ed)?(?:version)?|remix/g) || []).join('|');
function scoreAlbum(title, name) {
  if (versionKey(title) !== versionKey(name)) return 0;
  const target = normKey(title), candidate = normKey(name);
  if (target && candidate === target) return 100;
  return target.length >= 8 && candidate.length >= 8 && (target.includes(candidate) || candidate.includes(target)) ? 80 : 0;
}
function dateOf(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

async function getOfficialGoods() {
  const items = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const q = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      fields: 'id,title,image',
      filters: 'category[equals]music'
    });
    const j = await fetchJson(MICROCMS_URL + '?' + q.toString(), {
      headers: { 'user-agent': UA, 'X-MICROCMS-API-KEY': MICROCMS_KEY }
    });
    items.push(...(j.contents || []));
    if (!j.contents || j.contents.length < limit || items.length >= (j.totalCount || 0)) break;
    offset += limit;
  }
  return items;
}

// 网易云限流时 HTTP 200 但 body code=405，需专用重试
async function neteaseJson(url, opts) {
  for (let i = 0; i < 4; i++) {
    const j = await fetchJson(url, opts);
    if (j && j.code === 405) { await sleep(5000 + 3000 * i); continue; }
    return j;
  }
  return { code: 405 };
}

async function neteaseSearchAlbum(title) {
  const q = new URLSearchParams({ s: title, type: '10', limit: '5' });
  const j = await neteaseJson(NETEASE_SEARCH + '?' + q.toString(), {
    headers: { 'user-agent': UA, 'referer': 'https://music.163.com/' }
  });
  const albums = (j.result && j.result.albums) || [];
  let best = null, bestScore = 0;
  for (const a of albums) {
    const score = scoreAlbum(title, a.name);
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return { best, score: bestScore };
}

async function neteaseAlbumDetail(album) {
  const j = await neteaseJson('https://music.163.com/api/album/' + album.id, {
    headers: { 'user-agent': UA, 'referer': 'https://music.163.com/' }
  });
  if (!j || !j.album) return null;
  const tracks = (j.album.songs) || [];
  let playable = new Set();
  try {
    const availability = await neteaseJson('https://music.163.com/api/song/enhance/player/url?' + new URLSearchParams({ ids: JSON.stringify(tracks.map((t) => t.id)), br: '320000' }), {
      headers: { 'user-agent': UA, 'referer': 'https://music.163.com/' }
    });
    const durations = new Map(tracks.map((t) => [t.id, t.dt || t.duration || 0]));
    playable = new Set((availability.data || []).filter((t) => t.code === 200 && t.url && !t.freeTrialInfo && durations.get(t.id) > 0 && t.time >= durations.get(t.id) - 2000).map((t) => t.id));
  } catch (_) { /* 无法确认完整音源时只导入曲目信息。 */ }
  return {
    name: j.album.name || album.name,
    cover: (album.picUrl || album.blurPicUrl || ''),
    release: dateOf(j.album.publishTime),
    company: j.album.company || '',
    tracks: tracks.map((t) => ({
      name: t.name,
      artist: (t.ar || t.artists || []).map((a) => a.name).join('/'),
      id: t.id,
      playable: playable.has(t.id)
    }))
  };
}

function buildCandidate(official, det) {
  const cover = det.cover || (official.image && official.image.url) || '';
  return {
    name: det.name,
    count: det.tracks.length + ' 曲',
    cover: cover,
    release: det.release || '',
    company: det.company || '',
    songs: det.tracks.map((t) => ({
      name: t.name,
      artist: t.artist,
      url: t.playable ? METING + t.id : '',
      pic: cover
    }))
  };
}

async function main() {
  console.log('读取现有 albums.json ...');
  const existing = JSON.parse(fs.readFileSync(ALBUMS_JSON, 'utf8'));
  const existingNames = existing.map((a) => normKey(a.name));

  console.log('抓取官网音乐商品 ...');
  const goods = await getOfficialGoods();
  console.log('官网 CD 条目:', goods.length);

  const pending = [];
  const skipped = [];
  let found = 0, missing = 0;
  function isAlreadyInStock(key) {
    if (key.length < 12) return existingNames.includes(key);
    return existingNames.some((e) => e === key || (versionKey(e) === versionKey(key) && e.includes(key)));
  }
  for (const g of goods) {
    const title = g.title;
    if (!title) continue;
    const key = normKey(title);
    if (isAlreadyInStock(key)) { skipped.push(title); continue; }
    found++;
    console.log('新增候选:', title);
    let neteaseBest, det = null;
    try {
      neteaseBest = await neteaseSearchAlbum(title);
      await sleep(300);
      if (neteaseBest.best && neteaseBest.score >= 50) {
        det = await neteaseAlbumDetail(neteaseBest.best);
        await sleep(300);
      }
    } catch (e) {
      console.log('  网易云失败:', e.message);
    }
    if (det && det.tracks.length) {
      const candidate = buildCandidate(g, det);
      pending.push({
        source: '官网: ' + title,
        neteaseMatch: det.name,
        matchScore: neteaseBest.score,
        candidate: candidate
      });
    } else {
      missing++;
      pending.push({ source: '官网: ' + title, neteaseMatch: '(未匹配到网易云专辑)', matchScore: 0, candidate: null });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    totalOfficial: goods.length,
    newFound: pending.length,
    skippedAlreadyExists: skipped.length,
    candidates: pending
  };
  fs.writeFileSync(PENDING_JSON, JSON.stringify(report, null, 2), 'utf8');

  // 人类可读预览
  let md = '# 待审核新专辑\n\n生成时间: ' + report.generatedAt + '\n';
  md += '官网CD总数: ' + report.totalOfficial + '，已在库: ' + report.skippedAlreadyExists + '，新候选: ' + report.newFound + '\n\n';
  pending.forEach((p, i) => {
    md += '## ' + (i + 1) + '. ' + p.source.replace('官网: ', '') + '\n';
    md += '- 网易云匹配: ' + p.neteaseMatch + '（匹配度 ' + p.matchScore + '）\n';
    if (p.candidate) {
      const c = p.candidate;
      md += '- 发售: ' + (c.release || '?') + '　发行: ' + (c.company || '?') + '　曲数: ' + c.songs.length + '\n';
      md += '- 封面: ' + c.cover + '\n';
      md += '- 曲目: ' + c.songs.map((s) => s.name).join(' / ') + '\n';
    } else {
      md += '- ⚠ 无网易云条目，需人工补全\n';
    }
    md += '\n';
  });
  fs.writeFileSync(PREVIEW_MD, md, 'utf8');

  console.log('\n===== 结果 =====');
  console.log('已存在跳过:', skipped.length);
  console.log('新候选:', pending.length, '(可匹配:' + (pending.length - missing) + ', 未匹配:' + missing + ')');
  console.log('待审核文件: ' + PENDING_JSON);
  console.log('预览:      ' + PREVIEW_MD);
}
module.exports = { normKey, scoreAlbum, buildCandidate };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
