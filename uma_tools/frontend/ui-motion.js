/* Lightweight kinetic UI motion coordinator:
 * 1. Sliding slanted ink-bar for `.entity-tabs` (with horizontal scroll support on mobile)
 * 2. Subtle sticky-header scroll depth toggle (`body.is-scrolled`)
 */
export function installUiMotion() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  let rafId = 0;

  function syncTabInkBars(scrollActiveIntoView = false) {
    const navs = document.querySelectorAll(".entity-tabs");
    for (const nav of navs) {
      const active = nav.querySelector("button.active");
      if (!active) {
        nav.classList.remove("has-ink-bar");
        continue;
      }
      if (scrollActiveIntoView && nav.scrollWidth > nav.clientWidth + 4) {
        active.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
      const x = active.offsetLeft + 10;
      const w = Math.max(24, active.offsetWidth - 20);
      nav.style.setProperty("--tab-x", `${Math.round(x)}px`);
      nav.style.setProperty("--tab-w", `${Math.round(w)}px`);
      nav.classList.add("has-ink-bar");
    }
  }

  function scheduleSync(scrollActive = false) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      syncTabInkBars(scrollActive);
    });
  }

  function syncScrollDepth() {
    document.body.classList.toggle("is-scrolled", window.scrollY > 14);
  }

  function onClick(event) {
    if (event.target && event.target.closest && event.target.closest(".entity-tabs button")) {
      scheduleSync(true);
      setTimeout(() => scheduleSync(false), 60);
    }
  }

  const observer = new MutationObserver(() => scheduleSync(false));
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  window.addEventListener("scroll", syncScrollDepth, { passive: true });
  window.addEventListener("resize", () => scheduleSync(false), { passive: true });
  window.addEventListener("uma-page-rendered", () => scheduleSync(false));
  document.addEventListener("click", onClick, true);
  syncScrollDepth();
  scheduleSync(false);

  return () => {
    if (rafId) cancelAnimationFrame(rafId);
    observer.disconnect();
    window.removeEventListener("scroll", syncScrollDepth);
    document.removeEventListener("click", onClick, true);
  };
}
