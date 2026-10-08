(function () {
  'use strict';

  const resolved = new Map();
  const pending = new Map();

  function query(params) {
    const search = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '' && value !== 'all') search.set(key, value);
    });
    const text = search.toString();
    return text ? '?' + text : '';
  }

  function request(path, options) {
    const settings = options || {};
    const cacheKey = settings.cacheKey || path;
    const maxAge = Number.isFinite(settings.maxAge) ? settings.maxAge : 5 * 60 * 1000;
    const now = Date.now();
    resolved.forEach(function (entry, key) {
      if (now >= entry.expiresAt) resolved.delete(key);
    });
    const cached = resolved.get(cacheKey);
    if (!settings.fresh && cached && Date.now() - cached.at < maxAge) return Promise.resolve(cached.data);
    if (!settings.fresh && pending.has(cacheKey)) return pending.get(cacheKey);
    const promise = fetch(path, {
      headers: { Accept: 'application/json' },
      cache: settings.fresh ? 'no-cache' : 'default',
      signal: settings.signal
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      if (pending.get(cacheKey) === promise) {
        resolved.set(cacheKey, { at: Date.now(), expiresAt: Date.now() + maxAge, data: data });
        pending.delete(cacheKey);
      }
      return data;
    }).catch(function (error) {
      if (pending.get(cacheKey) === promise) pending.delete(cacheKey);
      throw error;
    });
    pending.set(cacheKey, promise);
    return promise;
  }

  function invalidate(prefix) {
    Array.from(resolved.keys()).forEach(function (key) {
      if (!prefix || String(key).indexOf(prefix) === 0) resolved.delete(key);
    });
  }

  window.UmaApi = Object.freeze({ request: request, query: query, invalidate: invalidate });
})();
