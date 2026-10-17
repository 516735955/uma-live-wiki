import { registerComponents } from "/uma_tools/frontend/components.js";
import { createViewModel } from "/uma_tools/frontend/view-model.js";
import { registerPages } from "/uma_tools/frontend/pages.js";
import { createDomains } from "/uma_tools/frontend/domains.js";

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
    let popRevision = 0;
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
          Vue.nextTick(() =>
            window.requestAnimationFrame(() => window.scrollTo(0, scrollY)),
          );
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
});
registerComponents(umaApp, routes);
umaApp.directive('media-src', {
  mounted(element, binding) { window.UmaMedia.apply(element, binding.value); },
  beforeUpdate(element, binding) {
    if (binding.value === binding.oldValue) return;
    window.UmaMedia.apply(element, binding.value);
  },
});
registerPages(umaApp);
umaApp.mount("#app");
