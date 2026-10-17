(function () {
  'use strict';

  const resolved = new Map();
  const pending = new Map();
  const cacheCapacity = 64;
  const cacheBytes = 16 * 1024 * 1024;
  function retain(key, data, maxAge) {
    const size = JSON.stringify(data).length * 2;
    resolved.delete(key);
    if (size > cacheBytes || maxAge <= 0) return;
    resolved.set(key, { at: Date.now(), expiresAt: Date.now() + maxAge, data, size });
    let total = Array.from(resolved.values()).reduce((sum, entry) => sum + entry.size, 0);
    while (resolved.size > cacheCapacity || total > cacheBytes) {
      const oldest = resolved.keys().next().value;
      total -= resolved.get(oldest).size;
      resolved.delete(oldest);
    }
  }

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
    if (settings.signal && settings.signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    resolved.forEach(function (entry, key) {
      if (now >= entry.expiresAt) resolved.delete(key);
    });
    const cached = resolved.get(cacheKey);
    if (!settings.fresh && cached && Date.now() - cached.at < maxAge) return Promise.resolve(cached.data);
    if (!settings.fresh && pending.has(cacheKey)) return subscribe(pending.get(cacheKey), settings.signal);
    const controller = new AbortController();
    const cancel = function () { controller.abort(); };
    const timer = setTimeout(cancel, 25000);
    const entry = { controller: controller, subscribers: 0, settled: false, promise: null };
    const promise = fetch(path, {
      headers: { Accept: 'application/json' },
      cache: settings.fresh ? 'no-cache' : 'default',
      signal: controller.signal
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }).then(function (data) {
      if (pending.get(cacheKey) === entry) {
        retain(cacheKey, data, maxAge);
        pending.delete(cacheKey);
      }
      return data;
    }).catch(function (error) {
      if (pending.get(cacheKey) === entry) pending.delete(cacheKey);
      throw error;
    });
    entry.promise = promise.finally(function () {
      entry.settled = true;
      clearTimeout(timer);
    });
    pending.set(cacheKey, entry);
    return subscribe(entry, settings.signal);
  }

  // Each consumer owns its cancellation. The wire is shared until no consumers remain.
  function subscribe(entry, signal) {
    entry.subscribers += 1;
    return new Promise(function (resolve, reject) {
      let done = false;
      function finish(callback, value) {
        if (done) return;
        done = true;
        if (signal) signal.removeEventListener('abort', cancel);
        entry.subscribers -= 1;
        callback(value);
        if (!entry.subscribers && !entry.settled) entry.controller.abort();
      }
      function cancel() { finish(reject, new DOMException('Aborted', 'AbortError')); }
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      entry.promise.then(function (data) { finish(resolve, data); }, function (error) { finish(reject, error); });
    });
  }

  function invalidate(prefix) {
    Array.from(resolved.keys()).forEach(function (key) {
      if (!prefix || String(key).indexOf(prefix) === 0) resolved.delete(key);
    });
    // Existing callers may finish; detaching prevents their obsolete result entering the cache.
    Array.from(pending.keys()).forEach(function (key) {
      if (!prefix || String(key).indexOf(prefix) === 0) pending.delete(key);
    });
  }

  window.UmaApi = Object.freeze({ request: request, query: query, invalidate: invalidate });
})();
