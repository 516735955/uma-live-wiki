'use strict';

const fs = require('fs');
const path = require('path');
const routes = require('./route-utils');

const types = ['event', 'character', 'voice'];
const pageSize = 10;
const eventColors = { concert: '#ff8718', onsite: '#3157ed', official_program: '#5752a8' };

function createNewsTopics({ DATA_DIR, catalogStore, newsContent, sendJson }) {
  let records;
  let indexedSnapshot;
  let index;

  function source() {
    if (records) return records;
    try {
      records = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'news_topics.json'), 'utf8')).articles || {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      records = {};
    }
    return records;
  }

  function makeIndex(store) {
    if (store === indexedSnapshot) return index;
    const articles = new Map();
    const related = new Map();
    const voices = new Map(store.voicesDoc.voice_actors.map(row => [row.id, row]));
    const sessions = new Map(store.eventRows.flatMap(({ data }) =>
      (data.sessions || []).map(session => [session.id, data])));

    function topic(type, id) {
      if (type === 'character') {
        const row = store.charactersById.get(id);
        return row && { type, id, title: row.zh || row.ja, image: row.img || row.av, color: row.main, href: routes.characters(id) };
      }
      if (type === 'voice') {
        const row = voices.get(id);
        return row && { type, id, title: row.identity.zh || row.identity.ja, image: row.photo?.url, color: row.roles?.[0]?.color_main || '#3157ed', href: routes.voiceActors(id) };
      }
      const raw = store.eventsById.get(id) || sessions.get(id);
      if (!raw) return null;
      const row = store.parentForChild.get(raw.id)?.parent || raw;
      return { type, id: row.id, title: row.title_zh || row.title, image: row.image_preview || row.image, color: eventColors[row.kind], href: routes.events(row.id) };
    }

    for (const [key, row] of Object.entries(source())) {
      const id = key.replace(/^official-/, '');
      const metadata = { key, id, title: row.title, date: row.date, href: routes.news(id) };
      const topics = new Map();
      for (const type of types) {
        for (const id of row[type] || []) {
          const item = topic(type, id);
          if (item) topics.set(type + ':' + item.id, item);
        }
      }
      articles.set(key, [...topics.values()]);
      for (const name of topics.keys()) {
        if (!related.has(name)) related.set(name, []);
        related.get(name).push(metadata);
      }
    }
    for (const rows of related.values()) {
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key, 'en', { numeric: true }));
    }
    indexedSnapshot = store;
    index = { articles, related };
    return index;
  }

  return async function handleNewsTopics(res, params) {
    const id = params.get('id') || '';
    const type = params.get('type') || '';
    const article = !type && /^(?:\d+|lantis-[\w-]+)$/.test(id);
    if (!article && (!types.includes(type) || !/^[\w-]+$/.test(id))) {
      return sendJson(res, 400, { error: 'invalid news topic' });
    }
    const key = /^\d+$/.test(id) ? 'official-' + id : id;
    try {
      if (article && (!Object.hasOwn(source(), key) || newsContent.isRemoved(key))) return sendJson(res, 200, { topics: [] });
      const view = makeIndex(await catalogStore.get());
      if (article) return sendJson(res, 200, { topics: view.articles.get(key) || [] });
      const rows = (view.related.get(type + ':' + id) || []).filter(row => !newsContent.isRemoved(row.key));
      const count = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(count, Math.max(1, parseInt(params.get('page'), 10) || 1));
      return sendJson(res, 200, { items: rows.slice((page - 1) * pageSize, page * pageSize), page, page_count: count, total: rows.length });
    } catch (error) {
      console.error('[news:topics]', error.message);
      return sendJson(res, 503, { error: 'news topics unavailable' });
    }
  };
}

module.exports = { createNewsTopics };
