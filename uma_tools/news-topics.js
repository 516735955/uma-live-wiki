'use strict';

const fs = require('fs');
const path = require('path');
const routes = require('./route-utils');
const { createTopicMatcher, fields } = require('./news-topic-matches');

const pageSize = 10;
const eventColors = { concert: '#ff8718', onsite: '#3157ed', official_program: '#5752a8' };
const mediaColors = { album: '#3157ed', song: '#d47624', anime: '#5752a8' };

function createNewsTopics({ DATA_DIR, catalogStore, animeStore, newsContent, sendJson, archiveRequest }) {
  let records;
  let automatic = {};
  let automaticChecked = 0;
  let automaticLoad;
  let indexedSnapshot;
  let indexedAnime;
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

  function refreshAutomatic() {
    if (automaticLoad) return automaticLoad;
    if (Date.now() - automaticChecked < 30000) return Promise.resolve();
    automaticChecked = Date.now();
    automaticLoad = archiveRequest('topic_records').then(rows => {
      if (JSON.stringify(rows) !== JSON.stringify(automatic)) {
        automatic = rows;
        indexedSnapshot = null;
      }
    }).catch(error => console.error('[news:topic-records]', error.message))
      .finally(() => { automaticLoad = null; });
    return automaticLoad;
  }

  async function update() {
    const queued = await archiveRequest('topic_queue');
    if (!queued.length) return;
    const [store, anime] = await Promise.all([catalogStore.get(), animeStore.load()]);
    const match = createTopicMatcher(store, anime);
    const manual = source();
    await archiveRequest('topic_complete', { rows: queued.map(row => {
      const date = String(row.detail.post_at || '').slice(0, 10).replace(/[./]/g, '-');
      const topics = date && !Object.hasOwn(manual, row.key) && !newsContent.isRemoved(row.key) ? match(row) : {};
      return { key: row.key, topics: Object.keys(topics).length ? { date, ...topics } : {} };
    }) });
    await automaticLoad;
    automaticChecked = 0;
    await refreshAutomatic();
  }

  function makeIndex(store, anime) {
    if (store === indexedSnapshot && anime === indexedAnime) return index;
    const articles = new Map();
    const related = new Map();
    const voices = new Map(store.voicesDoc.voice_actors.map(row => [row.id, row]));
    const works = new Map((anime?.works || []).map(row => [row.id, row]));
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
      if (type === 'album') {
        const row = store.albumsById.get(id);
        return row && { type, id, title: row.name, image: row.cover, color: mediaColors.album, href: routes.albums(id) };
      }
      if (type === 'song') {
        const row = store.songsById.get(id);
        return row && { type, id, title: row.title, image: row.cover, color: mediaColors.song, href: routes.songs(id) };
      }
      if (type === 'anime') {
        const row = works.get(id);
        return row && { type, id, title: row.title_zh || row.title_ja, image: row.cover, color: mediaColors.anime, href: routes.anime(id) };
      }
      const raw = store.eventsById.get(id) || sessions.get(id);
      if (!raw) return null;
      const row = store.parentForChild.get(raw.id)?.parent || raw;
      return { type, id: row.id, title: row.title_zh || row.title, image: row.image_preview || row.image, color: eventColors[row.kind], href: routes.events(row.id) };
    }

    for (const [key, row] of Object.entries({ ...automatic, ...source() })) {
      const id = key.replace(/^official-/, '');
      const metadata = { key, id, title: row.title, date: row.date, href: routes.news(id) };
      const topics = new Map();
      for (const type of fields) {
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
    indexedAnime = anime;
    index = { articles, related };
    return index;
  }

  async function handle(res, params) {
    const id = params.get('id') || '';
    const type = params.get('type') || '';
    const article = !type && /^(?:\d+|lantis-[\w-]+)$/.test(id);
    if (!article && (!fields.includes(type) || !/^[\w-]+$/.test(id))) {
      return sendJson(res, 400, { error: 'invalid news topic' });
    }
    const key = /^\d+$/.test(id) ? 'official-' + id : id;
    try {
      const manual = source();
      if (!article || !Object.hasOwn(manual, key)) await refreshAutomatic();
      if (article && ((!Object.hasOwn(manual, key) && !Object.hasOwn(automatic, key)) || newsContent.isRemoved(key))) return sendJson(res, 200, { topics: [] });
      const [store, anime] = await Promise.all([catalogStore.get(), animeStore.load().catch(() => null)]);
      const view = makeIndex(store, anime);
      if (article) return sendJson(res, 200, { topics: view.articles.get(key) || [] });
      const rows = (view.related.get(type + ':' + id) || []).filter(row => !newsContent.isRemoved(row.key));
      const count = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(count, Math.max(1, parseInt(params.get('page'), 10) || 1));
      return sendJson(res, 200, { items: rows.slice((page - 1) * pageSize, page * pageSize), page, page_count: count, total: rows.length });
    } catch (error) {
      console.error('[news:topics]', error.message);
      return sendJson(res, 503, { error: 'news topics unavailable' });
    }
  }

  return { handle, update };
}

module.exports = { createNewsTopics };
