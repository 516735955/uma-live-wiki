(function (root, factory) {
  const media = factory();
  if (typeof module === 'object' && module.exports) module.exports = media;
  if (root) root.UmaMedia = media;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const remoteHosts = new Set(['i.ytimg.com', 'is1-ssl.mzstatic.com', 'www.kenproduction.co.jp',
    'across-ent.com', 'columbia.jp', 'www.vims.co.jp', 'osawa-inc.co.jp', 'www.81produce.co.jp',
    'crazy-box.co.jp', 'voicekit.jp', 'tomorrowjam.jp', 'yuhko-kaida.com', 'aptepro.jp',
    'st-kai.jp', 'anime-fantasista-japan.jp']);
  function remoteImage(value) {
    try {
      const target = new URL(value);
      return target.protocol === 'https:' && !target.username && !target.password && !target.port &&
        remoteHosts.has(target.hostname) && /\.(?:png|jpe?g|webp|gif)$/i.test(target.pathname) ? target : null;
    } catch (_) { return null; }
  }
  function url(value) {
    if (!value) return value;
    const revision = document.querySelector('meta[name="uma-release"]')?.content;
    if (!revision) return value;
    try {
      const target = new URL(value, location.href);
      if (target.origin !== location.origin || !/^\/(?:data|uma_tools\/img|album_covers|uma_avatars|uma_moe|uma_official|uma_va|video_thumbs)\//.test(target.pathname)) return value;
      target.searchParams.set('v', revision);
      return target.pathname + target.search + target.hash;
    } catch { return value; }
  }
  function preview(value, width) {
    if (!value) return value;
    try {
      const target = new URL(value, location.href);
      if (target.origin === location.origin && ['/api/news-image', '/api/image'].includes(target.pathname)) {
        target.searchParams.set('w', width);
        return target.pathname + target.search;
      }
      if (target.hostname === 'images.microcms-assets.io') {
        const existing = Number(target.searchParams.get('w'));
        target.searchParams.set('w', existing > 0 ? Math.min(existing, width) : width);
        target.searchParams.set('fm', 'webp');
        target.searchParams.set('q', '78');
        return target.href;
      }
      if (/^p\d+\.music\.126\.net$/.test(target.hostname)) {
        const existing = /^(\d+)y\d+$/.exec(target.searchParams.get('param') || '');
        const pixels = existing ? Math.min(Number(existing[1]), width) : width;
        target.searchParams.set('param', pixels + 'y' + pixels);
        return target.href;
      }
      if (remoteImage(target.href)) return '/api/image?url=' + encodeURIComponent(target.href) + '&w=' + width;
      if (target.origin === location.origin && /^\/(?:uma_tools\/img|album_covers|uma_avatars|uma_moe|uma_official|uma_va|video_thumbs)\/.+\.(?:png|jpe?g|webp)$/i.test(target.pathname)) {
        return '/api/image?path=' + encodeURIComponent(url(target.pathname)) + '&w=' + width;
      }
    } catch (_) {}
    return url(value);
  }
  function apply(element, value) {
    if (!value) { release(element); element.removeAttribute('src'); element.removeAttribute('srcset'); delete element.dataset.mediaOriginal; return; }
    value = original(value);
    if (element.dataset.mediaOriginal !== url(value)) {
      element.removeAttribute('data-fallback');
      element.classList.remove('is-missing');
    }
    const small = element.closest('.performer-chip, .album-inline, .identity-portrait, .anime-episode-list, .relation-leading');
    const card = element.closest('.albums-grid, .album-database-grid, .album-card, .news-hero-card, .anime-stills, .event-catalog-cover, .video-library');
    const renderedWidth = element.getBoundingClientRect().width;
    const size = renderedWidth > 0 ? renderedWidth : small ? 80 : card ? 360 : 720;
    const targetWidth = [160, 480, 960, 1440].find(width => width >= size * Math.min(devicePixelRatio || 1, 2)) || 1440;
    element.dataset.mediaOriginal = url(value);
    element.decoding = 'async';
    if (element.tagName === 'IMG') {
      const candidates = [160,480,960,1440].map(width => [preview(value, width),width]);
      if (new Set(candidates.map(row => row[0])).size > 1) {
        element.sizes = Math.ceil(size) + 'px';
        element.srcset = candidates.map(([src,width]) => src + ' ' + width + 'w').join(', ');
        getObserver()?.observe(element);
      } else element.removeAttribute('srcset');
    }
    element.src = preview(value, targetWidth);
  }

  function original(value) {
    try {
      const target = new URL(value, location.href);
      if (target.hostname === 'images.microcms-assets.io') {
        ['w','h','fit','fm','q'].forEach(key => target.searchParams.delete(key));
      }
      if (/^p\d+\.music\.126\.net$/.test(target.hostname)) target.searchParams.delete('param');
      if (target.origin === location.origin && ['/api/image','/api/news-image'].includes(target.pathname)) target.searchParams.delete('w');
      return target.origin === location.origin ? target.pathname + target.search + target.hash : target.href;
    } catch (_) { return value; }
  }

  let observer;
  function getObserver() {
    if (!observer && typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(entries => {
      for (const {target,contentRect} of entries) {
        if (contentRect.width > 0) target.sizes = Math.ceil(contentRect.width) + 'px';
      }
    });
    return observer;
  }
  function release(element) { observer?.unobserve(element); }
  function fallback(element, value) {
    release(element);
    element.removeAttribute('srcset');
    element.removeAttribute('sizes');
    const target = value ? new URL(value, location.href).href : '';
    if (target && element.src !== target) element.src = target;
    if (!target) element.removeAttribute('src');
  }
  return { url, preview, apply, remoteImage, original, release, fallback };
});
