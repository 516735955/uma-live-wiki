// Templates load only when their route is visible; the player stays mounted.
const pages = {
  news: "/uma_tools/frontend/views/news.js",
  events: "/uma_tools/frontend/views/events.js",
  songs: "/uma_tools/frontend/views/songs.js",
  creators: "/uma_tools/frontend/views/creators.js",
  voice: "/uma_tools/frontend/views/voice.js",
  albums: "/uma_tools/frontend/views/albums.js",
  characters: "/uma_tools/frontend/views/characters.js",
  anime: "/uma_tools/frontend/views/anime.js",
  staff: "/uma_tools/frontend/views/staff.js",
  horses: "/uma_tools/frontend/views/horses.js",
  links: "/uma_tools/frontend/views/links.js",
  "contribute-fix": "/uma_tools/frontend/views/contribute-fix.js",
  "contribute-contact": "/uma_tools/frontend/views/contribute-contact.js",
  "legal-privacy": "/uma_tools/frontend/views/legal-privacy.js",
  "legal-terms": "/uma_tools/frontend/views/legal-terms.js",
};
const loading = { template: '<div class="ui-state loading">正在加载页面…</div>' };
const failure = {
  template: '<div class="ui-state ui-state-error">页面加载失败。<button class="ui-retry" @click="retry">重试</button></div>',
  methods: { retry() { location.reload(); } },
};

export function registerPages(app) {
  for (const [name, url] of Object.entries(pages)) {
    let revision = 0;
    app.component(name + "-page", Vue.defineAsyncComponent({
      timeout: 25000,
      loadingComponent: loading,
      errorComponent: failure,
      async loader() {
        const page = await import(url + (revision ? "?retry=" + revision : ""));
        return {
          template: page.template,
          mounted() {
            if (name === 'characters') {
              window.UmaCharacterUi?.init();
              this.$root.renderCharBlood();
            }
          },
          setup() {
            const view = Vue.getCurrentInstance().proxy.$root;
            return Object.fromEntries(page.bindings.map(name => [
              name,
              Vue.computed({
                get: () => view[name],
                set: value => { view[name] = value; },
              }),
            ]));
          },
        };
      },
      onError(error, retry, fail, attempts) {
        if (attempts >= 3) { fail(); return; }
        revision += 1;
        setTimeout(retry, 500 * attempts);
      },
    }));
  }
}
