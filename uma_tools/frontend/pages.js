// Templates load only when their route is visible; the player stays mounted.
const pages = {
  news: () => import("/uma_tools/frontend/views/news.js"),
  events: () => import("/uma_tools/frontend/views/events.js"),
  songs: () => import("/uma_tools/frontend/views/songs.js"),
  creators: () => import("/uma_tools/frontend/views/creators.js"),
  voice: () => import("/uma_tools/frontend/views/voice.js"),
  albums: () => import("/uma_tools/frontend/views/albums.js"),
  characters: () => import("/uma_tools/frontend/views/characters.js"),
  anime: () => import("/uma_tools/frontend/views/anime.js"),
  staff: () => import("/uma_tools/frontend/views/staff.js"),
  horses: () => import("/uma_tools/frontend/views/horses.js"),
  links: () => import("/uma_tools/frontend/views/links.js"),
  "contribute-fix": () => import("/uma_tools/frontend/views/contribute-fix.js"),
  "contribute-contact": () => import("/uma_tools/frontend/views/contribute-contact.js"),
  "legal-privacy": () => import("/uma_tools/frontend/views/legal-privacy.js"),
  "legal-terms": () => import("/uma_tools/frontend/views/legal-terms.js"),
};

export function registerPages(app) {
  for (const [name, load] of Object.entries(pages)) {
    app.component(name + "-page", Vue.defineAsyncComponent(async () => {
      const page = await load();
      return {
        template: page.template,
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
    }));
  }
}
