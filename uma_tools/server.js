// Zero-dependency static file server for the 赛马娘 page.
// Usage: node server.js [port] [root] [--no-crawl]
//   --no-crawl disables background data refresh for ordinary local preview.
// News proxy endpoints (official umamusume API lacks CORS headers, front-end calls same-origin):
//   GET /api/news-index            -> merged fresh news list (pages 1..NEWS_TOP)
//   GET /api/news-detail?id=<id>   -> single news detail
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { pipeline } = require('stream');
const { CatalogStore } = require('./catalog-store');
const { mergeNews, NewsContent } = require('./news-content');
const { TranslationCache } = require('./translation-cache');
const { loadTerms, createTerms } = require('./translation-terms');
const { imageStore } = require('./news-images');
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
const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.htm', '.json', '.js', '.mjs', '.css', '.svg']);

function requestAcceptsGzip(req) {
  return String(req.headers['accept-encoding'] || '').split(',').some((entry) => {
    const parts = entry.trim().toLowerCase().split(';');
    if (parts[0] !== 'gzip' && parts[0] !== '*') return false;
    const quality = parts.slice(1).find((part) => part.trim().startsWith('q='));
    return !quality || Number(quality.trim().slice(2)) > 0;
  });
}

const CLI_ARGS = process.argv.slice(2);
const NO_AUTO_CRAWL = CLI_ARGS.includes('--no-crawl');
const POSITIONAL_ARGS = CLI_ARGS.filter((arg) => arg !== '--no-crawl');
const PORT = parseInt(POSITIONAL_ARGS[0] || '8080', 10);
const ROOT = fs.realpathSync(path.resolve(POSITIONAL_ARGS[1] || path.join(__dirname, '..')));
const releaseInfo = fs.existsSync(path.join(ROOT, 'release.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8')) : { commit: 'development' };
const DATA_DIR = path.join(ROOT, 'data');
const catalogStore = new CatalogStore(DATA_DIR);
const loadNewsImage = imageStore(path.join(DATA_DIR, 'news_image_cache'));

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
const NEWS_TTL = 15 * 60 * 1000; // refresh in background; visitors always receive the last complete snapshot
const NEWS_MAX_CONC = 3;        // upstream request concurrency (keep low: CloudFront rate-limits bursts)
const NEWS_SNAPSHOT_FILE = path.join(DATA_DIR, 'news_snapshot.json');

// ---- Lantis (umamusume.lantis.jp) offline crawl ----
// Scraped by crawl_lantis_news.py into data/lantis_news.json. Merged into the news
// index with type "cd" (CD相关). Each item: {id, date, url, title, category}.
// 与官网新闻同一套机制：data/lantis_news.json 是 CD相关 的持久快照（增量维护、热加载），
// 服务内按需 TTL 后台补抓，抓取结果合并进 data/news_snapshot.json，失败保留旧数据并按 TTL 退避。
const LANTIS_FILE = path.join(DATA_DIR, 'lantis_news.json');
const LANTIS_TTL = 30 * 60 * 1000;
const LANTIS_CRAWL_TIMEOUT = 10 * 60 * 1000;
let lantisList = [];
let lantisAt = 0;
let lantisSnapshotMtime = 0;
try {
  lantisList = JSON.parse(fs.readFileSync(LANTIS_FILE, 'utf8'));
  lantisSnapshotMtime = fs.statSync(LANTIS_FILE).mtimeMs;
} catch (e) { lantisList = []; }
function normalizeLantisDate(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  return String(d);
}
function lantisNewsItems() {
  return lantisList.map(function (it) {
    return {
      announce_id: it.id,
      title: it.title,
      title_zh: newsContent.title(it.title, it.title_zh),
      post_at: normalizeLantisDate(it.date),
      announce_label: 4,
      source: 'lantis',
      url: it.url,
      news_type_display: 'CD相关',
      image: it.image || ''
    };
  });
}
function mergeLantis(list) {
  lantisNewsItems().forEach(function (n) { list.push(n); });
  return list;
}
function reloadLantis() {
  let stat = null;
  try { stat = fs.statSync(LANTIS_FILE); } catch (e) { return; }
  try {
    const parsed = JSON.parse(fs.readFileSync(LANTIS_FILE, 'utf8'));
    if (Array.isArray(parsed)) lantisList = parsed;
  } catch (e) { /* keep the last good list */ }
  lantisSnapshotMtime = stat.mtimeMs;
}

let newsIndexCache = { at: 0, data: null };
let newsRefreshPromise = null;
let newsRefreshRevision = 0;
let newsSnapshotMtime = 0;

// Adopt a snapshot only when it is newer than what memory already holds, so a
// an incrementally maintained data/news_snapshot.json becomes visible without a service
// restart and a late write never rolls the list backwards.
function adoptNewsSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.information_list)) return false;
  const currentAt = Date.parse((newsIndexCache.data && newsIndexCache.data.generated_at) || '') || 0;
  const incomingAt = Date.parse(snapshot.generated_at || '') || 0;
  if (!newsIndexCache.data || incomingAt > currentAt) {
    newsIndexCache = { at: Math.max(newsIndexCache.at || 0, incomingAt), data: snapshot };
    return true;
  }
  return false;
}

function reloadNewsSnapshotIfNewer() {
  try {
    const stat = fs.statSync(NEWS_SNAPSHOT_FILE);
    if (stat.mtimeMs <= newsSnapshotMtime) return;
    newsSnapshotMtime = stat.mtimeMs;
    if (adoptNewsSnapshot(JSON.parse(fs.readFileSync(NEWS_SNAPSHOT_FILE, 'utf8')))) {
      console.log('[news] adopted snapshot', newsIndexCache.data.generated_at);
    }
  } catch (error) { /* keep serving the in-memory cache */ }
}

try {
  const stat = fs.statSync(NEWS_SNAPSHOT_FILE);
  newsSnapshotMtime = stat.mtimeMs;
  adoptNewsSnapshot(JSON.parse(fs.readFileSync(NEWS_SNAPSHOT_FILE, 'utf8')));
} catch (e) { /* the first successful refresh creates the snapshot */ }

// ---- machine translation of news titles (Baidu Translate API, cached) ----
const TRANS_CACHE_FILE = path.join(__dirname, 'trans_cache.json');
// Baidu Translate API credentials. Resolution order: env vars > baidu.conf.json.
// The conf file is committed so a fresh clone/pull works out of the box,
// while BAIDU_APPID / BAIDU_SECRET env vars can still override it.
function loadBaiduCreds() {
  const fromEnv = {
    appid: process.env.BAIDU_APPID || '',
    secret: process.env.BAIDU_SECRET || ''
  };
  if (fromEnv.appid && fromEnv.secret) return fromEnv;
  try {
    const f = JSON.parse(fs.readFileSync(path.join(__dirname, 'baidu.conf.json'), 'utf8'));
    return { appid: f.appid || '', secret: f.secret || '' };
  } catch (e) {
    return { appid: '', secret: '' };
  }
}
const _baiduCreds = loadBaiduCreds();
const BAIDU_APPID = _baiduCreds.appid;
const BAIDU_SECRET = _baiduCreds.secret;
const translations = new TranslationCache(TRANS_CACHE_FILE);
let termStamp = '', translationTerms;
function currentTerms() {
  const stamp = ['character_index_data.js', 'voice_actor_profiles.json'].map((file) => fs.statSync(path.join(DATA_DIR, file)).mtimeMs).join(':');
  if (stamp !== termStamp) {
    translationTerms = createTerms(loadTerms(ROOT));
    termStamp = stamp;
  }
  return translationTerms;
}
function translationKey(source) {
  const terms = currentTerms();
  return terms.protect(source).count ? 'terms_' + terms.revision + ':' + source : source;
}
const newsContent = new NewsContent(path.join(__dirname, 'news-overrides.json'), (source) => translations.get(translationKey(source)), (source) => translations.get(source));
let transQueue = [];
let transRunning = false;


let translationRequests = Promise.resolve();
let nextTranslationAt = 0;
function fetchTranslation(text, signal) {
  const result = translationRequests.then(async () => {
    if (signal && signal.aborted) return null;
    const delay = nextTranslationAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (signal && signal.aborted) return null;
    nextTranslationAt = Date.now() + 1100;
    return new Promise((resolve) => {
      const salt = String(Date.now());
      const sign = crypto.createHash('md5').update(BAIDU_APPID + text + salt + BAIDU_SECRET).digest('hex');
      const form = new URLSearchParams({ q: text, from: 'jp', to: 'zh', appid: BAIDU_APPID, salt, sign }).toString();
      let settled = false;
      const abort = () => request.destroy(new Error('cancelled'));
      const finish = (data) => {
        if (settled) return;
        settled = true;
        if (signal) signal.removeEventListener('abort', abort);
        resolve(data);
      };
      const request = https.request('https://fanyi-api.baidu.com/api/trans/vip/translate', {
        method: 'POST', family: 4,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }
      }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => { try { finish(JSON.parse(body)); } catch (error) { finish(null); } });
        response.on('error', () => finish(null));
        response.on('aborted', () => finish(null));
      });
      request.on('error', () => finish(null));
      request.setTimeout(20000, () => request.destroy(new Error('translation timeout')));
      if (signal) {
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }
      request.end(form);
    });
  });
  translationRequests = result.catch(() => null);
  return result;
}

function translateOne(text, attempt, signal) {
  if (signal && signal.aborted) return Promise.resolve('');
  return new Promise((resolve) => {
    const protectedText = currentTerms().protect(text);
    fetchTranslation(protectedText.text, signal).then((j) => {
        try {
          if (j && j.trans_result && j.trans_result.length) {
            const t = j.trans_result.map(function (x) { return x.dst; }).join('');
            resolve(protectedText.restore(t) || '');
            return;
          }
          const code = j && j.error_code;
          if ((code === '54003' || code === '54000') && (attempt || 0) < 3) {
            // rate-limited: wait and retry
            setTimeout(function () {
              translateOne(text, (attempt || 0) + 1, signal).then(resolve);
            }, 1200 * ((attempt || 0) + 1));
            return;
          }
          resolve('');
        } catch (e) { resolve(''); }
    }).catch(() => resolve(''));
  });
}


async function pumpTranslations() {
  if (transRunning) return;
  transRunning = true;
  while (transQueue.length) {
    const item = transQueue.shift();
    // Baidu free tier is ~1 QPS; translate serially with a small delay.
    const key = translationKey(item.text);
    const zh = await translateOne(item.text, 0, item.signal);
    if (zh && zh !== item.text) {
      translations.set(key, zh);
    }
    item.cb(zh || item.text);
    await new Promise((r) => setTimeout(r, 250));
  }
  transRunning = false;
}

function translateTitle(text, cb, signal, background = false) {
  if (!text) return cb(text || '');
  const cached = newsContent.title(text);
  if (cached) return cb(cached);
  if (!BAIDU_APPID || !BAIDU_SECRET) return cb(text);
  const duplicate = transQueue.find((item) => item.text === text && item.signal === signal);
  if (duplicate) {
    const previous = duplicate.cb;
    duplicate.cb = (value) => { previous(value); cb(value); };
    return;
  }
  const item = { text, cb, signal };
  if (background) transQueue.push(item); else transQueue.unshift(item);
  pumpTranslations();
}

// ---- translate HTML body of a news detail (keep tags/links, translate text runs) ----
function hasCjk(s) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(s);
}

function translateBatchLines(lines, cb, signal, attempt = 0) {
  let completed = false;
  const finish = (value) => { if (!completed) { completed = true; cb(value); } };
  // translate multiple short text runs in one Baidu request (newline-joined)
  if (!lines.length) return finish([]);
  const protectedLines = lines.map((line, index) => currentTerms().protect(line, String(index).padStart(4, '0')));
  const text = protectedLines.map((line) => line.text).join('\n');
  if (text.length > 950 || Buffer.byteLength(text) > 5500) return finish(null);
  fetchTranslation(text, signal).then((j) => {
      try {
        if (j && j.trans_result && j.trans_result.length) {
          if (j.trans_result.length !== lines.length) return finish(null);
          const out = [];
          for (let i = 0; i < lines.length; i++) {
            if (j.trans_result[i].src !== protectedLines[i].text) return finish(null);
            const restored = protectedLines[i].restore(j.trans_result[i].dst);
            if (!restored) return finish(null);
            // Ratings are facts. Baidu sometimes adds a star to a leading ★★★.
            const rating = lines[i].match(/^★+/);
            const value = rating ? restored.replace(/^★+/, rating[0]) : restored;
            const numbers = (value) => (value.match(/\d+(?:[/:.]\d+)*/g) || []).sort().join('|');
            if (numbers(j.trans_result[i].dst) !== numbers(protectedLines[i].text)) return finish(null);
            out.push(value);
          }
          return finish(out);
        }
        const code = j && j.error_code;
        if ((code === '54003' || code === '54000') && attempt < 2 && !(signal && signal.aborted)) {
          setTimeout(() => translateBatchLines(lines, finish, signal, attempt + 1), 1200 * (attempt + 1));
          return;
        }
        finish(null);
      } catch (e) { finish(null); }
  }).catch(() => finish(null));
}

function translateHtmlMessage(html, cb, signal) {
  const src = String(html || '');
  if (signal && signal.aborted) return cb('');
  if (!src) return cb('');
  const hash = crypto.createHash('md5').update(src).digest('hex');
  const originalKey = 'msg_' + hash;
  const key = currentTerms().protect(src).count ? 'msg_terms_' + currentTerms().revision + '_' + hash : originalKey;
  const cached = newsContent.message(originalKey) || translations.get(key);
  if (cached && cached !== src) return cb(cached);
  if (!BAIDU_APPID || !BAIDU_SECRET) return cb('');
  // tokenize: alternates text / tag
  const tokens = src.match(/<[^>]+>|[^<]+/g) || [src];
  const runs = []; // Each text node retains its index and ordered fragments.
  tokens.forEach(function (tok, i) {
    if (tok[0] !== '<' && hasCjk(tok) && tok.trim()) {
      const text = tok.trim().replace(/\s*\r?\n\s*/g, ' ');
      for (let start = 0; start < text.length;) {
        let end = Math.min(start + 600, text.length);
        if (end < text.length) {
          const boundary = Math.max(...['。', '！', '？', '. ', ' '].map((mark) => text.lastIndexOf(mark, end - 1)));
          if (boundary > start + 300) end = boundary + 1;
        }
        while (end > start + 1 && currentTerms().protect(text.slice(start, end), '99').text.length > 900) end = start + Math.floor((end - start) / 2);
        runs.push({ idx: i, text: text.slice(start, end) });
        start = end;
      }
    }
  });
  if (!runs.length) {
    translations.set(key, src);
    return cb(src);
  }
  // Limits apply to the protected query, not to the shorter original Japanese.
  const chunks = [];
  let cur = [];
  runs.forEach(function (r) {
    const query = cur.concat(r).map((run, index) => currentTerms().protect(run.text, String(index)).text).join('\n');
    if ((query.length > 950 || Buffer.byteLength(query) > 5500) && cur.length) {
      chunks.push(cur); cur = [];
    }
    cur.push(r);
  });
  if (cur.length) chunks.push(cur);
  const translated = new Map();
  let done = 0;
  let failed = false;
  chunks.forEach(function (chunk, ci) {
    translateBatchLines(chunk.map(function (r) { return r.text; }), function (outs) {
      if (outs === null) {
        failed = true;
        done++;
        if (done === chunks.length) finish();
        return;
      }
      outs.forEach(function (zh, k) {
        if (!zh || (zh === chunk[k].text && /[\u3040-\u30ff]/.test(chunk[k].text))) failed = true;
        translated.set(chunk[k], zh);
      });
      done++;
      if (done === chunks.length) finish();
    }, signal);
  });
  function finish() {
    if (failed || (signal && signal.aborted)) return cb('');
    const textNodes = new Map();
    runs.forEach((run) => textNodes.set(run.idx, (textNodes.get(run.idx) || '') + translated.get(run)));
    const out = tokens.map(function (tok, i) {
      if (textNodes.has(i)) return textNodes.get(i);
      return tok;
    }).join('');
    translations.set(key, out);
    cb(out);
  }
}

function translateArticle(detail, signal, finish) {
  Object.assign(detail, newsContent.apply(detail));
  let remaining = 2, failed = false;
  const complete = () => {
    if (--remaining) return;
    finish(failed ? 503 : 200, failed ? { error: 'translation unavailable' } : { response_code: 1, detail });
  };
  if (detail.title_zh || !detail.title) complete();
  else translateTitle(detail.title, (zh) => {
    if (!zh || (zh === detail.title && /[\u3040-\u30ff]/.test(detail.title))) failed = true;
    else detail.title_zh = zh;
    complete();
  }, signal);
  if (detail.message_zh || !detail.message) complete();
  else translateHtmlMessage(detail.message, (zh) => {
    if (!zh) failed = true;
    else detail.message_zh = zh;
    complete();
  }, signal);
}

function httpsGet(url, cb, signal) {
  const u = new URL(url);
  // cb 只允许调一次：timeout destroy 会同时触发 req/res 的 error 事件，
  // 双回调会让新闻刷新的页计数错乱，造成 promise 永久挂死（所有后续刷新被挡）。
  let settled = false;
  const done = (err, json, body) => {
    if (settled) return;
    settled = true;
    if (signal) signal.removeEventListener('abort', abort);
    cb(err, json, body);
  };
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
      done(null, json, body);
    });
    res.on('error', (e) => done(e, null, null));
    res.on('aborted', () => done(new Error('upstream response aborted'), null, null));
  });
  const abort = () => req.destroy(new Error('cancelled'));
  req.on('error', (e) => done(e, null, null));
  if (signal) {
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  }
  req.setTimeout(20000, function () {
    try { req.destroy(new Error('timeout')); } catch (e) {}
    done(new Error('timeout'), null, null);
  });
  req.end();
}

// Fetch a page and return its raw HTML text (used by the Lantis detail crawler).
function httpsGetHtml(url, cb, redirects, signal) {
  let completed = false;
  let abort;
  const done = (err, body) => {
    if (!completed) { completed = true; if (signal && abort) signal.removeEventListener('abort', abort); cb(err, body); }
  };
  if ((redirects || 0) > 5) { done(new Error('too many redirects')); return; }
  let u;
  try { u = new URL(url); } catch (e) { done(new Error('bad url')); return; }
  const req = https.request(u, {
    method: 'GET',
    family: 4,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      try { httpsGetHtml(new URL(res.headers.location, u).href, done, (redirects || 0) + 1, signal); }
      catch (error) { done(error); }
      return;
    }
    if (res.statusCode !== 200) { res.resume(); done(new Error('HTTP ' + res.statusCode)); return; }
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks).toString('utf8')));
    res.on('error', (e) => done(e, null));
    res.on('aborted', () => done(new Error('upstream response aborted')));
  });
  abort = () => req.destroy(new Error('cancelled'));
  req.on('error', (e) => done(e, null));
  if (signal) {
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  }
  req.setTimeout(20000, function () { try { req.destroy(new Error('timeout')); } catch (e) {} });
  req.end();
}

function sendJson(res, code, obj, options) {
  if (res.destroyed || res.writableEnded) return;
  const settings = options || {};
  const body = Buffer.from(JSON.stringify(obj));
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': settings.cacheControl || 'no-store',
    'Access-Control-Allow-Origin': '*'
  }, settings.headers || {});
  if (settings.etag) headers.ETag = settings.etag;
  if (settings.etag && res.req && res.req.headers['if-none-match'] === settings.etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const finish = (payload, compressed) => {
    if (res.destroyed || res.writableEnded) return;
    if (compressed) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
    }
    headers['Content-Length'] = payload.length;
    res.writeHead(code, headers);
    res.end(payload);
  };
  if (body.length >= 1024 && res.req && requestAcceptsGzip(res.req)) {
    zlib.gzip(body, (err, compressed) => finish(err ? body : compressed, !err));
  } else {
    finish(body, false);
  }
}

function handleHomeSummary(res) {
  catalogStore.home()
    .then((data) => sendJson(res, 200, data, {
      cacheControl: 'public, max-age=60, stale-while-revalidate=600',
      etag: catalogEtag(data.build_id, 'home:' + new Date().toDateString())
    }))
    .catch(() => sendJson(res, 500, { error: 'home summary unavailable' }));
}

function catalogEtag(buildId, scope) {
  const digest = crypto.createHash('sha1').update(String(scope || '')).digest('hex').slice(0, 12);
  return '"catalog-' + buildId + '-' + digest + '"';
}

function sendCatalogResult(req, res, result, scope) {
  if (!result) {
    sendJson(res, 404, { error: 'catalog entry not found' });
    return;
  }
  sendJson(res, 200, result, {
    cacheControl: 'public, max-age=300, stale-while-revalidate=300',
    etag: catalogEtag(result.build_id, scope + (req.url.startsWith('/api/catalog/events') ? ':' + new Date().toDateString() : ''))
  });
}

async function handleCatalogApi(req, res, urlPath, params) {
  try {
    let result;
    if (urlPath === '/api/catalog/events') result = await catalogStore.events(params);
    else if (urlPath === '/api/catalog/event') result = await catalogStore.event(params.get('id'), params.get('legacy'));
    else if (urlPath === '/api/catalog/songs') result = await catalogStore.songs(params);
    else if (urlPath === '/api/catalog/song') result = await catalogStore.song(params.get('id'));
    else if (urlPath === '/api/catalog/creators') result = await catalogStore.creators(params);
    else if (urlPath === '/api/catalog/creator') result = await catalogStore.creator(params.get('id'));
    else if (urlPath === '/api/catalog/albums') result = await catalogStore.albums(params);
    else if (urlPath === '/api/catalog/album') result = await catalogStore.album(params.get('id'), params.get('name'));
    else if (urlPath === '/api/catalog/voice-actors') result = await catalogStore.voices();
    else if (urlPath === '/api/catalog/appearance') {
      const type = params.get('type');
      if (type !== 'character' && type !== 'voice_actor') {
        sendJson(res, 400, { error: 'invalid appearance type' });
        return;
      }
      result = await catalogStore.appearance(type, params.get('id') || '');
    } else {
      sendJson(res, 404, { error: 'unknown catalog endpoint' });
      return;
    }
    sendCatalogResult(req, res, result, req.url);
  } catch (error) {
    sendJson(res, 503, { error: 'catalog temporarily unavailable' });
  }
}

function fetchNewsPage(page, cb) {
  httpsGet(NEWS_INDEX_URL + '&page=' + page, (err, json) => {
    if (err || !json || json.response_code !== 1) { cb(err || new Error('bad page')); return; }
    cb(null, json);
  });
}

// One flaky page must not reject the whole index refresh; retry before giving up.
function fetchNewsPageRetry(page, cb, attempt) {
  fetchNewsPage(page, (err, json) => {
    if (!err) { cb(null, json); return; }
    if ((attempt || 0) < 2) {
      setTimeout(() => fetchNewsPageRetry(page, cb, (attempt || 0) + 1), 800 * ((attempt || 0) + 1));
      return;
    }
    cb(new Error('page ' + page + ': ' + ((err && err.message) || err)));
  });
}

function extractFirstImage(html) {
  if (!html || typeof html !== 'string') return '';
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
const BACKFILL_CONC = 3;
const BACKFILL_TIMEOUT = 10000;
function backfillNewsImages(list, cb) {
  const need = list.filter((n) => n.announce_label === 3 && !n.image && n.announce_id);
  if (!need.length) { cb(); return; }
  let idx = 0, active = 0, done = 0, finished = false;
  const finish = () => { if (!finished) { finished = true; cb(); } };
  function pump() {
    while (active < BACKFILL_CONC && idx < need.length) {
      const item = need[idx++];
      active++;
      httpsGet(NEWS_DETAIL_URL + '&announce_id=' + item.announce_id, (err, json) => {
        active--;
        if (finished) return;
        if (!err && json && json.detail) {
          const d = json.detail;
          const img = d.image || d.image_big || extractFirstImage(d.message) || '';
          if (img) item.image = img;
        }
        done++;
        if (done === need.length) finish();
        else pump();
      });
    }
  }
  pump();
  setTimeout(() => { if (!finished) finish(); }, BACKFILL_TIMEOUT);
}

let newsSnapshotWrite = Promise.resolve();
function persistNewsSnapshot(data) {
  const body = JSON.stringify(data);
  newsSnapshotWrite = newsSnapshotWrite.then(async () => {
    const tempPath = NEWS_SNAPSHOT_FILE + '.' + process.pid + '.tmp';
    try {
      await fs.promises.writeFile(tempPath, body, { mode: 0o644 });
      await fs.promises.rename(tempPath, NEWS_SNAPSHOT_FILE);
    } catch (error) {
      console.error('[news] snapshot write failed:', error.message || error);
      await fs.promises.unlink(tempPath).catch(() => {});
    }
  });
  return newsSnapshotWrite;
}

// CD相关 合并进快照：用当前快照里的官网条目 + 最新 CD相关 条目重建合并列表，
// 与 refreshNewsIndex 的 publish() 同一套排序与翻译回填，然后原子写回 news_snapshot.json。
// 不重抓官网接口，也不推进 newsIndexCache.at（新闻 TTL 与 CD TTL 各自独立）。
function publishLantisMerge() {
  const current = newsIndexCache.data;
  if (!current || !Array.isArray(current.information_list)) return false;
  const merged = mergeNews(current.information_list, lantisNewsItems()).map((item) => newsContent.apply(item));
  merged.sort((a, b) => String(b.update_at || b.post_at).localeCompare(String(a.update_at || a.post_at)));
  if (JSON.stringify(merged) === JSON.stringify(current.information_list)) return false;
  const data = Object.assign({}, current, {
    information_list: merged,
    generated_at: new Date().toISOString()
  });
  newsIndexCache = { at: newsIndexCache.at, data };
  // --no-crawl 预览只并入内存，不改写数据文件；自动刷新模式才落盘发布。
  if (!NO_AUTO_CRAWL) persistNewsSnapshot(data);
  console.log('[lantis] merged', lantisList.length, 'cd items into news snapshot', data.generated_at);
  return true;
}

// 与 news_snapshot.json 相同的热加载：data/lantis_news.json 被 git 部署/手工更新后免重启生效，
// 并把 CD相关 直接合并进新闻快照。
function reloadLantisIfNewer() {
  try {
    const stat = fs.statSync(LANTIS_FILE);
    if (stat.mtimeMs <= lantisSnapshotMtime) return;
    reloadLantis();
    // 部署进来的快照视为“刚抓过”，避免立刻又触发一轮 TTL 补抓。
    lantisAt = Math.max(lantisAt, stat.mtimeMs);
    console.log('[lantis] adopted snapshot', lantisList.length, 'items');
    publishLantisMerge();
  } catch (e) { /* keep serving the in-memory list */ }
}

function refreshNewsIndex() {
  if (newsRefreshPromise) return newsRefreshPromise;
  const revision = ++newsRefreshRevision;
  // 看门狗：即使底层挂死，也在 3 分钟后强制落地并释放 promise，
  // 否则一次挂死会永久挡住所有后续刷新（且不留任何日志）。
  let rejectRef = null;
  const watchdog = setTimeout(() => {
    if (rejectRef) {
      newsRefreshRevision += 1;
      newsIndexCache = { at: Date.now(), data: newsIndexCache.data };
      console.error('[news] refresh watchdog fired (180s), aborting');
      const reject = rejectRef;
      rejectRef = null;
      reject(new Error('refresh watchdog (180s)'));
    }
  }, 180000);
  const refresh = new Promise((resolve, reject) => {
    // On failure, push the freshness marker forward so visitor traffic cannot
    // hammer the upstream while it is down (retry at most once per NEWS_TTL).
    const fail = (err) => {
      if (revision !== newsRefreshRevision) return;
      newsIndexCache = { at: Date.now(), data: newsIndexCache.data };
      if (rejectRef) { const r = rejectRef; rejectRef = null; r(err); }
    };
    rejectRef = reject;
    fetchNewsPageRetry(1, (err, first) => {
      if (revision !== newsRefreshRevision) return;
      if (err) { fail(err); return; }
      const total = parseInt(first.total_page_count, 10) || 1;
      const slots = new Array(total);
      slots[0] = first.information_list || [];
      let done = 1;
      let failed = false;
      let active = 0;
      let cursor = total;

      function pump() {
        if (done === total) {
          publish();
          return;
        }
        while (active < NEWS_MAX_CONC && cursor >= 2) {
          const page = cursor--;
          active++;
          fetchNewsPageRetry(page, (pageError, json) => {
            active--;
            if (failed || revision !== newsRefreshRevision) return;
            if (pageError) {
              failed = true;
              fail(pageError);
              return;
            }
            slots[page - 1] = json.information_list || [];
            done++;
            if (done !== total) { pump(); return; }
            publish();
          });
        }
      }

      function publish() {
        if (revision !== newsRefreshRevision) return;
        const seen = new Set();
        const incoming = [];
        for (let index = 1; index <= total; index++) {
          (slots[index - 1] || []).forEach((item) => {
            if (!seen.has(String(item.announce_id))) {
              seen.add(String(item.announce_id));
              incoming.push(item);
            }
          });
        }
        mergeLantis(incoming);
        const list = mergeNews((newsIndexCache.data && newsIndexCache.data.information_list) || [], incoming).map((item) => newsContent.apply(item));
        list.sort((a, b) => String(b.update_at || b.post_at).localeCompare(String(a.update_at || a.post_at)));
        const data = {
          response_code: 1,
          information_list: list,
          total_page_count: total,
          generated_at: new Date().toISOString()
        };
        newsIndexCache = { at: Date.now(), data };
        persistNewsSnapshot(data);
        console.log('[news] refreshed', list.length, 'items', data.generated_at);
        resolve(data);

        // Image discovery and translation improve the next response but never
        // delay the list currently being read by a visitor.
        const imageRows = list.map((item) => Object.assign({}, item));
        backfillNewsImages(imageRows, () => {
          const current = newsIndexCache.data;
          if (!current) return;
          const images = new Map(imageRows.filter((item) => item.image).map((item) => [String(item.announce_id), item.image]));
          let changed = false;
          const items = current.information_list.map((item) => {
            const image = images.get(String(item.announce_id));
            if (item.image || !image) return item;
            changed = true;
            return Object.assign({}, item, { image });
          });
          if (changed) {
            const updated = Object.assign({}, current, { information_list: items });
            newsIndexCache = { at: newsIndexCache.at, data: updated };
            persistNewsSnapshot(updated);
          }
        });
        list.filter((item) => !newsContent.title(item.title)).slice(0, 20).forEach((item) => {
          translateTitle(item.title, function () {}, undefined, true);
        });
      }
      pump();
    });
  }).finally(() => { clearTimeout(watchdog); if (newsRefreshPromise === refresh) newsRefreshPromise = null; });
  newsRefreshPromise = refresh;
  return refresh;
}

function newsResponseSnapshot() {
  reloadNewsSnapshotIfNewer();
  reloadLantisIfNewer();
  if (!newsIndexCache.data) return null;
  const cached = JSON.parse(JSON.stringify(newsIndexCache.data));
  cached.information_list = cached.information_list.map((item) => newsContent.apply(item));
  return cached;
}

function handleNewsIndex(res) {
  const cached = newsResponseSnapshot();
  if (cached) {
    sendJson(res, 200, cached, {
      cacheControl: 'public, max-age=60, stale-while-revalidate=300',
      etag: '"news-' + crypto.createHash('sha1').update(JSON.stringify(cached)).digest('hex').slice(0, 12) + '"'
    });
    if (!NO_AUTO_CRAWL) {
      // CD相关 与官网新闻各自按需 TTL 补抓，互不牵制。
      ensureLantisFresh();
      if (Date.now() - newsIndexCache.at >= NEWS_TTL) {
        refreshNewsIndex().catch((error) => {
          console.error('[news] background refresh failed:', (error && error.message) || error);
        });
      }
    }
    return;
  }
  if (NO_AUTO_CRAWL) { sendJson(res, 503, { error: 'news snapshot unavailable' }); return; }
  refreshNewsIndex()
    .then((data) => sendJson(res, 200, data, { cacheControl: 'public, max-age=60, stale-while-revalidate=300' }))
    .catch((error) => {
      console.error('[news] refresh failed:', (error && error.message) || error);
      sendJson(res, 502, { error: 'upstream news index failed' });
    });
}

const articleCache = new Map();
const articleRequests = new Map();
function applyArticleEdits(data) {
  if (!data.detail) return data;
  const detail = newsContent.apply(data.detail);
  if (detail.message) {
    const key = 'msg_' + crypto.createHash('md5').update(detail.message).digest('hex');
    const edited = newsContent.message(key);
    if (edited) detail.message_zh = edited;
  }
  return { ...data, detail };
}
function serveArticle(key, res, load) {
  const cached = articleCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) { sendJson(res, 200, applyArticleEdits(cached.data)); return; }
  if (cached) articleCache.delete(key);
  let pending = articleRequests.get(key);
  const fresh = !pending;
  if (!pending) {
    pending = { controller: new AbortController(), responses: new Set() };
    articleRequests.set(key, pending);
  }
  pending.responses.add(res);
  res.once('close', () => {
    pending.responses.delete(res);
    if (articleRequests.get(key) === pending && !pending.responses.size) {
      articleRequests.delete(key);
      pending.controller.abort();
    }
  });
  if (!fresh) return;
  load(pending.controller.signal, (status, data) => {
    if (articleRequests.get(key) !== pending) return;
    articleRequests.delete(key);
    if (status === 200) {
      articleCache.set(key, { at: Date.now(), data });
      if (articleCache.size > 128) articleCache.delete(articleCache.keys().next().value);
    }
    const result = status === 200 ? applyArticleEdits(data) : data;
    pending.responses.forEach((response) => sendJson(response, status, result));
    pending.responses.clear();
  });
}

function handleNewsDetail(req, res, params) {
  const id = parseInt((params.get('id') || ''), 10);
  if (!id) { sendJson(res, 400, { error: 'missing id' }); return; }
  serveArticle('official-' + id, res, (signal, finish) => {
    httpsGet(NEWS_DETAIL_URL + '&announce_id=' + id, (err, json) => {
      if (err || !json || json.response_code !== 1) {
        finish(502, { error: 'upstream detail failed' });
        return;
      }
      if (!json.detail) return finish(502, { error: 'missing upstream detail' });
      translateArticle(json.detail, signal, (status, data) => finish(status, status === 200 ? { ...json, detail: data.detail } : data));
    }, signal);
  });
}

// ---- Lantis news: re-run the scraper on demand, then return the merged list ----
function ensureLantisFresh() {
  if (NO_AUTO_CRAWL || lantisRunning) return;
  if (Date.now() - lantisAt < LANTIS_TTL) return;
  runLantisCrawl('auto');
}

function handleLantisNews(res) {
  reloadLantisIfNewer();
  ensureLantisFresh();
  // Serve the last complete CD snapshot immediately (same shape as the news index).
  const items = lantisNewsItems();
  sendJson(res, 200, { response_code: 1, information_list: items }, {
    cacheControl: 'public, max-age=60, stale-while-revalidate=300',
    etag: '"lantis-' + crypto.createHash('sha1').update(JSON.stringify(items)).digest('hex').slice(0, 12) + '"'
  });
}

// ---- Lantis detail: crawl the article page and return title + body (+ zh translation) ----
function handleLantisDetail(req, res, params) {
  const raw = (params.get('id') || '').toString();
  const digits = String(raw).replace(/^lantis-/, '').replace(/\D/g, '');
  if (!digits) { sendJson(res, 400, { error: 'missing id' }); return; }
  const it = lantisList.find(function (x) { return x.id === 'lantis-' + digits || x.id === raw; });
  const url = (it && it.url) || ('https://umamusume.lantis.jp/news/' + digits + '/');
  serveArticle('lantis-' + digits, res, (signal, finish) => {
    httpsGetHtml(url, function (err, body) {
      if (err || !body) { finish(502, { error: 'upstream lantis detail failed' }); return; }
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
                 body.match(/<title>([^<]*)<\/title>/i);
      if (tm) detail.title = cleanHtml(tm[1]).trim();
      const inner = extractInnercon(body) || '';
      detail.message = inner;
      translateArticle(detail, signal, finish);
    }, 0, signal);
  });
}
function cleanHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); }
function extractInnercon(body) {
  const i = body.indexOf('class="innercon"');
  if (i === -1) return null;
  const start = body.indexOf('>', i) + 1;
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
const METING_HOSTS = new Set(['api.injahow.cn', 'met.liiiu.cn', 'api.baka.plus', 'meting.mikus.ink']);

function isAllowedAudioUrl(value) {
  let u;
  try { u = new URL(value); } catch (e) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return METING_HOSTS.has(host) || host === 'music.163.com' || host === 'music.126.net' || host.endsWith('.music.126.net');
}

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

function audioFetchOnce(url, headers, cb, hops, onRequest) {
  hops = hops || 0;
  let u;
  try { u = new URL(url); } catch (e) { cb(new Error('bad url')); return null; }
  if (!isAllowedAudioUrl(u.href)) { cb(new Error('audio host not allowed')); return null; }
  const mod = u.protocol === 'http:' ? http : https;
  let called = false;
  const done = (err, r, pref) => { if (called) return; called = true; cb(err, r, pref); };
  const pref = mod.get(u, { headers: headers, family: 4 }, (r) => {
    // Meting mirrors answer type=url with a 302 to the real CDN audio; follow it.
    if (hops < 5 && r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
      r.resume();
      const next = new URL(r.headers.location, u).href;
      audioFetchOnce(next, headers, done, hops + 1, onRequest);
      return;
    }
    done(null, r, pref);
  });
  if (onRequest) onRequest(pref);
  pref.on('error', (e) => done(e, null, pref));
  pref.setTimeout(20000, function () { try { pref.destroy(new Error('timeout')); } catch (e) {} });
  return pref;
}

function handleAudioProxy(req, res, params) {
  const target = params.get('url');
  if (!target || !isAllowedAudioUrl(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bad audio url');
    return;
  }
  const candidates = metingCandidates(target);
  let idx = 0;
  let activeUpstream = null;
  let activeResponse = null;
  let clientClosed = false;

  function tryNext() {
    if (clientClosed) return;
    if (idx >= candidates.length) {
      try { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('audio proxy failed'); } catch (e) {}
      return;
    }
    const url = candidates[idx++];
    const headers = { 'User-Agent': AUDIO_UA, 'Referer': 'https://music.163.com/' };
    if (req.headers.range) headers.Range = req.headers.range;
    audioFetchOnce(url, headers, (err, r, pref) => {
      if (clientClosed) { try { if (pref) pref.destroy(); } catch (e) {} return; }
      if (err || !r) { try { if (pref) pref.destroy(); } catch (e) {} tryNext(); return; }
      const ct = String(r.headers['content-type'] || '');
      const isAudio = /audio\//i.test(ct) || /octet-stream/i.test(ct);
      const bad = r.statusCode >= 400 || (!isAudio && /html|json|text/i.test(ct));
      const invalidRange = r.statusCode === 206 && !r.headers['content-range'];
      if (bad || invalidRange) {
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
        activeResponse = r;
        pipeline(r, res, function (streamError) {
          activeResponse = null;
          if (streamError && !clientClosed && !res.writableEnded) {
            try { res.destroy(streamError); } catch (e) {}
          }
        });
      } catch (e) { try { if (pref) pref.destroy(); } catch (e2) {} }
    }, 0, function (pref) { activeUpstream = pref; });
  }
  res.on('close', () => {
    clientClosed = true;
    try { if (activeResponse) activeResponse.destroy(); } catch (e) {}
    try { if (activeUpstream) activeUpstream.destroy(); } catch (e) {}
  });
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

  if (req.method === 'GET' && urlPath === '/api/release') return sendJson(res, 200, { commit: releaseInfo.commit }, { cacheControl: 'no-store' });
  if (req.method === 'GET' && urlPath === '/api/news-index') return handleNewsIndex(res);
  if (req.method === 'GET' && urlPath === '/api/home-summary') return handleHomeSummary(res);
  if (req.method === 'GET' && urlPath.startsWith('/api/catalog/')) return handleCatalogApi(req, res, urlPath, params);
  if (req.method === 'GET' && urlPath === '/api/news-detail') return handleNewsDetail(req, res, params);
  if (req.method === 'GET' && urlPath === '/api/news-image') {
    loadNewsImage(params.get('url')).then(({ bytes, extension }) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': MIME[extension], 'Content-Length': bytes.length, 'Cache-Control': 'public, max-age=3600' });
      res.end(bytes);
    }).catch((error) => sendJson(res, error.message === 'unsupported news image' ? 400 : 502, { error: error.message }));
    return;
  }
  if (req.method === 'GET' && urlPath === '/api/lantis-news') return handleLantisNews(res);
  if (req.method === 'GET' && urlPath === '/api/lantis-detail') return handleLantisDetail(req, res, params);
  if (req.method === 'GET' && urlPath === '/api/audio') return handleAudioProxy(req, res, params);
  if (urlPath.startsWith('/api/')) return sendJson(res, 404, { error: 'unknown api endpoint' });

  if (urlPath === '/') {
    res.writeHead(302, { Location: '/zh-Hans/', 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }
  if (urlPath === '/zh-Hans') {
    res.writeHead(301, { Location: '/zh-Hans/', 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }
  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!isInsideRoot(filePath)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // History-mode fallback: if the path looks like a client route (no file extension),
      // serve the SPA index so deep links / refreshes work.
      if (!path.extname(urlPath)) {
        filePath = path.join(ROOT, INDEX_FILE);
        return serveFile(filePath, req, res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }
    serveFile(filePath, req, res);
  });
});

function serveFile(filePath, req, res) {
  fs.stat(filePath, (err2, st2) => {
    if (err2 || !st2.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const requestUrl = new URL(req.url, 'http://x');
    const versioned = /^\/assets\/[a-f0-9]{16}\.(?:js|css)$/.test(requestUrl.pathname);
    const isHtml = ext === '.html' || ext === '.htm';
    const isMedia = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.ico'].includes(ext);
    const cacheControl = isHtml
      ? 'no-cache'
      : requestUrl.pathname.startsWith('/data/') && ext !== '.js'
        ? 'public, max-age=3600, stale-while-revalidate=86400'
      : versioned
        ? 'public, max-age=31536000, immutable'
        : isMedia ? 'public, max-age=2592000, stale-while-revalidate=86400' : 'no-cache';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      'Last-Modified': st2.mtime.toUTCString()
    };
    const ifModifiedSince = Date.parse(req.headers['if-modified-since'] || '');
    if (!isNaN(ifModifiedSince) && Math.floor(st2.mtimeMs / 1000) <= Math.floor(ifModifiedSince / 1000)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const shouldCompress = st2.size >= 1024 && COMPRESSIBLE_EXTENSIONS.has(ext) && requestAcceptsGzip(req);
    if (shouldCompress) {
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
    } else {
      headers['Content-Length'] = st2.size;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const input = fs.createReadStream(filePath);
    const streams = shouldCompress ? [input, zlib.createGzip(), res] : [input, res];
    pipeline(...streams, (error) => { if (error && !res.destroyed) res.destroy(error); });
  });
}

server.listen(PORT, () => {
  console.log('Serving ' + ROOT + '  ->  http://localhost:' + PORT + '/');
  console.log('News proxy ready: /api/news-index  /api/news-detail?id=xxx  /api/lantis-news  /api/audio?url=...');
  reloadLantis();
  catalogStore.get().catch((error) => console.error('[catalog:warm]', error.message));
  if (NO_AUTO_CRAWL) {
    console.log('Automatic data refresh disabled (--no-crawl).');
    return;
  }
  refreshNewsIndex().catch((error) => {
    console.error('[news] startup refresh failed:', (error && error.message) || error);
  });
  setTimeout(() => runCatalogRefresh('startup'), 60 * 1000);
  setTimeout(() => ensureLantisFresh(), 5 * 1000);
  setInterval(() => runCatalogRefresh('scheduled'), 6 * 60 * 60 * 1000);
  // 定时自愈：访客触发之外每 30 分钟主动刷一次新闻/CD相关，挂死/失败也能自行恢复
  setInterval(() => {
    ensureLantisFresh();
    refreshNewsIndex().catch((error) => {
      console.error('[news] scheduled refresh failed:', (error && error.message) || error);
    });
  }, 30 * 60 * 1000);
});

// ---- Events auto-crawl (Eventernote -> events_data.json) ----
const { execFile } = require('child_process');
const CRAWL_SCRIPT = path.join(__dirname, 'crawl_events.py');
const OFFICIAL_PROGRAM_SCRIPT = path.join(__dirname, 'crawl_official_programs.py');
const CATALOG_CRAWL_TIMEOUT = 60 * 60 * 1000;
let crawlRunning = false;
let catalogRefreshRunning = false;
let catalogRefreshQueued = false;
function runCatalogRefresh(reason) {
  if (catalogRefreshRunning) {
    catalogRefreshQueued = true;
    return;
  }
  catalogRefreshRunning = true;
  runCharsCrawl(reason, () => runEventsCrawl(reason, () => runAlbumsCrawl(reason, () => runEventBuild(reason, () => {
    catalogRefreshRunning = false;
    if (catalogRefreshQueued) {
      catalogRefreshQueued = false;
      runCatalogRefresh('queued');
    }
  }))));
}

function runCharsCrawl(reason, done) {
  if (charsRunning) { if (done) done(); return; }
  charsRunning = true;
  const t0 = Date.now();
  execFile(PYTHON_BIN, [CHARS_SCRIPT], { windowsHide: true, timeout: CATALOG_CRAWL_TIMEOUT }, (err, stdout, stderr) => {
    charsRunning = false;
    const tag = '[chars-crawl ' + reason + ']';
    if (err) console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    else console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's |', String(stdout).trim().split('\n').pop());
    if (done) done();
  });
}
let charsRunning = false;
const CHARS_SCRIPT = path.join(__dirname, 'crawl_characters.py');
function runEventsCrawl(reason, done) {
  if (crawlRunning) { if (done) done(); return; }
  crawlRunning = true;
  const t0 = Date.now();
  execFile(PYTHON_BIN, [CRAWL_SCRIPT], { windowsHide: true, timeout: CATALOG_CRAWL_TIMEOUT }, (err, stdout, stderr) => {
    const tag = '[events-crawl ' + reason + ']';
    if (err) {
      console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    } else {
      console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's |', String(stdout).trim().split('\n').pop());
    }
    crawlRunning = false;
    if (done) done();
  });
}

function runEventBuild(reason, done) {
  const t0 = Date.now();
  // Program discovery rebuilds and validates the unified catalogs itself.
  // Voice-actor biographies are a slower, separately reviewed maintenance job
  // and must not be re-scraped by every six-hour event refresh.
  execFile(PYTHON_BIN, [OFFICIAL_PROGRAM_SCRIPT], { windowsHide: true, timeout: CATALOG_CRAWL_TIMEOUT }, (err, stdout, stderr) => {
    const tag = '[events-build ' + reason + ']';
    if (err) {
      console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    } else {
      console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's |', String(stdout).trim().split('\n')[0]);
    }
    if (done) done();
  });
}

// ---- Lantis auto-crawl (umamusume.lantis.jp -> data/lantis_news.json) ----
const LANTIS_SCRIPT = path.join(__dirname, 'crawl_lantis_news.py');
let lantisRunning = false;
function runLantisCrawl(reason) {
  if (lantisRunning) return;
  lantisRunning = true;
  const t0 = Date.now();
  execFile(PYTHON_BIN, [LANTIS_SCRIPT], { windowsHide: true, timeout: LANTIS_CRAWL_TIMEOUT }, (err, stdout, stderr) => {
    lantisRunning = false;
    const tag = '[lantis-crawl ' + reason + ']';
    if (err) console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    else console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's');
    reloadLantis();
    // 失败同样推进 TTL 标记（与新闻 fail() 相同的退避）：上游挂掉时最多每个 TTL 重试一次。
    lantisAt = Date.now();
    // 抓取结果直接合并进 news_snapshot.json，不再重抓官网新闻来完成合并。
    if (!err) publishLantisMerge();
  });
}

// ---- Album auto-crawl (microCMS -> albums.json placeholders; netease enrich) ----
const ALBUMS_SCRIPT = path.join(__dirname, 'auto_albums.py');
let albumsRunning = false;
function runAlbumsCrawl(reason, done) {
  if (albumsRunning) { if (done) done(); return; }
  albumsRunning = true;
  const t0 = Date.now();
  execFile(PYTHON_BIN, [ALBUMS_SCRIPT], { windowsHide: true, timeout: CATALOG_CRAWL_TIMEOUT }, (err, stdout, stderr) => {
    albumsRunning = false;
    const tag = '[albums-crawl ' + reason + ']';
    if (err) {
      console.log(tag, 'FAILED:', String(stderr || err.message || '').trim().split('\n').pop());
    } else {
      const lines = String(stdout || '').trim().split('\n');
      console.log(tag, 'done in ' + ((Date.now() - t0) / 1000 | 0) + 's |', lines[lines.length - 1]);
    }
    if (done) done();
  });
}
