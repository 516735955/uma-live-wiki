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
      if (target.origin === location.origin && target.pathname === '/api/news-image') {
        target.searchParams.set('w', width);
        return target.pathname + target.search;
      }
      if (target.hostname === 'images.microcms-assets.io') {
        target.searchParams.set('w', width);
        target.searchParams.set('fm', 'webp');
        target.searchParams.set('q', '78');
        return target.href;
      }
      if (/^p\d+\.music\.126\.net$/.test(target.hostname)) {
        target.searchParams.set('param', width + 'y' + width);
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
    if (!value) { element.removeAttribute('src'); element.removeAttribute('srcset'); delete element.dataset.mediaOriginal; return; }
    const small = element.closest('.performer-chip, .album-inline, .identity-portrait, .anime-episode-list, .relation-leading');
    const card = element.closest('.albums-grid, .news-hero-card, .anime-stills');
    const size = small ? 80 : card ? 360 : 720;
    const targetWidth = [160, 480, 960, 1440].find(width => width >= size * Math.min(devicePixelRatio || 1, 2)) || 1440;
    element.dataset.mediaOriginal = url(value);
    element.decoding = 'async';
    element.src = preview(value, targetWidth);
  }
  return { url, preview, apply, remoteImage };
});
