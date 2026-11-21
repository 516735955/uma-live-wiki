export const DARING_TACT_HERO_CONFIG = Object.freeze({
  id: "daring-tact-2026",
  characterId: "daringtact",
  imageUrl: "/uma_tools/img/daring_tact_stand_107501.png",
  // Seven days in Asia/Shanghai, with an exclusive end.
  startIso: "2026-11-19T00:00:00+08:00",
  endIso: "2026-11-26T00:00:00+08:00",
  crownedStorageKey: "uma_dt_crowned_2026",
});

export function isDaringTactHeroActive(now = new Date(), search = typeof window !== "undefined" ? window.location.search : "") {
  try {
    const params = new URLSearchParams(search || "");
    const override = (params.get("hero") || "").trim().toLowerCase();
    if (override === "daring-tact" || override === "daringtact" || override === "1075") {
      return true;
    }
    if (override === "default" || override === "off" || override === "none") {
      return false;
    }
  } catch (_) {
    // Ignore malformed query strings
  }
  const ts = now instanceof Date ? now.getTime() : Date.parse(now);
  const start = Date.parse(DARING_TACT_HERO_CONFIG.startIso);
  const end = Date.parse(DARING_TACT_HERO_CONFIG.endIso);
  return Number.isFinite(ts) && ts >= start && ts < end;
}

export function preloadHomeHero() {
  if (typeof document === "undefined" || !["/", "/zh-Hans", "/zh-Hans/"].includes(window.location.pathname)) return;
  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "image";
  preload.fetchPriority = "high";
  if (isDaringTactHeroActive()) {
    preload.type = "image/png";
    preload.href = DARING_TACT_HERO_CONFIG.imageUrl;
  } else {
    preload.type = "image/avif";
    preload.href = window.matchMedia("(max-width:480px)").matches
      ? "/uma_tools/img/hero_bg_phone.avif"
      : window.matchMedia("(max-width:768px)").matches
        ? "/uma_tools/img/hero_bg_tablet.avif"
        : "/uma_tools/img/hero_bg.avif";
  }
  document.head.appendChild(preload);
}

export function getDaringTactCrowned() {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(DARING_TACT_HERO_CONFIG.crownedStorageKey) === "1";
  } catch (_) {
    return false;
  }
}

export function setDaringTactCrowned(value) {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (value) sessionStorage.setItem(DARING_TACT_HERO_CONFIG.crownedStorageKey, "1");
    else sessionStorage.removeItem(DARING_TACT_HERO_CONFIG.crownedStorageKey);
  } catch (_) {
    // Ignore storage quota / privacy mode errors
  }
  syncDaringTactBodyTheme();
}

export function syncDaringTactBodyTheme(mode = null) {
  if (typeof document === "undefined" || !document.body) return;
  const body = document.body;
  if (mode === "home") {
    body.classList.add("dt-home-theme");
    body.classList.remove("dt-detail-theme");
  } else if (mode === "detail") {
    body.classList.add("dt-detail-theme");
    body.classList.remove("dt-home-theme");
  } else if (mode === "none") {
    body.classList.remove("dt-home-theme", "dt-detail-theme", "dt-crowned-theme", "ui-theme-dark");
    if (body.dataset) {
      delete body.dataset.theme;
      delete body.dataset.variant;
    }
    return;
  }
  if (body.classList.contains("dt-home-theme") || body.classList.contains("dt-detail-theme")) {
    const crowned = getDaringTactCrowned();
    body.classList.add("ui-theme-dark");
    body.classList.toggle("dt-crowned-theme", crowned);
    if (body.dataset) {
      body.dataset.theme = "night";
      body.dataset.variant = crowned ? "daring-tact-crowned" : "daring-tact";
    }
  }
  document.dispatchEvent?.(new CustomEvent("uma-campaign-theme"));
}

export function syncDaringTactRouteTheme() {
  if (typeof document !== "undefined" && document.body && document.body.dataset && document.body.dataset.dtTransitioning === "1") {
    return;
  }
  const path = window.location.pathname.replace(/\/$/, "");
  const active = isDaringTactHeroActive();
  const mode = !active ? "none" : ["", "/zh-Hans"].includes(path) ? "home"
    : /^\/zh-Hans\/database\/characters\/daringtact(?:\/|$)/i.test(path) ? "detail" : "none";
  syncDaringTactBodyTheme(mode);
}

// Cinematic fluted-glass prism curtain when transitioning from homepage to Daring Tact detail page
export function triggerDaringTactTransition(navigateFn) {
  if (typeof document === "undefined" || !document.body || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    syncDaringTactBodyTheme("detail");
    if (typeof navigateFn === "function") navigateFn();
    return;
  }
  const existing = document.getElementById("dt-transition-curtain");
  if (existing) existing.remove();

  // Lock dark detail theme immediately so no daylight Cobalt/Orange frame can ever flash during route swap
  if (document.body.dataset) document.body.dataset.dtTransitioning = "1";
  syncDaringTactBodyTheme("detail");

  const crowned = getDaringTactCrowned();
  const curtain = document.createElement("div");
  curtain.id = "dt-transition-curtain";
  curtain.className = "dt-transition-curtain" + (crowned ? " is-crowned" : "");
  curtain.innerHTML = '<div class="dt-curtain-mark">DARING TACT</div>';
  document.body.appendChild(curtain);

  requestAnimationFrame(() => {
    curtain.classList.add("is-entering");
  });

  let finished = false;
  function leaveCurtain() {
    if (finished) return;
    finished = true;
    window.removeEventListener("uma-page-rendered", onRendered);
    requestAnimationFrame(() => {
      curtain.classList.remove("is-entering");
      curtain.classList.add("is-leaving");
      setTimeout(() => {
        if (document.body.dataset) delete document.body.dataset.dtTransitioning;
        syncDaringTactRouteTheme();
        curtain.remove();
      }, 420);
    });
  }
  function onRendered() {
    setTimeout(leaveCurtain, 60);
  }

  setTimeout(() => {
    window.addEventListener("uma-page-rendered", onRendered, { once: true });
    let pending = null;
    if (typeof navigateFn === "function") pending = navigateFn();
    if (pending && typeof pending.then === "function") {
      pending.then(() => setTimeout(leaveCurtain, 80)).catch(leaveCurtain);
    }
    setTimeout(leaveCurtain, 700);
  }, 240);
}
