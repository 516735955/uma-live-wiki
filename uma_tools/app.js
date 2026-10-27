import { registerComponents } from "/uma_tools/frontend/components.js";
import { createViewModel } from "/uma_tools/frontend/view-model.js";
import { registerPages } from "/uma_tools/frontend/pages.js";
import { createDomains } from "/uma_tools/frontend/domains.js";
import { installNavigationPrefetch } from '/uma_tools/frontend/navigation-prefetch.js';

const { createApp, ref, reactive, computed, watch } = Vue;
const api = window.UmaApi;
const routes = window.UmaRoutes;
const LANG_PREFIX = routes.prefix;

const umaApp = createApp({
  setup() {
    const domains = createDomains({
      Vue,
      api,
      routes,
      LANG_PREFIX,
      ref,
      reactive,
      computed,
      watch,
    });
    return createViewModel(domains, routes);
  },
  provide() {
    return {
      animeArtwork: this.animeArtwork,
      animePeople: () => this.animeCatalog.people,
    };
  },
  mounted() {
    const boot = document.getElementById("app-boot");
    if (boot) boot.remove();
    this.bindAudio();
    const self = this;
    window.__uma_app = this;
    this.stopNavigationPrefetch = installNavigationPrefetch(api);
    let popRevision = 0;
    let restoreRevision = 0;
    let renderedRevision = 0;
    window.addEventListener('uma-page-rendered', () => { renderedRevision += 1; });
    function restoreScrollWhenReady(target, revision, path) {
      const job = ++restoreRevision;
      const startY = window.scrollY;
      const renderStart = renderedRevision;
      let observer;
      let frame = 0;
      const deadline = performance.now() + 4000;
      const stop = () => {
        observer?.disconnect();
        if (frame) cancelAnimationFrame(frame);
      };
      const attempt = () => {
        if (
          job !== restoreRevision ||
          revision !== popRevision ||
          window.location.pathname + window.location.search !== path
        ) {
          stop();
          return;
        }
        // A scroll before the list is ready is a user decision; never
        // overwrite it with the stale history position.
        if (Math.abs(window.scrollY - startY) > 2) {
          stop();
          return;
        }
        const loading = document.querySelector('#app .ui-state.loading, #app [aria-busy="true"]');
        if (!self.routeReady || renderedRevision <= renderStart || loading) {
          if (performance.now() >= deadline) stop();
          else frame = window.requestAnimationFrame(attempt);
          return;
        }
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        frame = window.requestAnimationFrame(() => {
          if (job !== restoreRevision || revision !== popRevision ||
              window.location.pathname + window.location.search !== path ||
              Math.abs(window.scrollY - startY) > 2) {
            stop();
            return;
          }
          window.scrollTo(0, Math.min(target, maxScroll));
          stop();
        });
      };
      observer = new MutationObserver(attempt);
      observer.observe(document.querySelector('#app') || document.body, {
        childList: true,
        subtree: true,
      });
      window.requestAnimationFrame(attempt);
    }
    const syncPrepared = function (event) {
      const revision = ++popRevision;
      const scrollY =
        event && event.type === "popstate"
          ? Number((history.state || {}).scrollY || 0)
          : null;
      const preparedPath = window.location.pathname + window.location.search;
      self.applyCurrentRoute().then(function () {
        if (
          revision !== popRevision ||
          window.location.pathname + window.location.search !== preparedPath
        )
          return;
        if (scrollY !== null)
          Vue.nextTick(() => restoreScrollWhenReady(scrollY, revision, preparedPath));
      });
    };
    window.addEventListener("popstate", syncPrepared);
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".site-nav")) self.closeNavGroup();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !self.openNavGroup) return;
      const trigger = document.querySelector(
        ".site-nav-item.open > .site-nav-trigger",
      );
      self.closeNavGroup();
      trigger?.focus({ preventScroll: true });
    });
    window.addEventListener("scroll", this.updateBackTop, { passive: true });
    syncPrepared();
    this.loadHomeSummaryIfNeeded();
  },
  beforeUnmount() { this.stopNavigationPrefetch?.(); },
});
registerComponents(umaApp, routes);
umaApp.directive('media-src', {
  mounted(element, binding) { window.UmaMedia.apply(element, binding.value); },
  beforeUpdate(element, binding) {
    if (binding.value === binding.oldValue) return;
    window.UmaMedia.apply(element, binding.value);
  },
  unmounted(element) { window.UmaMedia.release(element); },
});
registerPages(umaApp);
umaApp.mount("#app");
