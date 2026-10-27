import { preloadPage } from '/uma_tools/frontend/pages.js';

// Prefetch reads only; it never changes the active list, filters or route.
export function prefetchRequest(path) {
  const url = new URL(path, 'https://uma.invalid');
  const parts = url.pathname.split('/').filter(Boolean).slice(1);
  const q = new URLSearchParams(url.search);
  const endpoint = (name, defaults = {}) => {
    Object.entries(defaults).forEach(([key,value]) => { if (!q.has(key)) q.set(key,value); });
    return '/api/catalog/' + name + (q.size ? '?' + q : '');
  };
  if (parts[0] === 'news' && parts[1]) return { path: '/api/' + (parts[1].startsWith('lantis-') ? 'lantis-detail' : 'news-detail') + '?id=' + encodeURIComponent(parts[1]), news: true };
  if (parts[0] === 'news') return {path:'/api/news-index' + (q.get('q') ? '?q=' + encodeURIComponent(q.get('q').trim()) : ''),news:true};
  if (parts[0] === 'music') {
    const section = parts[1];
    if (!['songs','albums','creators'].includes(section)) return null;
    if (parts[2]) return { path: '/api/catalog/' + ({songs:'song',albums:'album',creators:'creator'})[section] + '?id=' + encodeURIComponent(parts[2]) };
    return { path: endpoint(section, section === 'creators' ? {type:'person',page_size:40} : {page_size:30}) };
  }
  if (parts[0] === 'events') return { path: parts[1] ? '/api/catalog/event?id=' + encodeURIComponent(parts[1]) : endpoint('events',{page_size:20}) };
  if (parts[0] === 'database' && parts[1] === 'voice-actors') return { path: '/api/catalog/voice-actors?' + (parts[2] ? 'id=' + encodeURIComponent(parts[2]) : 'scope=index') };
  if (parts[0] === 'database' && parts[1] === 'horses') return {path:parts[2]
    ? '/api/catalog/horse?id=' + encodeURIComponent(parts[2]) : endpoint('horses',{sort:'newest',page_size:30})};
  if (parts[0] === 'database' && ['anime','staff'].includes(parts[1])) {
    const scope = parts[1] === 'staff' ? (parts[2] ? 'person' : 'people') : (parts[4] ? 'unit' : parts[2] ? 'work' : 'index');
    return {path:'/api/catalog/anime?scope=' + scope + ((parts[4] || parts[2]) ? '&id=' + encodeURIComponent(parts[4] || parts[2]) : '')};
  }
  return null;
}

export function installNavigationPrefetch(api) {
  const queued = new Map();
  const waiting = [];
  let active = 0, hoverTimer;
  const connection = navigator.connection;
  const slow = () => connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '');
  function enqueue(anchor) {
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/zh-Hans/')) return;
    const path = url.pathname + url.search;
    if (Date.now() - (queued.get(path) || 0) < 3000) return;
    queued.set(path, Date.now()); waiting.push(path);
    if (waiting.length > 16) queued.delete(waiting.shift());
    if (queued.size > 64) queued.delete(queued.keys().next().value);
    pump();
  }
  function pump() {
    while (active < 2 && waiting.length) {
      const path = waiting.shift(); active++;
      const request = prefetchRequest(path);
      Promise.all([preloadPage(path), request ? api.request(request.path, request.news ? {prefetch:true,maxAge:3000} : {}) : null])
        .catch(() => { queued.delete(path); })
        .finally(() => { active--; pump(); });
    }
  }
  const link = event => event.target.closest?.('a[href]');
  const hover = event => {
    clearTimeout(hoverTimer);
    if (!slow()) hoverTimer = setTimeout(() => enqueue(link(event)), 90);
  };
  const cancelHover = () => clearTimeout(hoverTimer);
  const focus = event => { if (!slow()) enqueue(link(event)); };
  const touch = event => { if (event.pointerType === 'touch') enqueue(link(event)); };
  document.addEventListener('pointerover', hover);
  document.addEventListener('pointerout', cancelHover);
  document.addEventListener('focusin', focus);
  document.addEventListener('pointerdown', touch, {passive:true});
  return () => {
    cancelHover(); waiting.length = 0;
    document.removeEventListener('pointerover',hover); document.removeEventListener('pointerout',cancelHover);
    document.removeEventListener('focusin',focus); document.removeEventListener('pointerdown',touch);
  };
}
