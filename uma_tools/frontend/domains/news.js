/* news state and behavior; external dependencies are explicit live ports. */
export function createNews(deps) {
  const newsItems = deps.ref([]);

  const newsError = deps.ref("");

  const newsLoading = deps.ref(false);

  const newsRange = deps.ref("all");

  const newsType = deps.ref("all");

  const newsDetail = deps.ref(null);

  const newsDetailBody = deps.ref("");
  const newsLanguage = deps.ref('zh');
  function renderNewsBody() {
    const detail = newsDetail.value;
    newsDetailBody.value = detail ? cleanNewsBody(newsLanguage.value === 'ja' ? detail.message : detail.message_zh) : '';
  }
  function setNewsLanguage(language) {
    if (!['zh', 'ja'].includes(language)) return;
    newsLanguage.value = language;
    renderNewsBody();
  }

  const newsDetailLoading = deps.ref(false);

  const newsPrevId = deps.ref(0);

  const newsNextId = deps.ref(0);

  const newsPage = deps.ref(1);

  const newsPerPage = 20;

  const newsDefaultCover = "/uma_tools/img/news-card-default.webp";

  let newsLoadPromise = null;

  let newsDetailRequest = null;

  let newsTranslationRequest = null;

  const newsHero = deps.computed(function () {
    function timeOf(n) {
      const s = n.post_at || n.update_at || "";
      const t = new Date(String(s).replace(" ", "T")).getTime();
      if (!isNaN(t)) return t;
      return -1;
    }
    function pick(list) {
      let best = null;
      list.forEach(function (n) {
        if (!best || timeOf(n) > timeOf(best)) best = n;
      });
      return best;
    }
    const media = [];
    const game = [];
    const cd = [];
    newsItems.value.forEach(function (n) {
      const t = newsTypeOf(n);
      if (t === "media") media.push(n);
      else if (t === "game") game.push(n);
      else if (t === "cd") cd.push(n);
    });
    return [pick(media), pick(cd), pick(game)].filter(Boolean).slice(0, 3);
  });

  const newsFiltered = deps.computed(function () {
    let out = newsItems.value;
    if (newsRange.value !== "all") {
      const days = parseInt(newsRange.value, 10);
      const cut = Date.now() - days * 86400000;
      out = out.filter(function (n) {
        var t = new Date(String(n.post_at).replace(" ", "T")).getTime();
        return !isNaN(t) && t >= cut;
      });
    }
    if (newsType.value !== "all") {
      out = out.filter(function (n) {
        return newsTypeOf(n) === newsType.value;
      });
    }
    // Sort by original publish time (post_at) newest-first so the list always shows
    // the latest-posted news on top regardless of server update_at ordering.
    out = out.slice().sort(function (a, b) {
      const ta = new Date(String(a.post_at || "").replace(" ", "T")).getTime();
      const tb = new Date(String(b.post_at || "").replace(" ", "T")).getTime();
      if (!isNaN(ta) && !isNaN(tb)) return tb - ta;
      if (!isNaN(ta)) return -1;
      if (!isNaN(tb)) return 1;
      return 0;
    });
    return out;
  });

  const newsPageCount = deps.computed(function () {
    return Math.max(1, Math.ceil(newsFiltered.value.length / newsPerPage));
  });

  const newsPaged = deps.computed(function () {
    const s = (newsPage.value - 1) * newsPerPage;
    return newsFiltered.value.slice(s, s + newsPerPage);
  });

  const newsPageStart = deps.computed(function () {
    if (!newsFiltered.value.length) return 0;
    return (newsPage.value - 1) * newsPerPage + 1;
  });

  const newsPageEnd = deps.computed(function () {
    if (!newsFiltered.value.length) return 0;
    return Math.min(newsFiltered.value.length, newsPage.value * newsPerPage);
  });

  const newsPageList = deps.computed(function () {
    const total = newsPageCount.value;
    const cur = newsPage.value;
    const pages = [];
    const push = function (p) {
      if (pages.length && pages[pages.length - 1] === p) return;
      pages.push(p);
    };
    push(1);
    if (cur > 3) push("…");
    for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++)
      push(p);
    if (cur < total - 2) push("…");
    if (total > 1) push(total);
    return pages;
  });

  function setNewsPage(p) {
    if (p === "…") return;
    const n = parseInt(p, 10);
    if (isNaN(n)) return;
    if (n < 1 || n > newsPageCount.value) return;
    newsPage.value = n;
    deps.pushUrl();
    const el = document.getElementById("news-list-top");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goNewsPage(dir) {
    setNewsPage(newsPage.value + dir);
  }

  function newsDate(s) {
    if (!s) return "";
    const d = new Date(s.replace(" ", "T"));
    if (isNaN(d)) return s;
    const y = d.getFullYear(),
      m = String(d.getMonth() + 1).padStart(2, "0"),
      day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function newsTypeOf(n) {
    if (n.announce_label === 4) return "cd";
    return n.announce_label === 3 ? "media" : "game";
  }

  function newsTypeLabel(n) {
    if (!n) return "";
    const t = newsTypeOf(n);
    if (t === "media") return "MEDIA";
    if (t === "game") return "GAME";
    if (t === "cd") return "CD相关";
    return "";
  }

  function newsTitle(n) {
    if (!n) return "";
    return n.title_zh || n.title || "";
  }

  function cleanNewsBody(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    const allowedTags = new Set([
      "A",
      "P",
      "BR",
      "DIV",
      "SPAN",
      "STRONG",
      "B",
      "EM",
      "I",
      "U",
      "S",
      "UL",
      "OL",
      "LI",
      "DL",
      "DT",
      "DD",
      "BLOCKQUOTE",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "HR",
      "TABLE",
      "THEAD",
      "TBODY",
      "TFOOT",
      "TR",
      "TH",
      "TD",
      "FIGURE",
      "FIGCAPTION",
      "PICTURE",
      "SOURCE",
      "IMG",
      "IFRAME",
    ]);
    const dangerousTags = new Set([
      "SCRIPT",
      "STYLE",
      "OBJECT",
      "EMBED",
      "FORM",
      "LINK",
      "META",
      "BASE",
    ]);
    const allowedAttrs = new Set([
      "href",
      "src",
      "srcset",
      "alt",
      "title",
      "width",
      "height",
      "loading",
      "colspan",
      "rowspan",
    ]);
    const iframeAttrs = new Set([
      "src",
      "title",
      "width",
      "height",
      "loading",
      "allow",
      "allowfullscreen",
      "frameborder",
      "referrerpolicy",
    ]);
    function safeUrl(value) {
      const normalized = String(value || "")
        .trim()
        .replace(/[\u0000-\u0020]+/g, "");
      return !/(?:^|,)(?:javascript|data|vbscript):/i.test(normalized);
    }
    function trustedVideoEmbed(value) {
      try {
        const url = new URL(String(value || ""), window.location.origin);
        const trustedHost = [
          "youtube.com",
          "www.youtube.com",
          "youtube-nocookie.com",
          "www.youtube-nocookie.com",
        ].includes(url.hostname);
        return (
          url.protocol === "https:" &&
          trustedHost &&
          /^\/embed\/[A-Za-z0-9_-]+/.test(url.pathname)
        );
      } catch (e) {
        return false;
      }
    }
    Array.from(doc.body.querySelectorAll("*")).forEach(function (el) {
      if (!allowedTags.has(el.tagName)) {
        if (dangerousTags.has(el.tagName)) el.remove();
        else el.replaceWith.apply(el, Array.from(el.childNodes));
        return;
      }
      if (
        el.tagName === "IFRAME" &&
        !trustedVideoEmbed(el.getAttribute("src"))
      ) {
        el.remove();
        return;
      }
      const attrs = el.tagName === "IFRAME" ? iframeAttrs : allowedAttrs;
      Array.from(el.attributes).forEach(function (attr) {
        const name = attr.name.toLowerCase();
        if (
          !attrs.has(name) ||
          ((name === "href" || name === "src" || name === "srcset") &&
            !safeUrl(attr.value))
        ) {
          el.removeAttribute(attr.name);
        }
      });
      if (el.tagName === "A" && el.hasAttribute("href")) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      if (el.tagName === "IMG") {
        el.setAttribute("loading", "lazy");
        if (el.hasAttribute("src")) {
          const original = el.getAttribute("src");
          el.setAttribute("data-original", original);
          el.setAttribute("src", newsImage(original));
        }
      }
      if (el.hasAttribute("srcset")) {
        el.setAttribute(
          "srcset",
          el
            .getAttribute("srcset")
            .split(",")
            .map(function (entry) {
              const parts = entry.trim().split(/\s+/);
              parts[0] = newsImage(parts[0]);
              return parts.join(" ");
            })
            .join(", "),
        );
      }
      if (el.tagName === "IFRAME") {
        el.className = "news-embed";
        el.setAttribute("loading", "lazy");
        el.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      }
    });
    return doc.body.innerHTML;
  }

  function loadNews(fresh) {
    if (newsLoadPromise) return newsLoadPromise;
    newsError.value = "";
    newsLoading.value = true;
    newsLoadPromise = deps.api
      .request("/api/news-index", { fresh: !!fresh })
      .then(function (d) {
        newsLoadPromise = null;
        newsItems.value = (d && d.information_list) || [];
        newsLoading.value = false;
      })
      .catch(function () {
        newsLoadPromise = null;
        newsLoading.value = false;
        newsError.value =
          "新闻列表暂时无法载入，请稍后重试。";
      });
    return newsLoadPromise;
  }

  function newsHeroCover(n) {
    if (!n) return newsDefaultCover;
    return newsImage(n.image || newsDefaultCover);
  }

  function newsImage(value) {
    if (!value) return "";
    const base =
      newsDetail.value && newsDetail.value.source === "lantis"
        ? "https://umamusume.lantis.jp/"
        : "https://umamusume.jp/";
    try {
      const url = new URL(value, base);
      if (
        ["prd-info-umamusume.akamaized.net", "umamusume.lantis.jp"].includes(
          url.hostname,
        )
      ) {
        return "/api/news-image?url=" + encodeURIComponent(url.href);
      }
      return value;
    } catch (error) {
      return value;
    }
  }

  function cancelNewsDetailRequest() {
    if (newsTranslationRequest) newsTranslationRequest.abort();
    newsTranslationRequest = null;
    if (newsDetailRequest) clearTimeout(newsDetailRequest.timer);
    if (newsDetailRequest && newsDetailRequest.controller)
      newsDetailRequest.controller.abort();
    newsDetailRequest = null;
    newsDetailLoading.value = false;
  }

  async function pollNewsTranslation(request, detail) {
    clearTimeout(request.timer);
    newsDetailLoading.value = false;
    if (detail.archive_state !== 'pending')
      return;
    const controller = new AbortController();
    newsTranslationRequest = controller;
    const endpoint = String(request.key).startsWith("lantis-")
      ? "/api/lantis-detail"
      : "/api/news-detail";
    const deadline = setTimeout(() => controller.abort(), 120000);
    try {
      while (
        !controller.signal.aborted &&
        deps.currentUrlPath().split("?")[0] === request.path
      ) {
        await new Promise((resolve) => {
          const done = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, 3000);
          controller.signal.addEventListener("abort", done, { once: true });
        });
        if (controller.signal.aborted) break;
        const response = await fetch(
          endpoint + "?id=" + encodeURIComponent(request.key),
          { cache: "no-cache", signal: controller.signal },
        );
        if (!response.ok) break;
        const data = await response.json();
        if (
          controller.signal.aborted ||
          deps.currentUrlPath().split("?")[0] !== request.path ||
          newsTranslationRequest !== controller
        )
          break;
        if (data.detail) {
          Object.assign(newsDetail.value, data.detail);
          renderNewsBody();
        }
        if (data.detail && data.detail.archive_state !== 'pending') break;
      }
    } catch (_) {
      /* The readable article remains available on a poll failure. */
    } finally {
      clearTimeout(deadline);
      if (newsTranslationRequest === controller) newsTranslationRequest = null;
    }
  }

  function newsDetailPlaceholder(id, source) {
    const key = String(id);
    const item =
      newsItems.value.find(function (candidate) {
        return String(candidate.announce_id) === key;
      }) || null;
    return {
      announce_id: id,
      title: (item && item.title) || "",
      title_zh: (item && item.title_zh) || "",
      post_at: (item && item.post_at) || "",
      source: source || (item && item.source) || "",
      url: (item && item.url) || "",
      image: (item && item.image) || "",
      image_big: (item && (item.image_big || item.image)) || "",
    };
  }

  function startNewsDetailRequest(id) {
    const key = String(id);
    const path = deps.routes.news(key);
    if (
      newsDetailRequest &&
      newsDetailRequest.key === key &&
      newsDetailRequest.path === path
    )
      return null;
    cancelNewsDetailRequest();
    const request = {
      key: key,
      path: path,
      controller:
        typeof AbortController !== "undefined" ? new AbortController() : null,
    };
    request.timer = setTimeout(function () {
      request.timedOut = true;
      leaveFailedNewsDetail(request, new Error("detail request timed out"));
      if (request.controller) request.controller.abort();
    }, 25000);
    newsDetailRequest = request;
    newsDetailLoading.value = true;
    return request;
  }

  function newsDetailRequestIsCurrent(request) {
    return (
      newsDetailRequest === request &&
      deps.currentUrlPath().split("?")[0] === request.path &&
      deps.activeTab.value === "news"
    );
  }

  function leaveFailedNewsDetail(request, error) {
    if (!newsDetailRequestIsCurrent(request)) return;
    console.error("[news] detail " + request.key + ": " + error.message);
    cancelNewsDetailRequest();
    newsDetailBody.value = "";
    newsError.value = /HTTP 404/.test(error.message) ? '这篇新闻不存在或已下架。' : '新闻暂时无法载入，请重试。';
    newsPrevId.value = 0;
    newsNextId.value = 0;
  }

  function openNews(id) {
    if (!id) return;
    if (
      newsDetailRequest &&
      newsDetailRequest.key === String(id) &&
      newsDetailRequestIsCurrent(newsDetailRequest)
    )
      return newsDetailRequest.promise;
    deps.beginEntityNavigation();
    deps.clearEntityDetails("news");
    const isLantis = String(id).indexOf("lantis-") === 0;
    newsError.value = "";
    newsLanguage.value = 'zh';
    deps.activeTab.value = "news";
    newsDetail.value = newsDetailPlaceholder(id, isLantis ? "lantis" : "");
    newsDetailBody.value = "";
    newsPrevId.value = 0;
    newsNextId.value = 0;
    deps.resetPageScroll();
    deps.pushUrl();
    const request = startNewsDetailRequest(id);
    if (!request) return newsDetailRequest && newsDetailRequest.promise;
    const requestOptions = { cache: "no-cache" };
    if (request.controller) requestOptions.signal = request.controller.signal;
    if (isLantis) {
      // Lantis CD-related item: crawl body via the proxy server.
      const item = newsDetail.value;
      request.promise = fetch(
        "/api/lantis-detail?id=" + encodeURIComponent(id),
        requestOptions,
      )
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (d) {
          if (!d || !d.detail || !d.detail.announce_id)
            throw new Error("no detail");
          if (!newsDetailRequestIsCurrent(request)) return;
          const dd = d.detail;
          newsDetail.value = {
            ...dd,
            announce_id: dd.announce_id,
            title: dd.title || (item && item.title) || "",
            title_zh: dd.title_zh || (item && item.title_zh) || dd.title || "",
            post_at: dd.post_at || (item && item.post_at) || "",
            source: "lantis",
            url: dd.url || (item && item.url) || "",
            image: dd.image || (item && item.image) || "",
          };
          renderNewsBody();
          pollNewsTranslation(request, dd);
        })
        .catch(function (error) {
          if (error && error.name === "AbortError") return;
          leaveFailedNewsDetail(request, error);
        })
        .finally(function () {
          clearTimeout(request.timer);
          if (newsDetailRequest === request) {
            newsDetailRequest = null;
            newsDetailLoading.value = false;
          }
        });
      return request.promise;
    }
    request.promise = fetch(
      "/api/news-detail?id=" + encodeURIComponent(id),
      requestOptions,
    )
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.detail || !d.detail.announce_id)
          throw new Error("no detail");
        if (!newsDetailRequestIsCurrent(request)) return;
        newsDetail.value = d.detail;
        renderNewsBody();
        newsPrevId.value = d.prev_announce_id || 0;
        newsNextId.value = d.next_announce_id || 0;
        pollNewsTranslation(request, d.detail);
      })
      .catch(function (error) {
        if (!error || error.name !== "AbortError") {
          leaveFailedNewsDetail(request, error);
        }
      })
      .finally(function () {
        clearTimeout(request.timer);
        if (newsDetailRequest === request) {
          newsDetailRequest = null;
          newsDetailLoading.value = false;
        }
      });
    return request.promise;
  }
  function start() {
    deps.watch(
      newsRange,
      function () {
        if (!deps.restoringRoute) {
          newsPage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      newsType,
      function () {
        if (!deps.restoringRoute) {
          newsPage.value = 1;
          deps.pushUrl(true);
        }
      },
      { flush: "sync" },
    );
    deps.watch(
      [
        newsPageCount,
        deps.creatorPageCount,
        deps.horsePageCount,
        deps.relPageCount,
      ],
      function () {
        if (!deps.restoringRoute) deps.clampLocalPages();
      },
    );
  }
  return {
    start,
    cancelNewsDetailRequest,
    goNewsPage,
    loadNews,
    newsDate,
    newsDetail,
    newsDetailBody,
    newsLanguage,
    setNewsLanguage,
    newsDetailLoading,
    get newsDetailRequest() {
      return newsDetailRequest;
    },
    set newsDetailRequest(value) {
      newsDetailRequest = value;
    },
    newsError,
    newsFiltered,
    newsHero,
    newsHeroCover,
    newsImage,
    newsItems,
    newsLoading,
    newsNextId,
    newsPage,
    newsPageCount,
    newsPageEnd,
    newsPageList,
    newsPageStart,
    newsPaged,
    newsPrevId,
    newsRange,
    newsTitle,
    newsType,
    newsTypeLabel,
    newsTypeOf,
    openNews,
    setNewsPage,
  };
}
