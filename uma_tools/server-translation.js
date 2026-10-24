// translation service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  const TRANS_CACHE_FILE = deps.path.join(
    deps.ROOT,
    "data",
    "auto_update",
    "trans_cache.json",
  );

  function loadBaiduCreds() {
    const fromEnv = {
      appid: process.env.BAIDU_APPID || "",
      secret: process.env.BAIDU_SECRET || "",
    };
    if (fromEnv.appid && fromEnv.secret) return fromEnv;
    try {
      const f = JSON.parse(
        deps.fs.readFileSync(
          deps.path.join(__dirname, "baidu.conf.json"),
          "utf8",
        ),
      );
      return { appid: f.appid || "", secret: f.secret || "" };
    } catch (e) {
      return { appid: "", secret: "" };
    }
  }

  const _baiduCreds = loadBaiduCreds();

  const BAIDU_APPID = _baiduCreds.appid;

  const BAIDU_SECRET = _baiduCreds.secret;
  const statusFile = deps.path.join(deps.DATA_DIR, 'auto_update', 'translation_status.json');
  let blockedUntil = 0;
  let blockedCode = '';
  try {
    const status = JSON.parse(deps.fs.readFileSync(statusFile, 'utf8'));
    blockedUntil = status.blocked_until || 0;
    blockedCode = String(status.code || '');
    if (blockedCode === '54004') blockedUntil = Infinity;
  } catch (_) {}

  const translations = new deps.TranslationCache(
    TRANS_CACHE_FILE,
    deps.path.join(__dirname, "trans_cache.json"),
  );

  let termStamp = "",
    translationTerms;
  let termsCheckedAt = 0;

  function currentTerms() {
    if (translationTerms && Date.now() - termsCheckedAt < 1000) return translationTerms;
    termsCheckedAt = Date.now();
    const stamp = ["character_index_data.js", "voice_actor_profiles.json", "events_catalog.json", "anime/works.json"]
      .map(
        (file) => deps.fs.statSync(deps.path.join(deps.DATA_DIR, file)).mtimeMs,
      )
      .concat(deps.fs.statSync(deps.path.join(__dirname, 'translation-glossary.json')).mtimeMs)
      .join(":");
    if (stamp !== termStamp) {
      translationTerms = deps.createTerms(deps.loadTerms(deps.ROOT));
      termStamp = stamp;
    }
    return translationTerms;
  }

  function translationKey(source) {
    const terms = currentTerms();
    return translationKeyWithTerms(source, terms);
  }

  function translationKeyWithTerms(source, terms) {
    return terms.protect(source).count
      ? "terms_" + terms.revision + ":" + source
      : source;
  }

  function cachedTranslation(source) {
    const terms = currentTerms();
    const key = translationKeyWithTerms(source, terms);
    let cached = translations.get(key) || translations.get('fragment:' + key) || translations.get(source) || translations.get('fragment:' + source);
    if (!cached && terms.protect(source).count && typeof translations.findBySuffix === 'function') {
      cached = translations.findBySuffix(':' + source, 'terms_') || translations.findBySuffix(':' + source, 'fragment:terms_');
    }
    if (!cached) return '';
    const { translationFactsMatch, untranslatedJapanese } = require('./translation-facts');
    const value = terms.normalize(cached);
    return value && value !== source && translationFactsMatch(source, value) && !untranslatedJapanese(source, value)
      ? value : '';
  }

  const newsContent = new deps.NewsContent(
    deps.path.join(__dirname, "news-overrides.json"),
    (source) => cachedTranslation(source),
    (source) => translations.get(source),
  );

  let transQueue = [];

  let transRunning = false;
  const titlePending = new Map();

  const translationScheduler =
    new (require("./translation-queue").TranslationQueue)();

  let nextTranslationAt = 0;

  function fetchTranslation(text, signal) {
    if (Date.now() < blockedUntil) return Promise.resolve(null);
    const result = translationScheduler.run(
      async (signal) => {
        if ((signal && signal.aborted) || Date.now() < blockedUntil) return null;
        const delay = nextTranslationAt - Date.now();
        if (delay > 0)
          await new Promise((resolve) => setTimeout(resolve, delay));
        if (signal && signal.aborted) return null;
        nextTranslationAt = Date.now() + 1100;
        return new Promise((resolve) => {
          const salt = String(Date.now());
          const sign = deps.crypto
            .createHash("md5")
            .update(BAIDU_APPID + text + salt + BAIDU_SECRET)
            .digest("hex");
          const form = new URLSearchParams({
            q: text,
            from: "jp",
            to: "zh",
            appid: BAIDU_APPID,
            salt,
            sign,
          }).toString();
          let settled = false;
          const abort = () => request.destroy(new Error("cancelled"));
          const finish = (data) => {
            if (settled) return;
            settled = true;
            if (signal) signal.removeEventListener("abort", abort);
            resolve(data);
          };
          const request = deps.https.request(
            "https://fanyi-api.baidu.com/api/trans/vip/translate",
            {
              method: "POST",
              family: 4,
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(form),
              },
            },
            (response) => {
              let body = "";
              response.on("data", (chunk) => {
                body += chunk;
              });
              response.on("end", () => {
                try {
                  const result = JSON.parse(body);
                  if (result.error_code && !['54003', '54005', '52001', '52002'].includes(String(result.error_code))) {
                    blockedUntil = Date.now() + 3600000;
                    if (String(result.error_code) === '54004') {
                      blockedCode = '54004';
                      blockedUntil = Infinity;
                    } else {
                      blockedUntil = Date.now() + 3600000;
                    }
                    try {
                      deps.fs.mkdirSync(deps.path.dirname(statusFile), { recursive: true });
                      deps.fs.writeFileSync(statusFile + '.tmp', JSON.stringify({ blocked_until: String(result.error_code) === '54004' ? null : blockedUntil, code: String(result.error_code) }), { mode: 0o600 });
                      deps.fs.renameSync(statusFile + '.tmp', statusFile);
                    } catch (_) { console.error('[translation] cannot save API retry status'); }
                  }
                  finish(result);
                } catch (error) {
                  finish(null);
                }
              });
              response.on("error", () => finish(null));
              response.on("aborted", () => finish(null));
            },
          );
          request.on("error", () => finish(null));
          request.setTimeout(20000, () =>
            request.destroy(new Error("translation timeout")),
          );
          if (signal) {
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
          }
          request.end(form);
        });
      },
      signal,
      signal ? 0 : 1,
    );
    return result;
  }

  function translateOne(text, attempt, signal, terms = currentTerms()) {
    if (signal && signal.aborted) return Promise.resolve("");
    const known = terms.protect(text);
    if (known.count && !/[\u3040-\u30ff\u3400-\u9fff]/.test(known.text))
      return Promise.resolve(known.restore(known.text));
    return new Promise((resolve) => {
      const protectedText = terms.protect(text);
      fetchTranslation(protectedText.text, signal)
        .then((j) => {
          try {
            if (j && j.trans_result && j.trans_result.length) {
              const t = j.trans_result
                .map(function (x) {
                  return x.dst;
                })
                .join("");
              const restored = protectedText.restore(t);
              const rating = text.match(/^★+/);
              const candidate = rating ? restored.replace(/^★+/, rating[0]) : restored;
              const {
                translationFactsMatch,
                starFactsMatch,
                untranslatedJapanese,
              } = require("./translation-facts");
              resolve(
                  candidate &&
                  translationFactsMatch(protectedText.text, t) &&
                  starFactsMatch(text, candidate) &&
                  !untranslatedJapanese(protectedText.text, t)
                  ? candidate
                  : "",
              );
              return;
            }
            const code = j && j.error_code;
            if ((code === "54003" || code === "54000") && (attempt || 0) < 3) {
              // rate-limited: wait and retry
              setTimeout(
                function () {
                  translateOne(text, (attempt || 0) + 1, signal, terms).then(resolve);
                },
                1200 * ((attempt || 0) + 1),
              );
              return;
            }
            resolve("");
          } catch (e) {
            resolve("");
          }
        })
        .catch(() => resolve(""));
    });
  }

  async function pumpTranslations() {
    if (transRunning) return;
    transRunning = true;
    try { while (transQueue.length) {
      const item = transQueue.shift();
      // Baidu free tier is ~1 QPS; translate serially with a small delay.
      let zh = '';
      try {
        zh = await translateOne(item.text, 0, item.signal, item.terms);
        if (zh && zh !== item.text) await translations.set(item.key, zh);
      } catch (error) { console.error('[translation]', error.message); }
      finally {
        if (titlePending.get(item.key) === item) titlePending.delete(item.key);
        item.callbacks.forEach(({ cb, signal, abort }) => {
          if (signal) signal.removeEventListener('abort', abort);
          try { cb(signal?.aborted ? item.text : zh || item.text); }
          catch (error) { console.error('[translation callback]', error.message); }
        });
      }
      await new Promise((r) => setTimeout(r, 250));
    } } finally { transRunning = false; }
  }

  function translateTitle(text, cb, signal, background = false) {
    if (!text) return cb(text || "");
    const terms = currentTerms();
    const cached = terms.normalize(newsContent.title(text));
    if (cached) return cb(cached);
    if (!BAIDU_APPID || !BAIDU_SECRET) return cb(text);
    if (signal?.aborted) return cb(text);
    const key = terms.protect
      ? (terms.protect(text).count
      ? "terms_" + terms.revision + ":" + text
      : text)
      : text;
    let item = titlePending.get(key);
    if (item?.signal.aborted) item = null;
    const duplicate = !!item;
    if (!item) {
      const controller = new AbortController();
      item = { text, key, terms, controller, signal: controller.signal, callbacks: [] };
      titlePending.set(key, item);
    }
    const abort = () => { if (item.callbacks.every(row => row.signal?.aborted)) item.controller.abort(); };
    item.callbacks.push({ cb, signal, abort });
    if (signal) signal.addEventListener('abort', abort, { once: true });
    if (duplicate) return;
    if (background) transQueue.push(item);
    else transQueue.unshift(item);
    pumpTranslations();
  }

  function hasCjk(s) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(s);
  }

  function translateBatchLines(lines, cb, signal, attempt = 0, terms = currentTerms()) {
    let completed = false;
    const finish = (out, dirty) => {
      if (!completed) {
        completed = true;
        cb(out, dirty);
      }
    };
    const fallback = () => finish(lines.slice(), true);
    // translate multiple short text runs in one Baidu request (newline-joined)
    if (!lines.length) return finish([], false);
    const protectedLines = lines.map((line, index) =>
      terms.protect(line, String(index).padStart(4, "0")),
    );
    const text = protectedLines.map((line) => line.text).join("\n");
    if (text.length > 950 || Buffer.byteLength(text) > 5500) return fallback();
    fetchTranslation(text, signal)
      .then((j) => {
        try {
          if (j && j.trans_result && j.trans_result.length) {
            if (j.trans_result.length !== lines.length) return fallback();
            const out = [];
            let dirty = false;
            for (let i = 0; i < lines.length; i++) {
              let value = "";
              if (j.trans_result[i].src === protectedLines[i].text) {
                  const restored = protectedLines[i].restore(
                  j.trans_result[i].dst,
                );
                if (restored) {
                  // Ratings are facts. Baidu sometimes adds a star to a leading ★★★.
                  const rating = lines[i].match(/^★+/);
                  const candidate = rating
                    ? restored.replace(/^★+/, rating[0])
                    : restored;
                  const {
                    translationFactsMatch,
                    starFactsMatch,
                    untranslatedJapanese,
                  } = require("./translation-facts");
                  if (
                    translationFactsMatch(
                      protectedLines[i].text,
                      j.trans_result[i].dst,
                    ) &&
                    starFactsMatch(lines[i], candidate) &&
                    !untranslatedJapanese(
                      protectedLines[i].text,
                      j.trans_result[i].dst,
                    )
                  )
                    value = candidate;
                }
              }
              if (!value) {
                value = lines[i];
                dirty = true;
              }
              out.push(value);
            }
            return finish(out, dirty);
          }
          const code = j && j.error_code;
          if (
            (code === "54003" || code === "54000") &&
            attempt < 2 &&
            !(signal && signal.aborted)
          ) {
            setTimeout(
              () => translateBatchLines(lines, finish, signal, attempt + 1, terms),
              1200 * (attempt + 1),
            );
            return;
          }
          fallback();
        } catch (e) {
          fallback();
        }
      })
      .catch(() => fallback());
  }

  function translateHtmlMessage(html, cb, signal, archivedFragments = {}) {
    const { splitHtmlText, escapeText } = require('./html-text');
    const work = async () => {
    const src = String(html || "");
    if (signal && signal.aborted) return { value: '', dirty: true };
    if (!src) return { value: '', dirty: false };
    const terms = currentTerms();
    const hash = deps.crypto.createHash("md5").update(src).digest("hex");
    const originalKey = "msg_" + hash;
    const key = terms.protect(src).count
      ? "msg_html2_terms_" + terms.revision + "_" + hash
      : "msg_html2_" + hash;
    let cached = newsContent.message(originalKey) || translations.get(key);
    if (!cached && terms.protect(src).count && typeof translations.findBySuffix === 'function') {
      cached = translations.findBySuffix('_' + hash, 'msg_html2_terms_');
    }
    if (cached) {
      const { translationFactsMatch, untranslatedJapanese } = require('./translation-facts');
      const normalized = terms.normalize(cached);
      cached = normalized && normalized !== src && translationFactsMatch(src, normalized) && !untranslatedJapanese(src, normalized) ? normalized : '';
    }
    if (cached && cached !== src) return { value: terms.normalize(cached), dirty: false };
    if (!BAIDU_APPID || !BAIDU_SECRET) return { value: '', dirty: true };
    const tokens = await splitHtmlText(src, signal);
    const runs = []; // Each text node retains its index and ordered fragments.
    tokens.forEach(function (tok, i) {
      if (tok.text && hasCjk(tok.text) && tok.text.trim()) {
        const text = tok.text.trim().replace(/\s*\r?\n\s*/g, " ");
        for (let start = 0; start < text.length;) {
          let end = Math.min(start + 600, text.length);
          if (end < text.length) {
            const boundary = Math.max(
              ...["。", "！", "？", ". ", " "].map((mark) =>
                text.lastIndexOf(mark, end - 1),
              ),
            );
            if (boundary > start + 300) end = boundary + 1;
          }
          while (
            end > start + 1 &&
            terms.protect(text.slice(start, end), "99").text.length >
              900
          )
            end = start + Math.floor((end - start) / 2);
          runs.push({ idx: i, text: text.slice(start, end),
            archiveText: start === 0 && end === text.length ? tok.source.trim().replace(/\s*\r?\n\s*/g, ' ') : '' });
          start = end;
        }
      }
    });
    if (!runs.length) {
      return { value: src, dirty: false };
    }
    // Limits apply to the protected query, not to the shorter original Japanese.
    const translated = new Map();
    runs.forEach((run) => {
      let cachedFragment = archivedFragments[run.text] || archivedFragments[run.archiveText] || translations.get(
        "fragment:" + (terms.protect(run.text).count
          ? "terms_" + terms.revision + ":" + run.text
          : run.text),
      );
      if (!cachedFragment && terms.protect(run.text).count && typeof translations.findBySuffix === 'function') {
        cachedFragment = translations.findBySuffix(':' + run.text, 'fragment:terms_');
      }
      if (!cachedFragment) cachedFragment = cachedTranslation(run.text);
      if (cachedFragment) {
        const { translationFactsMatch, untranslatedJapanese } = require('./translation-facts');
        const normalized = terms.normalize(cachedFragment);
        cachedFragment = normalized && normalized !== run.text && translationFactsMatch(run.text, normalized) && !untranslatedJapanese(run.text, normalized) ? normalized : '';
      }
      if (cachedFragment) translated.set(run, terms.normalize(cachedFragment));
      else {
        const known = terms.protect(run.text);
        if (known.count && !/[\u3040-\u30ff\u3400-\u9fff]/.test(known.text))
          translated.set(run, known.restore(known.text));
      }
    });
    const chunks = [];
    let cur = [];
    runs.forEach(function (r) {
      if (translated.has(r)) return;
      const query = cur
        .concat(r)
        .map(
            (run, index) => terms.protect(run.text, String(index)).text,
        )
        .join("\n");
      if (
        (query.length > 950 || Buffer.byteLength(query) > 5500) &&
        cur.length
      ) {
        chunks.push(cur);
        cur = [];
      }
      cur.push(r);
    });
    if (cur.length) chunks.push(cur);
    let dirty = false;
    await Promise.all(chunks.map(chunk => new Promise(resolve => {
      translateBatchLines(
        chunk.map(function (r) {
          return r.text;
        }),
        async function (outs, chunkDirty) {
          if (outs === null) {
            dirty = true;
            chunk.forEach(function (r) {
              translated.set(r, r.text);
            });
          } else {
            if (chunkDirty) dirty = true;
            const fragments = {};
            outs.forEach(function (zh, k) {
              translated.set(chunk[k], zh || chunk[k].text);
              if (zh && zh !== chunk[k].text)
                fragments["fragment:" + translationKeyWithTerms(chunk[k].text, terms)] = zh;
            });
            if (Object.keys(fragments).length) {
              try { await translations.setMany(fragments); }
              catch (error) { console.error('[translation cache]', error.message); }
            }
          }
          resolve();
        },
        signal, 0, terms,
      );
    })));
      if (signal && signal.aborted) return { value: '', dirty: true };
      const textNodes = new Map();
      runs.forEach((run) =>
        textNodes.set(
          run.idx,
          (textNodes.get(run.idx) || "") + (translated.get(run) || run.text),
        ),
      );
      const out = tokens
        .map(function (tok, i) {
          if (textNodes.has(i)) {
            const leading = tok.text.match(/^\s*/)[0];
            const trailing = tok.text.match(/\s*$/)[0];
            return escapeText(leading + textNodes.get(i) + trailing);
          }
          return tok.markup ?? tok.source;
        })
        .join("");
      if (!dirty) {
        try { await translations.set(key, out); }
        catch (error) { console.error('[translation cache]', error.message); }
      }
      return { value: out, dirty };
    };
    return work().then(({ value, dirty }) => { cb(value, dirty); return value; }, error => {
      if (!signal?.aborted) console.error('[translation HTML]', error.message);
      cb('', true);
      return '';
    });
  }

  function translateArticle(detail, signal, finish) {
    Object.assign(detail, newsContent.apply(detail));
    let incomplete = false;
    let remaining = 2;
    const complete = () => {
      if (--remaining) return;
      detail.translation_state = incomplete ? "partial" : "complete";
      finish(200, { response_code: 1, detail });
    };
    if (detail.title_zh || !detail.title) complete();
    else
      translateTitle(
        detail.title,
        (zh) => {
          detail.title_zh =
            zh && !(zh === detail.title && /[\u3040-\u30ff]/.test(detail.title))
              ? zh
              : "";
          if (!detail.title_zh) incomplete = true;
          complete();
        },
        signal,
      );
    if (detail.message_zh || !detail.message) complete();
    else
      translateHtmlMessage(
        detail.message,
        (zh, dirty) => {
          detail.message_zh = zh || detail.message;
          if (
            dirty ||
            !zh ||
            (zh === detail.message && /[\u3040-\u30ff]/.test(detail.message))
          )
            incomplete = true;
          complete();
        },
        signal,
        detail.archive_fragments,
      );
  }
  return { newsContent, translateTitle, translateArticle,
    translateHtmlMessage,
    get translationBlockCode() { return blockedCode; },
    get translationAvailable() { return !!BAIDU_APPID && !!BAIDU_SECRET && blockedCode !== '54004' && Date.now() >= blockedUntil; } };
};
