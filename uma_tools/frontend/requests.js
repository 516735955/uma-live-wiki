const lists = {
  songs: { size: 30, fields: [] },
  albums: { size: 30, fields: ['type', 'work', 'release_series', 'year', 'sort'], defaults: { sort: 'newest' } },
  creators: { size: 40, fields: [], defaults: { type: 'person' } },
  events: { size: 20, fields: ['time', 'kind', 'mode', 'year', 'series'] },
  venues: { size: 30, fields: [] },
  horses: { size: 30, fields: ['sex', 'sort'], defaults: { sort: 'newest' } },
};

export function catalogPageSize(name) {
  return lists[name].size;
}

function requestPath(path, values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '' && (value !== 'all' || key === 'q' || key === 'id')) query.set(key, value);
  }
  query.sort();
  const suffix = query.toString();
  return suffix ? path + '?' + suffix : path;
}

export function catalogPath(name, params = {}) {
  const path = '/api/catalog/' + name;
  const list = lists[name];
  if (!list || params.scope === 'index') return requestPath(path, params);
  const values = { ...list.defaults };
  for (const field of list.fields) if (params[field]) values[field] = params[field];
  values.q = String(params.q || '').trim();
  values.page = Math.max(1, parseInt(params.page, 10) || 1);
  values.page_size = list.size;
  return requestPath(path, values);
}

export function newsIndexPath(query) {
  return requestPath('/api/news-index', { q: String(query || '').trim() });
}

export function newsDetailPath(id) {
  return requestPath(id.startsWith('lantis-') ? '/api/lantis-detail' : '/api/news-detail', { id });
}

export function routeRequest(path) {
  const url = new URL(path, 'https://uma.invalid');
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  let section, id, unit;
  try {
    section = decodeURIComponent(parts[1] || '');
    id = decodeURIComponent(parts[2] || '');
    unit = decodeURIComponent(parts[4] || '');
  } catch (_) { return null; }
  const params = Object.fromEntries(url.searchParams);
  const [area] = parts;
  const catalog = (name, query) => ({ path: catalogPath(name, query) });
  if (area === 'news') return { path: section ? newsDetailPath(section) : newsIndexPath(params.q), news: true };
  if (area === 'music' && ['songs', 'albums', 'creators'].includes(section)) {
    return id ? catalog({ songs: 'song', albums: 'album', creators: 'creator' }[section], { id }) : catalog(section, params);
  }
  if (area === 'events') return section ? catalog('event', { id: section }) : catalog('events', params);
  if (area !== 'database') return null;
  if (section === 'voice-actors') return catalog(section, id ? { id } : { scope: 'index' });
  if (section === 'venues' || section === 'horses') {
    return id ? catalog(section === 'venues' ? 'venue' : 'horse', { id }) : catalog(section, params);
  }
  if (section === 'anime' || section === 'staff') {
    const scope = section === 'staff' ? (id ? 'person' : 'people') : (unit ? 'unit' : id ? 'work' : 'index');
    return catalog('anime', { scope, id: unit || id });
  }
  return null;
}

export function createCatalogList(deps, { name, loading, error, message }) {
  let revision = 0;
  let timer;
  let controller;
  function cancel() {
    revision++;
    clearTimeout(timer);
    controller?.abort();
    controller = null;
  }
  function schedule(isCurrent, run, delay = 180) {
    cancel();
    error.value = '';
    loading.value = true;
    timer = setTimeout(() => {
      if (isCurrent()) run();
      else loading.value = false;
    }, delay);
  }
  async function load(params, accept) {
    cancel();
    const request = revision;
    controller = new AbortController();
    const pathname = window.location.pathname;
    loading.value = true;
    error.value = '';
    try {
      const data = await deps.api.request(catalogPath(name, params), { signal: controller.signal });
      if (request !== revision || pathname !== window.location.pathname) return;
      if (!Array.isArray(data?.items)) throw new Error('Invalid catalog list');
      accept(data);
    } catch (failure) {
      if (request === revision && pathname === window.location.pathname && failure.name !== 'AbortError') error.value = message;
    } finally {
      if (request === revision) {
        loading.value = false;
        controller = null;
      }
    }
  }
  return { load, schedule };
}
