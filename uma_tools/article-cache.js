'use strict';

function createArticleCache({ send, applyEdits, translate }) {
  const articles = new Map(), requests = new Map(), translations = new Map();
  function updateTranslation(key, entry) {
    if (translations.has(key) || Date.now() - (entry.attemptedAt || 0) < 30000 || entry.data.detail?.translation_state === 'complete') return;
    const controller = new AbortController();
    translations.set(key, controller);
    entry.attemptedAt = Date.now();
    entry.data.detail.translation_state = 'pending';
    const timer = setTimeout(() => {
      controller.abort();
      if (articles.get(key) === entry) entry.data.detail.translation_state = 'partial';
      translations.delete(key);
    }, 45000);
    const detail = { ...applyEdits(entry.data).detail };
    // Retry incomplete body fragments from the original, keeping successful fragments in the translation cache.
    if (detail.translation_state !== 'complete') detail.message_zh = '';
    translate(detail, controller.signal, (status, data) => {
      if (translations.get(key) !== controller) return;
      clearTimeout(timer);
      translations.delete(key);
      if (status === 200 && articles.get(key) === entry) entry.data = { ...entry.data, detail: data.detail };
    });
  }
  function serve(key, response, load, withTranslation = false) {
    const cached = articles.get(key);
    if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
      if (withTranslation) updateTranslation(key, cached);
      send(response, 200, applyEdits(cached.data));
      return;
    }
    let pending = requests.get(key);
    const fresh = !pending;
    if (!pending) {
      pending = { controller: new AbortController(), responses: new Set() };
      requests.set(key, pending);
    }
    pending.responses.add(response);
    response.once('close', () => {
      pending.responses.delete(response);
      if (requests.get(key) === pending && !pending.responses.size) {
        requests.delete(key);
        pending.controller.abort();
      }
    });
    if (!fresh) return;
    load(pending.controller.signal, (status, data) => {
      if (requests.get(key) !== pending) return;
      requests.delete(key);
      if (status === 200) {
        const entry = { at: Date.now(), data };
        articles.set(key, entry);
        if (withTranslation) updateTranslation(key, entry);
        if (articles.size > 128) articles.delete(articles.keys().next().value);
      } else if (cached) { status = 200; data = cached.data; }
      const result = status === 200 ? applyEdits(data) : data;
      pending.responses.forEach(res => send(res, status, result));
      pending.responses.clear();
    });
  }
  return { serve };
}

module.exports = { createArticleCache };
