// news service. Dependencies are explicit live ports.
exports.createService = function (deps) {
  const NEWS_INDEX_URL =
    "https://umamusume.jp/api/ajax/pr_info_index?format=json";

  const NEWS_DETAIL_URL =
    "https://umamusume.jp/api/ajax/pr_info_detail?format=json";

  const NEWS_TTL = 15 * 60 * 1000;

  const NEWS_MAX_CONC = 3;

  const NEWS_SNAPSHOT_FILE = deps.path.join(
    deps.DATA_DIR,
    "news_snapshot.json",
  );

  const LANTIS_FILE = deps.path.join(deps.DATA_DIR, "lantis_news.json");

  const LANTIS_TTL = 30 * 60 * 1000;

  const LANTIS_CRAWL_TIMEOUT = 10 * 60 * 1000;

  let lantisList = [];

  let lantisAt = 0;

  let lantisSnapshotMtime = 0;

  function normalizeLantisDate(d) {
    if (!d) return "";
    const m = String(d).match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/);
    if (m)
      return (
        m[1] +
        "-" +
        String(m[2]).padStart(2, "0") +
        "-" +
        String(m[3]).padStart(2, "0")
      );
    return String(d);
  }

  function lantisNewsItems() {
    return lantisList.map(function (it) {
      return {
        announce_id: it.id,
        title: it.title,
        title_zh: deps.newsContent.title(it.title, it.title_zh),
        post_at: normalizeLantisDate(it.date),
        announce_label: 4,
        source: "lantis",
        url: it.url,
        news_type_display: "CD相关",
        image: it.image || "",
      };
    });
  }

  function mergeLantis(list) {
    lantisNewsItems().forEach(function (n) {
      list.push(n);
    });
    return list;
  }

  function reloadLantis() {
    let stat = null;
    try {
      stat = deps.fs.statSync(LANTIS_FILE);
    } catch (e) {
      return;
    }
    try {
      const parsed = JSON.parse(deps.fs.readFileSync(LANTIS_FILE, "utf8"));
      if (Array.isArray(parsed)) lantisList = parsed;
    } catch (e) {
      /* keep the last good list */
    }
    lantisSnapshotMtime = stat.mtimeMs;
  }

  let newsIndexCache = { at: 0, data: null };

  let newsRefreshPromise = null;

  let newsRefreshRevision = 0;

  let newsSnapshotMtime = 0;

  function adoptNewsSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.information_list)) return false;
    const currentAt =
      Date.parse(
        (newsIndexCache.data && newsIndexCache.data.generated_at) || "",
      ) || 0;
    const incomingAt = Date.parse(snapshot.generated_at || "") || 0;
    if (!newsIndexCache.data || incomingAt > currentAt) {
      newsIndexCache = {
        at: Math.max(newsIndexCache.at || 0, incomingAt),
        data: snapshot,
      };
      return true;
    }
    return false;
  }

  function reloadNewsSnapshotIfNewer() {
    try {
      const stat = deps.fs.statSync(NEWS_SNAPSHOT_FILE);
      if (stat.mtimeMs <= newsSnapshotMtime) return;
      newsSnapshotMtime = stat.mtimeMs;
      if (
        adoptNewsSnapshot(
          JSON.parse(deps.fs.readFileSync(NEWS_SNAPSHOT_FILE, "utf8")),
        )
      ) {
        console.log(
          "[news] adopted snapshot",
          newsIndexCache.data.generated_at,
        );
      }
    } catch (error) {
      /* keep serving the in-memory cache */
    }
  }

  function fetchNewsPage(page, cb) {
    deps.httpsGet(NEWS_INDEX_URL + "&page=" + page, (err, json) => {
      if (err || !json || json.response_code !== 1) {
        cb(err || new Error("bad page"));
        return;
      }
      cb(null, json);
    });
  }

  function fetchNewsPageRetry(page, cb, attempt) {
    fetchNewsPage(page, (err, json) => {
      if (!err) {
        cb(null, json);
        return;
      }
      if ((attempt || 0) < 2) {
        setTimeout(
          () => fetchNewsPageRetry(page, cb, (attempt || 0) + 1),
          800 * ((attempt || 0) + 1),
        );
        return;
      }
      cb(new Error("page " + page + ": " + ((err && err.message) || err)));
    });
  }

  function extractFirstImage(html) {
    if (!html || typeof html !== "string") return "";
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? m[1] : "";
  }

  const BACKFILL_CONC = 3;

  const BACKFILL_TIMEOUT = 10000;

  function backfillNewsImages(list, cb) {
    const need = list.filter(
      (n) => n.announce_label === 3 && !n.image && n.announce_id,
    );
    if (!need.length) {
      cb();
      return;
    }
    let idx = 0,
      active = 0,
      done = 0,
      finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        cb();
      }
    };
    function pump() {
      while (active < BACKFILL_CONC && idx < need.length) {
        const item = need[idx++];
        active++;
        deps.httpsGet(
          NEWS_DETAIL_URL + "&announce_id=" + item.announce_id,
          (err, json) => {
            active--;
            if (finished) return;
            if (!err && json && json.detail) {
              const d = json.detail;
              const img =
                d.image || d.image_big || extractFirstImage(d.message) || "";
              if (img) item.image = img;
            }
            done++;
            if (done === need.length) finish();
            else pump();
          },
        );
      }
    }
    pump();
    setTimeout(() => {
      if (!finished) finish();
    }, BACKFILL_TIMEOUT);
  }

  let newsSnapshotWrite = Promise.resolve();

  function persistNewsSnapshot(data) {
    const body = JSON.stringify(data);
    newsSnapshotWrite = newsSnapshotWrite.then(async () => {
      const tempPath = NEWS_SNAPSHOT_FILE + "." + process.pid + ".tmp";
      try {
        await deps.fs.promises.writeFile(tempPath, body, { mode: 0o644 });
        await deps.fs.promises.rename(tempPath, NEWS_SNAPSHOT_FILE);
      } catch (error) {
        console.error("[news] snapshot write failed:", error.message || error);
        await deps.fs.promises.unlink(tempPath).catch(() => {});
      }
    });
    return newsSnapshotWrite;
  }

  function publishLantisMerge() {
    const current = newsIndexCache.data;
    if (!current || !Array.isArray(current.information_list)) return false;
    const merged = deps
      .mergeNews(current.information_list, lantisNewsItems())
      .map((item) => deps.newsContent.apply(item));
    merged.sort((a, b) =>
      String(b.update_at || b.post_at).localeCompare(
        String(a.update_at || a.post_at),
      ),
    );
    if (JSON.stringify(merged) === JSON.stringify(current.information_list))
      return false;
    const data = Object.assign({}, current, {
      information_list: merged,
      generated_at: new Date().toISOString(),
    });
    newsIndexCache = { at: newsIndexCache.at, data };
    // --no-crawl 预览只并入内存，不改写数据文件；自动刷新模式才落盘发布。
    if (!deps.NO_AUTO_CRAWL) persistNewsSnapshot(data);
    console.log(
      "[lantis] merged",
      lantisList.length,
      "cd items into news snapshot",
      data.generated_at,
    );
    return true;
  }

  function reloadLantisIfNewer() {
    try {
      const stat = deps.fs.statSync(LANTIS_FILE);
      if (stat.mtimeMs <= lantisSnapshotMtime) return;
      reloadLantis();
      // 部署进来的快照视为“刚抓过”，避免立刻又触发一轮 TTL 补抓。
      lantisAt = Math.max(lantisAt, stat.mtimeMs);
      console.log("[lantis] adopted snapshot", lantisList.length, "items");
      publishLantisMerge();
    } catch (e) {
      /* keep serving the in-memory list */
    }
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
        console.error("[news] refresh watchdog fired (180s), aborting");
        const reject = rejectRef;
        rejectRef = null;
        reject(new Error("refresh watchdog (180s)"));
      }
    }, 180000);
    const refresh = new Promise((resolve, reject) => {
      // On failure, push the freshness marker forward so visitor traffic cannot
      // hammer the upstream while it is down (retry at most once per NEWS_TTL).
      const fail = (err) => {
        if (revision !== newsRefreshRevision) return;
        newsIndexCache = { at: Date.now(), data: newsIndexCache.data };
        if (rejectRef) {
          const r = rejectRef;
          rejectRef = null;
          r(err);
        }
      };
      rejectRef = reject;
      fetchNewsPageRetry(1, (err, first) => {
        if (revision !== newsRefreshRevision) return;
        if (err) {
          fail(err);
          return;
        }
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
              if (done !== total) {
                pump();
                return;
              }
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
          const list = deps
            .mergeNews(
              (newsIndexCache.data && newsIndexCache.data.information_list) ||
                [],
              incoming,
            )
            .map((item) => deps.newsContent.apply(item));
          list.sort((a, b) =>
            String(b.update_at || b.post_at).localeCompare(
              String(a.update_at || a.post_at),
            ),
          );
          const data = {
            response_code: 1,
            information_list: list,
            total_page_count: total,
            generated_at: new Date().toISOString(),
          };
          newsIndexCache = { at: Date.now(), data };
          persistNewsSnapshot(data);
          console.log(
            "[news] refreshed",
            list.length,
            "items",
            data.generated_at,
          );
          resolve(data);

          // Image discovery and translation improve the next response but never
          // delay the list currently being read by a visitor.
          const imageRows = list.map((item) => Object.assign({}, item));
          backfillNewsImages(imageRows, () => {
            const current = newsIndexCache.data;
            if (!current) return;
            const images = new Map(
              imageRows
                .filter((item) => item.image)
                .map((item) => [String(item.announce_id), item.image]),
            );
            let changed = false;
            const items = current.information_list.map((item) => {
              const image = images.get(String(item.announce_id));
              if (item.image || !image) return item;
              changed = true;
              return Object.assign({}, item, { image });
            });
            if (changed) {
              const updated = Object.assign({}, current, {
                information_list: items,
              });
              newsIndexCache = { at: newsIndexCache.at, data: updated };
              persistNewsSnapshot(updated);
            }
          });
          list
            .filter((item) => !deps.newsContent.title(item.title))
            .slice(0, 20)
            .forEach((item) => {
              deps.translateTitle(item.title, function () {}, undefined, true);
            });
        }
        pump();
      });
    }).finally(() => {
      clearTimeout(watchdog);
      if (newsRefreshPromise === refresh) newsRefreshPromise = null;
    });
    newsRefreshPromise = refresh;
    return refresh;
  }

  function newsResponseSnapshot() {
    reloadNewsSnapshotIfNewer();
    reloadLantisIfNewer();
    if (!newsIndexCache.data) return null;
    const cached = JSON.parse(JSON.stringify(newsIndexCache.data));
    cached.information_list = cached.information_list.map((item) =>
      deps.newsContent.apply(item),
    );
    return cached;
  }

  function handleNewsIndex(res) {
    const cached = newsResponseSnapshot();
    if (cached) {
      deps.sendJson(res, 200, cached, {
        cacheControl: "public, max-age=60, stale-while-revalidate=300",
        etag:
          '"news-' +
          deps.crypto
            .createHash("sha1")
            .update(JSON.stringify(cached))
            .digest("hex")
            .slice(0, 12) +
          '"',
      });
      if (!deps.NO_AUTO_CRAWL) {
        // CD相关 与官网新闻各自按需 TTL 补抓，互不牵制。
        ensureLantisFresh();
        if (Date.now() - newsIndexCache.at >= NEWS_TTL) {
          refreshNewsIndex().catch((error) => {
            console.error(
              "[news] background refresh failed:",
              (error && error.message) || error,
            );
          });
        }
      }
      return;
    }
    if (deps.NO_AUTO_CRAWL) {
      deps.sendJson(res, 503, { error: "news snapshot unavailable" });
      return;
    }
    refreshNewsIndex()
      .then((data) =>
        deps.sendJson(res, 200, data, {
          cacheControl: "public, max-age=60, stale-while-revalidate=300",
        }),
      )
      .catch((error) => {
        console.error(
          "[news] refresh failed:",
          (error && error.message) || error,
        );
        deps.sendJson(res, 502, { error: "upstream news index failed" });
      });
  }

  const articleCache = require("./article-cache").createArticleCache({
    send: (res, status, data) =>
      deps.sendJson(res, status, data, { cacheControl: "no-store" }),
    applyEdits: applyArticleEdits,
    translate: (detail, signal, done) =>
      deps.translateArticle(detail, signal, done),
  });

  function applyArticleEdits(data) {
    if (!data.detail) return data;
    const detail = deps.newsContent.apply(data.detail);
    if (detail.message) {
      const key =
        "msg_" +
        deps.crypto.createHash("md5").update(detail.message).digest("hex");
      const edited = deps.newsContent.message(key);
      if (edited) detail.message_zh = edited;
    }
    return { ...data, detail };
  }

  function serveArticle(key, res, load, withTranslation) {
    articleCache.serve(key, res, load, withTranslation);
  }

  function handleNewsDetail(req, res, params) {
    const id = parseInt(params.get("id") || "", 10);
    if (!id) {
      deps.sendJson(res, 400, { error: "missing id" });
      return;
    }
    serveArticle(
      "official-" + id,
      res,
      (signal, finish) => {
        deps.httpsGet(
          NEWS_DETAIL_URL + "&announce_id=" + id,
          (err, json) => {
            if (
              !err &&
              json &&
              json.detail &&
              Number(json.detail.announce_id) === 0
            ) {
              finish(404, { error: "news not found" });
              return;
            }
            if (err || !json || json.response_code !== 1) {
              finish(502, { error: "upstream detail failed" });
              return;
            }
            if (!json.detail)
              return finish(502, { error: "missing upstream detail" });
            finish(200, json);
          },
          signal,
        );
      },
      true,
    );
  }

  function ensureLantisFresh() {
    if (deps.NO_AUTO_CRAWL || deps.lantisRunning) return;
    if (Date.now() - lantisAt < LANTIS_TTL) return;
    deps.runLantisCrawl("auto");
  }

  function handleLantisNews(res) {
    reloadLantisIfNewer();
    ensureLantisFresh();
    // Serve the last complete CD snapshot immediately (same shape as the news index).
    const items = lantisNewsItems();
    deps.sendJson(
      res,
      200,
      { response_code: 1, information_list: items },
      {
        cacheControl: "public, max-age=60, stale-while-revalidate=300",
        etag:
          '"lantis-' +
          deps.crypto
            .createHash("sha1")
            .update(JSON.stringify(items))
            .digest("hex")
            .slice(0, 12) +
          '"',
      },
    );
  }

  function handleLantisDetail(req, res, params) {
    const raw = (params.get("id") || "").toString();
    const digits = String(raw)
      .replace(/^lantis-/, "")
      .replace(/\D/g, "");
    if (!digits) {
      deps.sendJson(res, 400, { error: "missing id" });
      return;
    }
    const it = lantisList.find(function (x) {
      return x.id === "lantis-" + digits || x.id === raw;
    });
    const url =
      (it && it.url) || "https://umamusume.lantis.jp/news/" + digits + "/";
    serveArticle(
      "lantis-" + digits,
      res,
      (signal, finish) => {
        deps.httpsGetHtml(
          url,
          function (err, body) {
            if (err || !body) {
              finish(502, { error: "upstream lantis detail failed" });
              return;
            }
            const detail = {
              announce_id: "lantis-" + digits,
              title: "",
              title_zh: "",
              message: "",
              message_zh: "",
              post_at: it ? normalizeLantisDate(it.date) : "",
              image: (it && it.image) || "",
              source: "lantis",
              url: url,
            };
            const tm =
              body.match(
                /<h2[^>]*class="newsin_title"[^>]*>([\s\S]*?)<\/h2>/i,
              ) || body.match(/<title>([^<]*)<\/title>/i);
            if (tm) detail.title = cleanHtml(tm[1]).trim();
            const inner = extractInnercon(body) || "";
            detail.message = inner;
            finish(200, { response_code: 1, detail });
          },
          0,
          signal,
        );
      },
      true,
    );
  }

  function cleanHtml(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .trim();
  }

  function extractInnercon(body) {
    const i = body.indexOf('class="innercon"');
    if (i === -1) return null;
    const start = body.indexOf(">", i) + 1;
    // simpler: capture up to the ban_more nav which follows the content div
    const endMarker = body.indexOf('<div class="ban_more">', start);
    if (endMarker !== -1) {
      return body
        .slice(start, endMarker)
        .replace(/<\/div>\s*$/, "")
        .trim();
    }
    return null;
  }
  function start() {
    try {
      lantisList = JSON.parse(deps.fs.readFileSync(LANTIS_FILE, "utf8"));
      lantisSnapshotMtime = deps.fs.statSync(LANTIS_FILE).mtimeMs;
    } catch (e) {
      lantisList = [];
    }
    try {
      const stat = deps.fs.statSync(NEWS_SNAPSHOT_FILE);
      newsSnapshotMtime = stat.mtimeMs;
      adoptNewsSnapshot(
        JSON.parse(deps.fs.readFileSync(NEWS_SNAPSHOT_FILE, "utf8")),
      );
    } catch (e) {
      /* the first successful refresh creates the snapshot */
    }
  }
  return {
    start,
    handleNewsIndex,
    handleNewsDetail,
    handleLantisNews,
    handleLantisDetail,
    reloadLantis,
    refreshNewsIndex,
    ensureLantisFresh,
    LANTIS_CRAWL_TIMEOUT,
    get lantisAt() {
      return lantisAt;
    },
    set lantisAt(value) {
      lantisAt = value;
    },
    publishLantisMerge,
  };
};
