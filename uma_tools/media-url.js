(function (root) {
  'use strict';
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
  root.UmaMedia = { url };
})(window);
