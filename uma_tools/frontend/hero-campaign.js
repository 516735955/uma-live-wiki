export const DARING_TACT_HERO_CONFIG = Object.freeze({
  id: "daring-tact-2026",
  characterId: "daringtact",
  imageUrl: "/uma_tools/img/daring_tact_stand_107501.png",
  // 7-day celebration window (Asia/Shanghai, inclusive)
  startIso: "2026-11-19T00:00:00+08:00",
  endIso: "2026-11-26T23:59:59+08:00",
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
  return Number.isFinite(ts) && ts >= start && ts <= end;
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
    body.classList.remove("dt-home-theme", "dt-detail-theme", "dt-crowned-theme");
    return;
  }
  if (body.classList.contains("dt-home-theme") || body.classList.contains("dt-detail-theme")) {
    body.classList.toggle("dt-crowned-theme", getDaringTactCrowned());
  }
}

// Cinematic fluted-glass prism curtain when transitioning from homepage to Daring Tact detail page
export function triggerDaringTactTransition(navigateFn) {
  if (typeof document === "undefined" || !document.body || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    if (typeof navigateFn === "function") navigateFn();
    return;
  }
  const existing = document.getElementById("dt-transition-curtain");
  if (existing) existing.remove();

  const crowned = getDaringTactCrowned();
  const curtain = document.createElement("div");
  curtain.id = "dt-transition-curtain";
  curtain.className = "dt-transition-curtain" + (crowned ? " is-crowned" : "");
  curtain.innerHTML = '<div class="dt-curtain-mark">DARING TACT</div>';
  document.body.appendChild(curtain);

  requestAnimationFrame(() => {
    curtain.classList.add("is-entering");
  });

  setTimeout(() => {
    if (typeof navigateFn === "function") navigateFn();
    requestAnimationFrame(() => {
      curtain.classList.remove("is-entering");
      curtain.classList.add("is-leaving");
    });
  }, 260);

  setTimeout(() => {
    curtain.remove();
  }, 760);
}
