'use strict';

const fs = require('fs');
const path = require('path');

const CATALOG_FILES = [
  'catalog_manifest.json',
  'events_catalog.json',
  'song_catalog.json',
  'appearance_index.json',
  'voice_actor_profiles.json',
  'albums.json'
];

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, ' ').trim();
}

function pageNumber(value, fallback) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function albumSlug(name) {
  const value = String(name || '');
  const latin = value
    .replace(/[‘’`'"「」『』\[\]（）()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const matches = part.match(/[A-Za-z0-9]+/g);
      return matches ? matches.join('') : '';
    })
    .filter(Boolean)
    .join('_')
    .toUpperCase();
  if (latin) return latin;
  return value
    .replace(/[‘’`'"「」『』\[\]（）()]/g, ' ')
    .replace(/[\/\\&+=?#%<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
}

function albumWork(name) {
  const value = String(name || '');
  if (/ANIMATION DERBY Season 2/.test(value)) return 's2';
  if (/ANIMATION DERBY Season 3/.test(value)) return 's3';
  if (/ANIMATION DERBY/.test(value)) return 's1';
  if (/ROAD TO THE TOP/.test(value)) return 'rttp';
  if (/新時代の扉/.test(value)) return 'movie';
  if (/シンデレラグレイ|^超える$/.test(value)) return 'cinderella';
  if (/うまよん/.test(value)) return 'yon';
  if (/うまゆる/.test(value)) return 'yuru';
  if (/STARTING GATE/.test(value)) return 'starting-gate';
  if (/Solo Vocal Tracks/.test(value)) return 'solo-vocal';
  if (/WINNING LIVE/.test(value)) return 'winning-live';
  return '';
}

function firstPlayableRelease(song) {
  for (const version of (song.versions || [])) {
    for (const release of (version.releases || [])) {
      if (release.audio_url) {
        return {
          version_id: version.id,
          version_title: version.title,
          audio_url: release.audio_url,
          artist: release.artist || '',
          cover: release.cover || song.cover || '',
          album_id: release.album_id || '',
          album_name: release.album_name || '',
          voice_actor_ids: [...new Set((release.vocalists || []).map((vocalist) => vocalist.voice_actor_id).filter(Boolean))]
        };
      }
    }
  }
  return null;
}

function eventSongCount(event) {
  return (event.sessions || []).reduce((total, session) => {
    const rows = (session.performances && session.performances.length)
      ? session.performances
      : (session.songs || []);
    return total + rows.length;
  }, 0);
}

function eventSearchText(event) {
  const cast = (event.cast || []).map((person) => [
    person.name,
    person.voice_actor_name,
    person.character_name,
    person.role
  ].filter(Boolean).join(' '));
  const sessions = (event.sessions || []).flatMap((session) => {
    const songs = (session.performances || session.songs || []).map((row) => [row.song, row.title, row.source].filter(Boolean).join(' '));
    return [session.label, session.venue].concat(songs);
  });
  return normalize([
    event.title,
    event.date,
    event.venue,
    event.summary,
    ...(event.character_ids || []),
    ...cast,
    ...sessions
  ].filter(Boolean).join(' '));
}

function eventSummary(event, searchText) {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    end_date: event.end_date,
    kind: event.kind,
    mode: event.mode,
    series_id: event.series_id,
    venue: event.venue,
    cast_count: (event.cast || []).length,
    character_count: (event.character_ids || []).length,
    session_count: Math.max(1, (event.sessions || []).length),
    song_count: eventSongCount(event),
    image: event.image,
    summary: event.summary,
    legacy_url: event.legacy_url,
    legacy_aliases: event.legacy_aliases || [],
    setlist_status: event.setlist_status,
    search_text: searchText || eventSearchText(event)
  };
}

function songSearchText(song) {
  const releases = (song.versions || []).flatMap((version) => (version.releases || []).map((release) => [
    release.album_name,
    release.catalog,
    release.artist
  ].filter(Boolean).join(' ')));
  return normalize([
    song.title,
    ...(song.aliases || []),
    ...(song.artists || []),
    ...releases
  ].join(' '));
}

function songSummary(song, searchText) {
  return {
    id: song.id,
    title: song.title,
    aliases: song.aliases || [],
    artists: song.artists || [],
    character_ids: song.character_ids || [],
    voice_actor_ids: song.voice_actor_ids || [],
    cover: song.cover,
    release_date: song.release_date,
    version_count: song.version_count || 0,
    release_count: song.release_count || 0,
    performance_count: song.performance_count || 0,
    playable: firstPlayableRelease(song),
    search_text: searchText || songSearchText(song)
  };
}

function songForAppearance(song, type, id) {
  const versions = (song.versions || []).map((version) => {
    const releases = (version.releases || []).map((release) => {
      const vocalists = (release.vocalists || []).filter((vocalist) => type === 'character'
        ? vocalist.character_id === id
        : vocalist.voice_actor_id === id);
      if (!vocalists.length) return null;
      return Object.assign({}, release, { vocalists });
    }).filter(Boolean);
    if (!releases.length) return null;
    return {
      id: version.id,
      title: version.title,
      version_label: version.version_label,
      releases,
      release_count: releases.length,
      performance_count: 0,
      performances: []
    };
  }).filter(Boolean);
  return Object.assign(songSummary(song), { versions });
}

function albumSummary(album) {
  const tracks = (album.songs || []).map((song) => [song.name, song.artist].filter(Boolean).join(' '));
  return {
    name: album.name,
    slug: albumSlug(album.name),
    count: album.count,
    cover: album.cover,
    release: album.release,
    company: album.company,
    catalog: album.catalog,
    type: album.type,
    neteaseAlbumId: album.neteaseAlbumId,
    work: albumWork(album.name),
    search_text: normalize([album.name, album.catalog, ...tracks].join(' '))
  };
}

class CatalogStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.snapshot = null;
    this.signature = '';
    this.loading = null;
  }

  async fileSignature() {
    const stats = await Promise.all(CATALOG_FILES.map((name) => fs.promises.stat(path.join(this.dataDir, name))));
    return stats.map((stat) => stat.size + ':' + Math.floor(stat.mtimeMs)).join('|');
  }

  async get() {
    const signature = await this.fileSignature();
    if (this.snapshot && signature === this.signature) return this.snapshot;
    if (this.loading) return this.loading;
    this.loading = this.load(signature);
    try {
      return await this.loading;
    } catch (error) {
      // A refresh writes several generated files in sequence. Keep serving the
      // last internally consistent revision until the new revision is complete.
      if (this.snapshot) return this.snapshot;
      throw error;
    } finally {
      this.loading = null;
    }
  }

  async load(signature) {
    const texts = await Promise.all(CATALOG_FILES.map((name) => fs.promises.readFile(path.join(this.dataDir, name), 'utf8')));
    const manifest = JSON.parse(texts[0]);
    const eventsDoc = JSON.parse(texts[1]);
    const songsDoc = JSON.parse(texts[2]);
    const appearancesDoc = JSON.parse(texts[3]);
    const voicesDoc = JSON.parse(texts[4]);
    const albums = JSON.parse(texts[5]);
    const buildIds = new Set([
      eventsDoc.build_id,
      songsDoc.build_id,
      appearancesDoc.build_id,
      voicesDoc.build_id
    ]);
    if (buildIds.size !== 1 || !buildIds.has(manifest.build_id)) {
      throw new Error('catalog revision mismatch');
    }

    const events = Array.isArray(eventsDoc.events) ? eventsDoc.events : [];
    const songs = Array.isArray(songsDoc.songs) ? songsDoc.songs : [];
    const voiceActors = Array.isArray(voicesDoc.voice_actors) ? voicesDoc.voice_actors : [];
    const albumRows = Array.isArray(albums) ? albums : [];
    const eventRows = events.map((event) => {
      const search = eventSearchText(event);
      return { data: event, summary: eventSummary(event, search), search };
    });
    const songRows = songs.map((song) => {
      const search = songSearchText(song);
      return { data: song, summary: songSummary(song, search), search };
    });
    const albumRowsIndexed = albumRows.map((album) => ({ data: album, summary: albumSummary(album) }));
    const snapshot = {
      buildId: manifest.build_id,
      manifest,
      eventsDoc,
      songsDoc,
      appearancesDoc,
      voicesDoc,
      albums: albumRows,
      eventRows,
      songRows,
      albumRows: albumRowsIndexed,
      eventsById: new Map(events.map((event) => [String(event.id), event])),
      songsById: new Map(songs.map((song) => [String(song.id), song])),
      songAliases: new Map(),
      albumsBySlug: new Map(),
      albumsByName: new Map()
    };
    songRows.forEach((row) => {
      [row.data.id, row.data.title, ...(row.data.aliases || [])].forEach((key) => {
        const normalized = normalize(key).replace(/ /g, '');
        if (normalized) snapshot.songAliases.set(normalized, row.data);
      });
    });
    albumRowsIndexed.forEach((row) => {
      snapshot.albumsBySlug.set(row.summary.slug, row.data);
      snapshot.albumsByName.set(String(row.data.name), row.data);
    });
    this.snapshot = snapshot;
    this.signature = signature;
    return snapshot;
  }

  async home() {
    const store = await this.get();
    const events = store.eventsDoc.events || [];
    const liveEvents = events.filter((event) => event.kind === 'concert');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextEvent = events
      .filter((event) => {
        const time = new Date(String(event.date || '') + 'T00:00:00').getTime();
        return Number.isFinite(time) && time >= today.getTime();
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
    return {
      build_id: store.buildId,
      stats: {
        songs: store.songsDoc.coverage.songs,
        albums: store.songsDoc.coverage.albums,
        live: liveEvents.reduce((total, event) => total + Math.max(1, (event.sessions || []).length), 0),
        performances: liveEvents.length,
        characters: Object.keys(store.appearancesDoc.characters || {}).length,
        voiceActors: (store.voicesDoc.voice_actors || []).length,
        events: events.length
      },
      nextEvent: nextEvent ? eventSummary(nextEvent) : null
    };
  }

  async events(params) {
    const store = await this.get();
    const query = normalize(params.get('q'));
    const time = params.get('time') || 'all';
    const kind = params.get('kind') || 'all';
    const mode = params.get('mode') || 'all';
    const year = params.get('year') || 'all';
    const series = params.get('series') || 'all';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let rows = store.eventRows.filter((row) => {
      const event = row.data;
      const eventTime = new Date(String(event.date || '') + 'T00:00:00').getTime();
      if (query && !row.search.includes(query)) return false;
      if (kind !== 'all' && event.kind !== kind) return false;
      if (mode !== 'all' && event.mode !== mode) return false;
      if (year !== 'all' && String(event.date || '').slice(0, 4) !== year) return false;
      if (series !== 'all' && (event.series_id || 'unclassified') !== series) return false;
      if (time === 'upcoming' && (!Number.isFinite(eventTime) || eventTime < today.getTime())) return false;
      if (time === 'past' && Number.isFinite(eventTime) && eventTime >= today.getTime()) return false;
      return true;
    });
    rows = rows.slice().sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || '')) || String(a.data.title).localeCompare(String(b.data.title), 'ja'));
    const total = rows.length;
    const pageSize = Math.min(5000, pageNumber(params.get('page_size'), 20));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, pageNumber(params.get('page'), 1));
    return {
      build_id: store.buildId,
      series: store.eventsDoc.series || [],
      years: Array.from(new Set(store.eventRows.map((row) => String(row.data.date || '').slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))).sort().reverse(),
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((row) => row.summary),
      total,
      page,
      page_size: pageSize
    };
  }

  async event(id, legacy) {
    const store = await this.get();
    if (id && store.eventsById.has(String(id))) return { build_id: store.buildId, event: store.eventsById.get(String(id)) };
    if (legacy) {
      const event = (store.eventsDoc.events || []).find((item) => item.legacy_url === legacy || (item.legacy_aliases || []).includes(legacy));
      if (event) return { build_id: store.buildId, event };
    }
    return null;
  }

  async songs(params) {
    const store = await this.get();
    const query = normalize(params.get('q'));
    let rows = query ? store.songRows.filter((row) => row.search.includes(query)) : store.songRows.slice();
    rows.sort((a, b) => String(a.data.title).localeCompare(String(b.data.title), 'ja'));
    const total = rows.length;
    const pageSize = Math.min(5000, pageNumber(params.get('page_size'), 30));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, pageNumber(params.get('page'), 1));
    return {
      build_id: store.buildId,
      coverage: store.songsDoc.coverage || {},
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((row) => row.summary),
      total,
      page,
      page_size: pageSize
    };
  }

  async song(id) {
    const store = await this.get();
    const target = normalize(id).replace(/ /g, '');
    const song = store.songsById.get(String(id)) || store.songAliases.get(target);
    return song ? { build_id: store.buildId, song } : null;
  }

  async albums(params) {
    const store = await this.get();
    const query = normalize(params.get('q'));
    const work = params.get('work') || '';
    const type = params.get('type') || '';
    const year = params.get('year') || '';
    const sort = params.get('sort') || 'newest';
    let rows = store.albumRows.filter((row) => {
      const album = row.summary;
      if (query && !album.search_text.includes(query)) return false;
      if (work && album.work !== work) return false;
      if (type && album.type !== type) return false;
      if (year && String(album.release || '').slice(0, 4) !== year) return false;
      return true;
    });
    rows = rows.slice().sort((a, b) => sort === 'name'
      ? String(a.data.name).localeCompare(String(b.data.name), 'ja')
      : String(b.data.release || '').localeCompare(String(a.data.release || '')) || String(a.data.name).localeCompare(String(b.data.name), 'ja'));
    const total = rows.length;
    const pageSize = Math.min(5000, pageNumber(params.get('page_size'), 30));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, pageNumber(params.get('page'), 1));
    const types = Array.from(new Set(store.albums.map((album) => album.type).filter(Boolean)));
    const years = Array.from(new Set(store.albums.map((album) => String(album.release || '').slice(0, 4)).filter((value) => /^\d{4}$/.test(value)))).sort().reverse();
    return {
      build_id: store.buildId,
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((row) => row.summary),
      types,
      years,
      total,
      page,
      page_size: pageSize
    };
  }

  async album(slug, name) {
    const store = await this.get();
    const album = (slug && store.albumsBySlug.get(String(slug))) || (name && store.albumsByName.get(String(name)));
    if (!album) return null;
    const songs = (album.songs || []).map((track) => {
      const key = normalize(track.name).replace(/ /g, '');
      return store.songAliases.get(key);
    }).filter(Boolean);
    return { build_id: store.buildId, album, catalog_songs: songs };
  }

  async voices() {
    const store = await this.get();
    return { build_id: store.buildId, voice_actors: store.voicesDoc.voice_actors || [] };
  }

  async appearance(type, id) {
    const store = await this.get();
    const table = type === 'voice_actor' ? store.appearancesDoc.voice_actors : store.appearancesDoc.characters;
    const appearance = (table && table[id]) || { events: [], songs: [], performed_songs: [] };
    const songIds = new Set((appearance.songs || []).map((item) => item.song_id).filter(Boolean));
    const songs = Array.from(songIds)
      .map((songId) => store.songsById.get(String(songId)))
      .filter(Boolean)
      .map((song) => songForAppearance(song, type, id));
    return { build_id: store.buildId, appearance, songs };
  }
}

module.exports = { CatalogStore, albumSlug };
