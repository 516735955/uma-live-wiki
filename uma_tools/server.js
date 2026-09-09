// Zero-dependency static file server for the 赛马娘 page.
// Usage: node server.js [port] [root]   (default port 8080, root = parent folder of this script)
// News proxy endpoints (official umamusume API lacks CORS headers, front-end calls same-origin):
//   GET /api/news-index            -> merged fresh news list (pages 1..NEWS_TOP)
//   GET /api/news-detail?id=<id>   -> single news detail
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

const PORT = parseInt(process.argv[2] || '8080', 10);
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, '..'));

function isInsideRoot(filePath) {
  const relativePath = path.relative(ROOT, filePath);
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith('..' + path.sep) &&
    !path.isAbsolute(relativePath)
  );
}

// Entry HTML file: support both the original CJK filename and index.html (some
// setups rename it, e.g. behind nginx). Pick whichever exists in ROOT.
const INDEX_CANDIDATES = ['index.html', '赛马娘LIVE相关.html'];
let INDEX_FILE = 'index.html';
try {
  INDEX_FILE = INDEX_CANDIDATES.find((f) => fs.existsSync(path.join(ROOT, f))) || 'index.html';
} catch (e) { /* keep default */ }

const NEWS_INDEX_URL = 'https://umamusume.jp/api/ajax/pr_info_index?format=json';
const NEWS_DETAIL_URL = 'https://umamusume.jp/api/ajax/pr_info_detail?format=json';
const NEWS_TTL = 5 * 60 * 1000; // cache the full crawl for 5 minutes
const NEWS_MAX_CONC = 5;        // upstream request concurrency

// ---- Lantis (umamusume.lantis.jp) offline crawl ----
// Scraped by crawl_lantis_news.py into lantis_news.json. Merged into the news
// index with type "cd" (CD相关). Each item: {id, date, url, title, category}.
const LANTIS_FILE = path.join(__dirname, 'lantis_news.json');
let lantisList = [];
try { lantisList = JSON.parse(fs.readFileSync(LANTIS_FILE, 'utf8')); } catch (e) { lantisList = []; }
function normalizeLantisDate(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  return String(d);
}
function mergeLantis(list) {
  lantisList.forEach(function (it) {
    const zh = transCache[it.title] || '';
    list.push({
      announce_id: it.id,
      title: it.title,
      title_zh: zh || '',
      post_at: normalizeLantisDate(it.date),
      announce_label: 4,
      source: 'lantis',
      url: it.url,
      news_type_display: 'CD相关',
      image: it.image || ''
    });
  });
  return list;
}
function reloadLantis() {
  try { lantisList = JSON.parse(fs.readFileSync(LANTIS_FILE, 'utf8')); } catch (e) {}
}

let newsIndexCache = { at: 0, data: null };

// ---- machine translation of news titles (Baidu Translate API, cached) ----
const TRANS_CACHE_FILE = path.join(__dirname, 'trans_cache.json');
// Baidu Translate API credentials. Do NOT hardcode real keys in this file:
// load them from environment variables so the public repo stays secret-free.
// When unset, translation degrades gracefully (titles/bodies stay in Japanese).
const BAIDU_APPID = process.env.BAIDU_APPID || '';
const BAIDU_SECRET = process.env.BAIDU_SECRET || '';
let transCache = {};
try { transCache = JSON.parse(fs.readFileSync(TRANS_CACHE_FILE, 'utf8')); } catch (e) {}
let transQueue = [];
let transRunning = false;
let transDirty = false;

function saveTransCache() {
  if (!transDirty) return;
  try { fs.writeFileSync(TRANS_CACHE_FILE, JSON.stringify(transCache)); transDirty = false; } catch (e) {}
}

function translateOne(text, attempt) {
  return new Promise((resolve) => {
    const salt = String(Date.now() + Math.floor(Math.random() * 1000));
    const sign = crypto.createHash('md5').update(BAIDU_APPID + text + salt + BAIDU_SECRET).digest('hex');
    const url = 'https://fanyi-api.baidu.com/api/trans/vip/translate?q=' + encodeURIComponent(text) +
      '&from=jp&to=zh&appid=' + BAIDU_APPID + '&salt=' + salt + '&sign=' + sign;
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, family: 4 }, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j && j.trans_result && j.trans_result.length) {
            const t = j.trans_result.map(function (x) { return x.dst; }).join('');
            resolve(t);
            return;
          }
          const code = j && j.error_code;
          if ((code === '54003' || code === '54000') && (attempt || 0) < 3) {
            // rate-limited: wait and retry
            setTimeout(function () {
              translateOne(text, (attempt || 0) + 1).then(resolve);
            }, 1200 * ((attempt || 0) + 1));
            return;
          }
          resolve('');
        } catch (e) { resolve(''); }
      });
    }).on('error', () => resolve(''))
      .setTimeout(20000, function () { this.destroy(); resolve(''); });
  });
}

async function pumpTranslations() {
  if (transRunning) return;
  transRunning = true;
  while (transQueue.length) {
    const item = transQueue.shift();
    // Baidu free tier is ~1 QPS; translate serially with a small delay.
    const zh = await translateOne(item.text, 0);
    if (zh && zh !== item.text) transCache[item.text] = zh;
    transDirty = true;
    saveTransCache();
    item.cb(zh || item.text);
    await new Promise((r) => setTimeout(r, 250));
  }
  transRunning = false;
}

function translateTitle(text, cb) {
  if (!text) return cb(text || '');
  if (transCache[text]) return cb(transCache[text]);
  transQueue.push({ text: text, cb: cb });
  pumpTranslations();
}

// ---- translate HTML body of a news detail (keep tags/links, translate text runs) ----
function hasCjk(s) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(s);
}

function translateBatchLines(lines, cb) {
  // translate multiple short text runs in one Baidu request (newline-joined)
  if (!lines.length) return cb([]);
  const text = lines.join('\n');
  const salt = String(Date.now() + Math.floor(Math.random() * 1000));
  const sign = crypto.createHash('md5').update(BAIDU_APPID + text + salt + BAIDU_SECRET).digest('hex');
  const url = 'https://fanyi-api.baidu.com/api/trans/vip/translate?q=' + encodeURIComponent(text) +
    '&from=jp&to=zh&appid=' + BAIDU_APPID + '&salt=' + salt + '&sign=' + sign;
  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, family: 4 }, (r) => {
    let d = '';
    r.on('data', (c) => d += c);
    r.on('end', () => {
      try {
        const j = JSON.parse(d);
        if (j && j.trans_result && j.trans_result.length) {
          const out = [];
          for (let i = 0; i < lines.length; i++) {
            out.push((j.trans_result[i] && j.trans_result[i].dst) || lines[i]);
          }
          return cb(out);
        }
        const code = j && j.error_code;
        if (code === '54003' || code === '54000') {
          // rate-limited: after a pause, caller retries by translating one by one
          return cb(null);
        }
        cb(lines);
      } catch (e) { cb(lines); }
    });
  }).on('error', () => cb(lines))
    .setTimeout(20000, function () { this.destroy(); cb(null); });
}

function translateHtmlMessage(html, cb) {
  const src = String(html || '');
  if (!src) return cb('');
  const hash = crypto.createHash('md5').update(src).digest('hex');
  const key = 'msg_' + hash;
  if (transCache[key]) return cb(transCache[key]);
  // tokenize: alternates text / tag
  const tokens = src.match(/<[^>]+>|[^<]+/g) || [src];
  const runs = []; // {tokIndex, text}
  tokens.forEach(function (tok, i) {
    if (tok[0] !== '<' && hasCjk(tok) && tok.trim()) runs.push({ idx: i, text: tok });
  });
  if (!runs.length) {
    transCache[key] = src;
    transDirty = true; saveTransCache();
    return cb(src);
  }
  // translate in chunks (each request <= ~900 chars to be safe)
  const CHUNK = 900;
  const chunks = [];
  let cur = [];
  let curLen = 0;
  runs.forEach(function (r) {
    if (curLen + r.text.length > CHUNK && cur.length) {
      chunks.push(cur); cur = []; curLen = 0;
    }
    cur.push(r); curLen += r.text.length;
  });
  if (cur.length) chunks.push(cur);
  const translated = {};
  let done = 0;
  let failed = false;
  chunks.forEach(function (chunk, ci) {
    translateBatchLines(chunk.map(function (r) { return r.text; }), function (outs) {
      if (outs === null) {
        // rate limited on batch -> fall back to one-by-one for this chunk
        const chain = function (i) {
          if (i >= chunk.length) { done++; if (done === chunks.length) finish(); return; }
          translateOne(chunk[i].text, 0).then(function (zh) {
            translated[chunk[i].idx] = zh || chunk[i].text;
            chain(i + 1);
          });
        };
        chain(0);
        return;
      }
      outs.forEach(function (zh, k) {
        translated[chunk[k].idx] = zh || chunk[k].text;
      });
      done++;
      if (done === chunks.length) finish();
    });
  });
  function finish() {
    const out = tokens.map(function (tok, i) {
      if (translated[i] !== undefined) return translated[i];
      return tok;
    }).join('');
    transCache[key] = out;
    transDirty = true;
    saveTransCache();
    cb(out);
  }
}

function httpsGet(url, cb) {
  const u = new URL(url);
  const req = https.request(u, {
    method: 'GET',
    family: 4,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://umamusume.jp/news' }
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try { json = JSON.parse(body); } catch (e) { /* keep null */ }
      cb(null, json, body);
    });
    res.on('error', (e) => cb(e, null, null));
  });
  req.on('error', (e) => cb(e, null, null));
  req.end();
}

// Fetch a page and return its raw HTML text (used by the Lantis detail crawler).
function httpsGetHtml(url, cb) {
  let u;
  try { u = new URL(url); } catch (e) { cb(new Error('bad url')); return; }
  const req = https.request(u, {
    method: 'GET',
    family: 4,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      httpsGetHtml(new URL(res.headers.location, u).href, cb);
      return;
    }
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
    res.on('error', (e) => cb(e, null));
  });
  req.on('error', (e) => cb(e, null));
  req.setTimeout(20000, function () { try { req.destroy(new Error('timeout')); } catch (e) {} });
  req.end();
}

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(obj));
}

function fetchNewsPage(page, cb) {
  httpsGet(NEWS_INDEX_URL + '&page=' + page, (err, json) => {
    if (err || !json || json.response_code !== 1) { cb(err || new Error('bad page')); return; }
    cb(null, json);
  });
}

function handleNewsIndex(res) {
  if (newsIndexCache.data && Date.now() - newsIndexCache.at < NEWS_TTL) {
    sendJson(res, 200, newsIndexCache.data);
    return;
  }
  // First learn the total page count, then crawl from the last page down to page 1.
  fetchNewsPage(1, (err, first) => {
    if (err) { sendJson(res, 502, { error: 'upstream news index failed' }); return; }
    const total = parseInt(first.total_page_count, 10) || 1;
    const slots = new Array(total);
    let done = 0;
    let failed = false;
    let active = 0;
    let cursor = total; // start at the last page

    function pump() {
      while (active < NEWS_MAX_CONC && cursor >= 1) {
        const page = cursor;
        cursor--;
        active++;
        fetchNewsPage(page, (e, json) => {
          active--;
          if (failed) return;
          if (e) {
            failed = true;
            sendJson(res, 502, { error: 'upstream news index failed' });
            return;
          }
          slots[page - 1] = json.information_list || [];
          done++;
          if (done === total) {
            const seen = new Set();
            let list = [];
            for (let p = 1; p <= total; p++) {
              (slots[p - 1] || []).forEach((n) => {
                if (!seen.has(n.announce_id)) { seen.add(n.announce_id); list.push(n); }
              });
            }
            list.sort((a, b) => {
              const atA = a.update_at || a.post_at;
              const atB = b.update_at || b.post_at;
              return String(atB).localeCompare(String(atA));
            });
            const data = { response_code: 1, information_list: list, total_page_count: total };
            // Merge Lantis (CD相关) items, then sort the combined set newest-first.
            mergeLantis(data.information_list);
            data.information_list.sort((a, b) => {
              const atA = a.update_at || a.post_at;
              const atB = b.update_at || b.post_at;
              return String(atB).localeCompare(String(atA));
            });
            // Fill in cached translations immediately, kick off any missing ones in background.
            const items = data.information_list;
            items.forEach(function (n) {
              if (transCache[n.title]) n.title_zh = transCache[n.title];
            });
            // Pre-fetch hero cover images (first <img> in body) for the hero items the front-end
            // shows (2 latest MEDIA + 1 latest GAME), matching the client's newsHero computed.
            const heroes = [];
            let mediaSeen = 0, gameSeen = 0;
            items.forEach(function (n) {
              if (mediaSeen < 2 && n.announce_label === 3) { heroes.push(n); mediaSeen++; }
              else if (gameSeen < 1 && n.announce_label === 1) { heroes.push(n); gameSeen++; }
            });
            const heroNeeded = heroes.filter(function (n) { return !n.image; });
            let heroDone = 0;
            if (!heroNeeded.length) {
              newsIndexCache = { at: Date.now(), data: data };
              sendJson(res, 200, data);
              finishBackground();
              return;
            }
            heroNeeded.forEach(function (n) {
              httpsGet(NEWS_DETAIL_URL + '&announce_id=' + n.announce_id, function (err, djson) {
                if (!err && djson && djson.detail) {
                  const m = String(djson.detail.message || '').match(/<img[^>]+src=["']([^"']+)["']/i);
                  if (m && m[1]) n.hero_img = m[1];
                }
                heroDone++;
                if (heroDone === heroNeeded.length) {
                  newsIndexCache = { at: Date.now(), data: data };
                  sendJson(res, 200, data);
                  finishBackground();
                }
              });
            });
            function finishBackground() {
              // translate any titles not yet cached (result lands in cache + next response)
              items.forEach(function (n) {
                if (!n.title_zh) translateTitle(n.title, function () {});
              });
              lantisList.forEach(function (n) {
                if (!transCache[n.title]) translateTitle(n.title, function () {});
              });
            }
            return;
          }
          pump();
        });
      }
    }
    pump();
  });
}

function handleNewsDetail(req, res, params) {
  const id = parseInt((params.get('id') || ''), 10);
  if (!id) { sendJson(res, 400, { error: 'missing id' }); return; }
  httpsGet(NEWS_DETAIL_URL + '&announce_id=' + id, (err, json) => {
    if (err || !json || json.response_code !== 1) {
      sendJson(res, 502, { error: 'upstream detail failed' });
      return;
    }
    if (json.detail) {
      const detail = json.detail;
      if (detail.title && transCache[detail.title]) detail.title_zh = transCache[detail.title];
      if (detail.title && !transCache[detail.title]) {
        translateTitle(detail.title, function (zh) { if (zh) detail.title_zh = zh; });
      }
      if (detail.message) {
        // translate the body, but never block the response for too long.
        let responded = false;
        const respond = function () { if (!responded) { responded = true; sendJson(res, 200, json); } };
        const timer = setTimeout(respond, 8000);
        translateHtmlMessage(detail.message, function (zh) {
          clearTimeout(timer);
          if (zh) detail.message_zh = zh;
          respond();
        });
        return;
      }
    }
    sendJson(res, 200, json);
  });
}

// ---- Lantis news: re-run the scraper on demand, then return the merged list ----
function handleLantisNews(res) {
  runLantisCrawl('manual');
  // return current (already-loaded) Lantis items with zh translations filled in
  const items = lantisList.map(function (it) {
    return {
      announce_id: it.id,
      title: it.title,
      title_zh: transCache[it.title] || '',
      post_at: normalizeLantisDate(it.date),
      announce_label: 4,
      source: 'lantis',
      url: it.url,
      news_type_display: 'CD相关',
      image: it.image || ''
    };
  });
  sendJson(res, 200, { response_code: 1, information_list: items });
}

// ---- Lantis detail: crawl the article page and return title + body (+ zh translation) ----
function handleLantisDetail(req, res, params) {
  const raw = (params.get('id') || '').toString();
  const digits = String(raw).replace(/^lantis-/, '').replace(/\D/g, '');
  if (!digits) { sendJson(res, 400, { error: 'missing id' }); return; }
  const it = lantisList.find(function (x) { return x.id === 'lantis-' + digits || x.id === raw; });
  const url = (it && it.url) || ('https://umamusume.lantis.jp/news/' + digits + '/');
  httpsGetHtml(url, function (err, body) {
    if (err || !body) { sendJson(res, 502, { error: 'upstream lantis detail failed' }); return; }
    const detail = {
      announce_id: 'lantis-' + digits,
      title: '',
      title_zh: '',
      message: '',
      message_zh: '',
      post_at: it ? normalizeLantisDate(it.date) : '',
      image: (it && it.image) || '',
      source: 'lantis',
      url: url
    };
    const tm = body.match(/<h2[^>]*class="newsin_title"[^>]*>([\s\S]*?)<\/h2>/i) ||
               body.match(/<title>([^<]*)<! /i);
    if (tm) detail.title = cleanHtml(tm[1]).trim();
    const inner = extractInnercon(body) || '';
    detail.message = inner;
    if (detail.title && transCache[detail.title]) detail.title_zh = transCache[detail.title];
    const respond = function () { sendJson(res, 200, { response_code: 1, detail: detail }); };
    if (inner) {
      let responded = false;
      const r2 = function () { if (!responded) { responded = true; respond(); } };
      const timer = setTimeout(r2, 8000);
      translateHtmlMessage(inner, function (zh) {
        clearTimeout(timer);
        if (zh) detail.message_zh = zh;
        if (detail.title && !detail.title_zh) {
          translateTitle(detail.title, function (t) { if (t) detail.title_zh = t; r2(); });
        } else {
          r2();
        }
      });
    } else {
      respond();
    }
  });
}
function cleanHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); }
function extractInnercon(body) {
  const i = body.indexOf('class="innercon"');
  if (i === -1) return null;
  const start = body.indexOf('>', i) + 1;
  const rest = body.slice(start);
  // find matching end: the first true closing </div> that is followed by the article footer close
  let depth = 1;
  let j = 0;
  const reOpen = /<div[\s>]/g;
  const reClose = /<\/div>/g;
  let lastSafe = -1;
  reClose.lastIndex = 0;
  let m;
  // simpler: capture up to the ban_more nav which follows the content div
  const endMarker = body.indexOf('<div class="ban_more">', start);
  if (endMarker !== -1) {
    return body.slice(start, endMarker).replace(/<\/div>\s*$/, '').trim();
  }
  return null;
}

// ---- audio proxy: relay a song URL (e.g. meting API) through this server so
// the page never hits flaky third-party hosts directly and Range/seek keeps working.
// Falls back across several public meting mirrors when one returns a non-audio response. ----
const AUDIO_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

function metingCandidates(target) {
  let u;
  try { u = new URL(target); } catch (e) { return [target]; }
  const q = u.searchParams;
  const server = q.get('server') || 'netease';
  const type = q.get('type') || 'url';
  const id = q.get('id');
  if (!id) return [target];
  const mirrorTpl = [
    { host: 'api.injahow.cn', path: '/meting/' },
    { host: 'met.liiiu.cn', path: '/meting/api' },
    { host: 'api.baka.plus', path: '/meting/' },
    { host: 'meting.mikus.ink', path: '/api' }
  ];
  const seen = [];
  const out = [];
  [target].forEach(function (t) { seen.push(t); out.push(t); });
  mirrorTpl.forEach(function (m) {
    const cand = 'https://' + m.host + m.path +
      '?server=' + encodeURIComponent(server) +
      '&type=' + encodeURIComponent(type) +
      '&id=' + encodeURIComponent(id);
    if (seen.indexOf(cand) === -1) { seen.push(cand); out.push(cand); }
  });
  return out;
}

function audioFetchOnce(url, headers, cb, hops) {
  hops = hops || 0;
  let u;
  try { u = new URL(url); } catch (e) { cb(new Error('bad url')); return; }
  const mod = u.protocol === 'http:' ? http : https;
  let called = false;
  const done = (err, r, pref) => { if (called) return; called = true; cb(err, r, pref); };
  const pref = mod.get(u, { headers: headers, family: 4 }, (r) => {
    // Meting mirrors answer type=url with a 302 to the real CDN audio; follow it.
    if (hops < 5 && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      r.resume();
      const next = new URL(r.headers.location, u).href;
      const dest = audioFetchOnce(next, headers, done, hops + 1);
      return; // dest will own completion
    }
    done(null, r, pref);
  });
  pref.on('error', (e) => done(e, null, pref));
  pref.setTimeout(20000, function () { try { pref.destroy(new Error('timeout')); } catch (e) {} });
}

function handleAudioProxy(req, res, params) {
  const target = params.get('url');
  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad audio url');
    return;
  }
  const candidates = metingCandidates(target);
  let idx = 0;

  function tryNext() {
    if (idx >= candidates.length) {
      try { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('audio proxy failed'); } catch (e) {}
      return;
    }
    const url = candidates[idx++];
    const headers = { 'User-Agent': AUDIO_UA, 'Referer': 'https://music.163.com/' };
    if (req.headers.range) headers.Range = req.headers.range;
    audioFetchOnce(url, headers, (err, r, pref) => {
      if (err || !r) { try { if (pref) pref.destroy(); } catch (e) {} tryNext(); return; }
      const ct = String(r.headers['content-type'] || '');
      const isAudio = /audio\//i.test(ct) || /octet-stream/i.test(ct);
      const bad = r.statusCode >= 400 || (!isAudio && /html|json|text/i.test(ct));
      if (bad) {
        r.resume(); // drain
        try { if (pref) pref.destroy(); } catch (e) {}
        tryNext();
        return;
      }
      const h = {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      };
      if (r.headers['content-type']) h['Content-Type'] = r.headers['content-type'];
      else h['Content-Type'] = 'application/octet-stream';
      h['Accept-Ranges'] = r.headers['accept-ranges'] || 'bytes';
      if (r.headers['content-length']) h['Content-Length'] = r.headers['content-length'];
      if (r.headers['content-range']) h['Content-Range'] = r.headers['content-range'];
      try {
        res.writeHead(r.statusCode || 200, h);
        r.pipe(res);
      } catch (e) { try { if (pref) pref.destroy(); } catch (e2) {} }
    });
  }
  req.on('close', () => { /* client gone; upstream req destroyed below via stream end */ });
  tryNext();
}

const server = http.createServer((req, res) => {
  let urlObj;
  let urlPath;
  try {
    urlObj = new URL(req.url, 'http://x');
    urlPath = decodeURIComponent(urlObj.pathname || '/');
    if (urlPath.indexOf('\0') !== -1) throw new Error('null byte in path');
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('400 Bad Request');
    return;
  }
  const params = urlObj.searchParams;

  if (req.method === 'GET' && urlPath.indexOf('/api/news-index') === 0) return handleNewsIndex(res);
  if (req.method === 'GET' && urlPath.indexOf('/api/news-detail') === 0) return handleNewsDetail(req, res, params);
  if (req.method === 'GET' && urlPath.indexOf('/api/lantis-news') === 0) return handleLantisNews(res);
  if (req.method === 'GET' && urlPath.indexOf('/api/lantis-detail') === 0) return handleLantisDetail(req, res, params);
  if (req.method === 'GET' && urlPath.indexOf('/api/audio') === 0) return handleAudioProxy(req, res, params);

  if (urlPath === '/') urlPath = '/' + INDEX_FILE;
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!isInsideRoot(filePath)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // History-mode fallback: if the path looks like a client route (no file extension),
      // serve the SPA index so deep links / refreshes work.
      if (!path.extname(urlPath)) {
        filePath = path.join(ROOT, INDEX_FILE);
        return serveFile(filePath, res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  fs.stat(filePath, (err2, st2) => {
    if (err2 || !st2.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

server.listen(PORT, () => {
  console.log('Serving ' + ROOT + '  ->  http://localhost:' + PORT + '/');
  console.log('News proxy ready: /api/news-index  /api/news-detail?id=xxx  /api/lantis-news  /api/audio?url=...');
  runEventsCrawl('startup');
  runCharsCrawl('startup');
  runAlbumsCrawl('startup');
  reloadLantis(); // use existing lantis_news.json immediately; re-crawl in background
  runLantisCrawl('startup');
  setInterval(() => runEventsCrawl('daily'), 24 * 60 * 60 * 1000);
  setInterval(() => runCharsCrawl('daily'), 24 * 60 * 60 * 1000);
  setInterval(() => runAlbumsCrawl('auto'), 6 * 60 * 60 * 1000);
  setInterval(() => runLantisCrawl('daily'), 24 * 60 * 60 * 1000);
});

// ---- Events auto-crawl (Eventernote -> events_data.json) ----
const { execFile } = require('child_process');
const CRAWL_SCRIPT = path.join(__dirname, 'crawl_events.py');
let crawlRunning = false;
function runCharsCrawl(reason) {
  if (charsRunning) return;
  charsRunning = true;
  const t0 = Date.now();
  execFile(PYTHON_BIN, [CHARS_SCRIPT], { windowsHide: true }, (err, stdout, stderr) => {
    charsRunning = false;
    const tag = '[chars-crawl ' + reason + ']';
    if (err) console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    else console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's |', String(stdout).trim().split('\n').pop());
  });
}
let charsRunning = false;
const CHARS_SCRIPT = path.join(__dirname, 'crawl_characters.py');
function runEventsCrawl(reason) {
  if (crawlRunning) return;
  crawlRunning = true;
  const t0 = Date.now();
  execFile(PYTHON_BIN, [CRAWL_SCRIPT], { windowsHide: true }, (err, stdout, stderr) => {
    crawlRunning = false;
    const tag = '[events-crawl ' + reason + ']';
    if (err) console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    else console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's |', String(stdout).trim().split('\n').pop());
  });
}

// ---- Lantis auto-crawl (umamusume.lantis.jp -> lantis_news.json) ----
const LANTIS_SCRIPT = path.join(__dirname, 'crawl_lantis_news.py');
let lantisRunning = false;
function runLantisCrawl(reason) {
  if (lantisRunning) return;
  lantisRunning = true;
  const t0 = Date.now();
  execFile(PYTHON_BIN, [LANTIS_SCRIPT], { windowsHide: true }, (err, stdout, stderr) => {
    lantisRunning = false;
    const tag = '[lantis-crawl ' + reason + ']';
    if (err) console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    else console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's');
    reloadLantis();
  });
}

// ---- Album auto-crawl (microCMS -> albums.json placeholders; netease enrich) ----
const ALBUMS_SCRIPT = path.join(__dirname, 'auto_albums.py');
let albumsRunning = false;
function runAlbumsCrawl(reason) {
  if (albumsRunning) return;
  albumsRunning = true;
  const t0 = Date.now();
  execFile(PYTHON_BIN, [ALBUMS_SCRIPT], { windowsHide: true }, (err, stdout, stderr) => {
    albumsRunning = false;
    const tag = '[albums-crawl ' + reason + ']';
    if (err) {
      console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    } else {
      const lines = String(stdout || '').trim().split('\n');
      console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's |', lines[lines.length - 1]);
    }
  });
}
