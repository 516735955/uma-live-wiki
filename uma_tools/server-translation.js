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
  try { blockedUntil = JSON.parse(deps.fs.readFileSync(statusFile, 'utf8')).blocked_until || 0; } catch (_) {}

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
    return terms.protect(source).count
      ? "terms_" + terms.revision + ":" + source
      : source;
  }

  const newsContent = new deps.NewsContent(
    deps.path.join(__dirname, "news-overrides.json"),
    (source) => translations.get(translationKey(source)),
    (source) => translations.get(source),
  );

  let transQueue = [];

  let transRunning = false;

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
                    try {
                      deps.fs.mkdirSync(deps.path.dirname(statusFile), { recursive: true });
                      deps.fs.writeFileSync(statusFile + '.tmp', JSON.stringify({ blocked_until: blockedUntil, code: String(result.error_code) }), { mode: 0o600 });
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

  function translateOne(text, attempt, signal) {
    if (signal && signal.aborted) return Promise.resolve("");
    const known = currentTerms().protect(text);
    if (known.count && !/[\u3040-\u30ff\u3400-\u9fff]/.test(known.text))
      return Promise.resolve(known.restore(known.text));
    return new Promise((resolve) => {
      const protectedText = currentTerms().protect(text);
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
              const {
                translationFactsMatch,
                untranslatedJapanese,
              } = require("./translation-facts");
              resolve(
                restored &&
                  translationFactsMatch(protectedText.text, t) &&
                  !untranslatedJapanese(protectedText.text, t)
                  ? restored
                  : "",
              );
              return;
            }
            const code = j && j.error_code;
            if ((code === "54003" || code === "54000") && (attempt || 0) < 3) {
              // rate-limited: wait and retry
              setTimeout(
                function () {
                  translateOne(text, (attempt || 0) + 1, signal).then(resolve);
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
    if (!text) return cb(text || "");
    const cached = currentTerms().normalize(newsContent.title(text));
    if (cached) return cb(cached);
    if (!BAIDU_APPID || !BAIDU_SECRET) return cb(text);
    const duplicate = transQueue.find(
      (item) => item.text === text && item.signal === signal,
    );
    if (duplicate) {
      const previous = duplicate.cb;
      duplicate.cb = (value) => {
        previous(value);
        cb(value);
      };
      return;
    }
    const item = { text, cb, signal };
    if (background) transQueue.push(item);
    else transQueue.unshift(item);
    pumpTranslations();
  }

  function hasCjk(s) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(s);
  }

  function translateBatchLines(lines, cb, signal, attempt = 0) {
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
      currentTerms().protect(line, String(index).padStart(4, "0")),
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
                    untranslatedJapanese,
                  } = require("./translation-facts");
                  if (
                    translationFactsMatch(
                      protectedLines[i].text,
                      j.trans_result[i].dst,
                    ) &&
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
              () => translateBatchLines(lines, finish, signal, attempt + 1),
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
    const src = String(html || "");
    if (signal && signal.aborted) return cb("");
    if (!src) return cb("");
    const hash = deps.crypto.createHash("md5").update(src).digest("hex");
    const originalKey = "msg_" + hash;
    const key = currentTerms().protect(src).count
      ? "msg_terms_" + currentTerms().revision + "_" + hash
      : originalKey;
    const cached = newsContent.message(originalKey) || translations.get(key);
    if (cached && cached !== src) return cb(currentTerms().normalize(cached));
    if (!BAIDU_APPID || !BAIDU_SECRET) return cb("");
    // tokenize: alternates text / tag
    const tokens = src.match(/<[^>]+>|[^<]+/g) || [src];
    const runs = []; // Each text node retains its index and ordered fragments.
    tokens.forEach(function (tok, i) {
      if (tok[0] !== "<" && hasCjk(tok) && tok.trim()) {
        const text = tok.trim().replace(/\s*\r?\n\s*/g, " ");
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
            currentTerms().protect(text.slice(start, end), "99").text.length >
              900
          )
            end = start + Math.floor((end - start) / 2);
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
    const translated = new Map();
    runs.forEach((run) => {
      const cachedFragment = archivedFragments[run.text] || translations.get(
        "fragment:" + translationKey(run.text),
      );
      if (cachedFragment) translated.set(run, currentTerms().normalize(cachedFragment));
      else {
        const known = currentTerms().protect(run.text);
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
          (run, index) => currentTerms().protect(run.text, String(index)).text,
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
    let done = 0;
    let dirty = false;
    chunks.forEach(function (chunk, ci) {
      translateBatchLines(
        chunk.map(function (r) {
          return r.text;
        }),
        function (outs, chunkDirty) {
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
                fragments["fragment:" + translationKey(chunk[k].text)] = zh;
            });
            if (Object.keys(fragments).length) translations.setMany(fragments);
          }
          done++;
          if (done === chunks.length) finish();
        },
        signal,
      );
    });
    if (!chunks.length) finish();
    function finish() {
      if (signal && signal.aborted) return cb("");
      const textNodes = new Map();
      runs.forEach((run) =>
        textNodes.set(
          run.idx,
          (textNodes.get(run.idx) || "") + (translated.get(run) || run.text),
        ),
      );
      const out = tokens
        .map(function (tok, i) {
          if (textNodes.has(i)) return textNodes.get(i);
          return tok;
        })
        .join("");
      if (!dirty) translations.set(key, out);
      cb(out, dirty);
    }
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
    get translationAvailable() { return !!BAIDU_APPID && !!BAIDU_SECRET && Date.now() >= blockedUntil; } };
};
