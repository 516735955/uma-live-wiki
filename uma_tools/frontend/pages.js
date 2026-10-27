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
const modules = new Map();
const failures = new Map();
const scripts = new Map();
function preloadScript(url) {
  if (Date.now() - (scripts.get(url) || 0) < 300000) return;
  const link = document.createElement('link');
  link.rel = 'preload'; link.as = 'script'; link.href = url;
  link.onload = link.onerror = () => link.remove();
  document.head.append(link); scripts.set(url, Date.now());
}
export function pageNameForPath(path) {
  const parts = new URL(path, 'https://uma.invalid').pathname.split('/').filter(Boolean);
  if (parts[0] === 'zh-Hans') parts.shift();
  if (parts[0] === 'events') return 'events';
  if (parts[0] === 'music') return parts[1] || 'albums';
  if (parts[0] === 'database') return ({'voice-actors':'voice', horses:'horses'})[parts[1]] || parts[1];
  if (parts[0] === 'resources') return 'links';
  if (parts[0] === 'contribute' || parts[0] === 'legal') return parts.slice(0,2).join('-');
  return parts[0];
}
function loadPage(url, revision = 0) {
  revision = Math.max(revision, failures.get(url) || 0);
  const key = url + (revision ? '?retry=' + revision : '');
  if (!modules.has(key)) modules.set(key, import(key).catch(error => {
    modules.delete(key); failures.set(url, revision + 1); throw error;
  }));
  return modules.get(key);
}
export function preloadPage(path) {
  const name = pageNameForPath(path);
  if (name === 'characters' || name === 'voice') {
    preloadScript('/uma_tools/character-ui.js');
    preloadScript('/data/character_index_data.js');
  }
  const url = pages[name];
  return url ? loadPage(url) : Promise.resolve();
}
const loading = { template: '<content-state state="loading" subject="页面"></content-state>' };
const failure = {
  template: '<content-state state="error" subject="页面" :retry="true" @retry="retry"></content-state>',
};

export function registerPages(app) {
  for (const [name, url] of Object.entries(pages)) {
    let revision = 0;
    function createPage(reload) { return Vue.defineAsyncComponent({
      timeout: 25000,
      loadingComponent: loading,
      errorComponent: { template: failure.template, methods: { retry() { revision++; reload(); } } },
      async loader() {
        const page = await loadPage(url, revision);
        return {
          template: page.template,
          mounted() {
            this.$nextTick(() => window.dispatchEvent(new CustomEvent('uma-page-rendered')));
            if (name === 'characters') {
              window.UmaCharacterUi?.init();
              this.$root.renderCharBlood();
            }
          },
          updated() { window.dispatchEvent(new CustomEvent('uma-page-rendered')); },
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
    }); }
    app.component(name + '-page', {
      setup() {
        const component = Vue.shallowRef();
        const reload = () => { component.value = createPage(reload); };
        reload();
        return () => Vue.h(component.value);
      },
    });
  }
}
