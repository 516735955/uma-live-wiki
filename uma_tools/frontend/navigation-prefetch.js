import { preloadPage } from '/uma_tools/frontend/pages.js';
import { routeRequest } from '/uma_tools/frontend/requests.js';

export const prefetchRequest = routeRequest;

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
