'use strict';

const fs = require('fs');
const path = require('path');
const routes = require('./route-utils');
const catalogModel = require('./catalog-model');
const crypto = require('crypto');
const businessDate = require('./business-date');
const searchText = require('./search-text');
const { createClassification } = require('./music-classification');
const { projectEvents } = require('./event-presentation');

const CATALOG_RESPONSE_SCHEMA = 11;

const CATALOG_FILES = [
  'catalog_manifest.json',
  'events_catalog.json',
  'song_catalog.json',
  'creator_catalog.json',
  'appearance_index.json',
  'voice_actor_profiles.json',
  'albums.json'
];
const MUSIC_SOURCE_FILES = [
  'music/creators.json',
  'music/lyrics.json',
  'music/lyric_timings.json'
];
const CHARACTER_INDEX_FILE = 'character_index_data.js';
const EVENT_IMAGE_MAP = 'auto_update/event_images.json';
const EVENT_KIND_COVERS = {
  concert: '/uma_tools/img/event-covers/concert.svg',
  official_program: '/uma_tools/img/event-covers/official-program.svg',
  onsite: '/uma_tools/img/event-covers/onsite.svg'
};

function normalize(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, ' ').trim();
}

function musicSearchText(value) {
  return normalize(value).replace(/[‘’]/g, "'").replace(/[‐‑‒–—−－]/g, '-').replace(/・/g, '·');
}

function songIdentityKey(value) {
  return normalize(value)
    .replace(/[\ufe0e\ufe0f]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—−－]/g, '-')
    .replace(/・/g, '·')
    .replace(/ /g, '');
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

function stableAlbumId(album) {
  if (album && String(album.id || '').trim()) return String(album.id).trim();
  const catalog = String((album && album.catalog) || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (catalog) return 'album-' + catalog;
  return 'album-' + crypto.createHash('sha1').update(normalize(album && album.name).replace(/ /g, '')).digest('hex').slice(0, 12);
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
  return 'other';
}

function albumType(value) {
  const type = String(value || '').trim();
  if (['数字单曲', 'デジタルシングル', 'Digital Single'].includes(type)) return '单曲';
  return ['专辑', '单曲', '原声带', '精选辑'].includes(type) ? type : '其他';
}

function releaseYear(value) {
  const year = String(value || '').slice(0, 4);
  return /^\d{4}$/.test(year) ? year : 'unknown';
}

function firstPlayableRelease(song) {
  const row = catalogModel.playableRecording(song);
  if (row) {
    const {version, release} = row;
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
  return null;
}

function eventSongCount(event) {
  return catalogModel.eventSongCount(event);
}

function eventSearchText(event, actors = new Map()) {
  const cast = (event.cast || []).map((person) => [
    ...Object.values(actors.get(person.voice_actor_id)?.identity || {}).flat(),
    person.name,
    person.voice_actor_name,
    person.character_name,
    person.role
  ].filter(Boolean).join(' '));
  const sessions = (event.sessions || []).flatMap((session) => {
    const songs = (session.performances?.length ? session.performances : session.songs || []).map((row) => typeof row === 'string' ? row : [row.song, row.title, row.source].filter(Boolean).join(' '));
    return [session.label, session.venue].concat(songs);
  });
  return normalize([
    event.title,
    event.title_zh,
    event.title_ja,
    event.date,
    event.venue,
    event.summary,
    event.summary_zh,
    event.summary_ja,
    ...(event.character_ids || []),
    ...cast,
    ...sessions
  ].filter(Boolean).join(' '));
}

function nextUpcomingEvent(events, today) {
  return events.filter(event => event.schedule_status !== 'cancelled').flatMap(event => {
    const sessions = event.sessions?.length ? event.sessions : [event];
    return sessions.filter(session => session.schedule_status !== 'cancelled'
      && businessDate.eventDate(session.end_date || session.date || event.end_date || event.date) >= today)
      .map(session => ({ ...event, date: session.date || event.date,
        end_date: session.end_date || session.date || event.end_date || event.date,
        venue: session.venue || event.venue, session_id: session === event ? '' : session.id }));
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
}

function eventSummary(event, searchText, image) {
  return {
    id: event.id,
    ...(event.session_id ? { session_id: event.session_id } : {}),
    title: event.title,
    title_zh: event.title_zh || '',
    title_ja: event.title_ja || '',
    date: event.date,
    end_date: event.end_date,
    schedule_status: event.schedule_status,
    status_source_url: event.status_source_url,
    status_note: event.status_note,
    kind: event.kind,
    mode: event.mode,
    series_id: event.series_id,
    venue: event.venue,
    cast_count: (event.cast || []).length,
    character_count: (event.character_ids || []).length,
    session_count: Math.max(1, (event.sessions || []).length),
    song_count: eventSongCount(event),
    image: image || event.image,
    summary: event.summary,
    summary_zh: event.summary_zh || '',
    summary_ja: event.summary_ja || '',
    localization_state: event.localization_state || '',
    legacy_url: event.legacy_url,
    legacy_aliases: event.legacy_aliases || [],
    setlist_status: event.setlist_status,
    search_text: searchText || eventSearchText(event)
  };
}

function musicCreatorName(music, creatorId) {
  const creator = music && music.creatorsById && music.creatorsById.get(String(creatorId || ''));
  return creator ? creator.name : '';
}

function lyricDocument(music, reference) {
  const row = (music && music.lyrics && music.lyrics[String(reference || '')]) || null;
  if (!row) return null;
  if (Array.isArray(row.lines)) return row;
  const document = music.lyricDocuments && music.lyricDocuments[String(row.document_id || '')];
  if (!document) return null;
  const byId = new Map((document.lines || []).map((line) => [String(line.id || ''), String(line.text || '')]));
  const sourceLineIds = (row.line_ids && row.line_ids.length) ? row.line_ids : (row.uses_all_lines ? (document.lines || []).map((line) => line.id) : []);
  const lineIds = sourceLineIds.map(String).filter((lineId) => byId.has(lineId));
  return Object.assign({}, row, {
    language: row.language || document.language || '',
    document_id: row.document_id || '',
    line_ids: lineIds,
    lines: lineIds.map((lineId) => byId.get(lineId))
  });
}

function timingDocument(music, reference) {
  const row = (music && music.timings && music.timings[String(reference || '')]) || null;
  if (!row) return null;
  const document = music.lyricDocuments && music.lyricDocuments[String(row.lyric_document_id || '')];
  const byId = new Map(((document && document.lines) || []).map((line) => [String(line.id || ''), String(line.text || '')]));
  return Object.assign({}, row, {
    lines: (row.lines || []).map((line) => Object.assign({}, line, {
      text: byId.get(String(line.line_id || '')) || line.source_text || line.text || ''
    }))
  });
}

function hydrateSong(song, music) {
  return Object.assign({}, song, {
    detail_complete: true,
    versions: (song.versions || []).map((version) => {
      const lyric = version.has_lyrics ? lyricDocument(music, version.lyrics_ref) : null;
      const timing = lyric ? timingDocument(music, version.lyrics_ref) : null;
      return Object.assign({}, version, {
        credits: (version.credits || []).map((credit) => Object.assign({}, credit, {
          name: musicCreatorName(music, credit.creator_id) || credit.name || credit.creator_id || ''
        })),
        lyrics: lyric ? Object.assign({}, lyric, {
          timings: timing && Array.isArray(timing.lines) ? timing.lines : []
        }) : null
      });
    })
  });
}

function songSearchText(song, music) {
  const releases = (song.versions || []).flatMap((version) => (version.releases || []).map((release) => [
    release.album_name,
    release.catalog,
    release.artist
  ].filter(Boolean).join(' ')));
  const creators = (song.versions || []).flatMap((version) => (version.credits || []).map((credit) => musicCreatorName(music, credit.creator_id) || credit.name));
  const lyrics = (song.versions || []).flatMap((version) => {
    const lyric = lyricDocument(music, version.lyrics_ref) || {};
    return [...(lyric.lines || []), ...(lyric.translation_lines || [])];
  });
  return musicSearchText([
    song.title,
    ...(song.aliases || []),
    ...(song.artists || []),
    ...releases,
    ...creators,
    ...lyrics
  ].join(' '));
}

function songSummarySearchText(song, music) {
  const releases = (song.versions || []).flatMap((version) => (version.releases || []).map((release) => [
    release.album_name,
    release.catalog,
    release.artist
  ].filter(Boolean).join(' ')));
  const creators = (song.versions || []).flatMap((version) => (version.credits || []).map((credit) => musicCreatorName(music, credit.creator_id) || credit.name));
  return musicSearchText([
    song.title,
    ...(song.aliases || []),
    ...(song.artists || []),
    ...releases,
    ...creators
  ].join(' '));
}

function songSummary(song, searchText, music) {
  return {
    id: song.id,
    ambiguous_aliases: song.ambiguous_aliases || [],
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
    creator_ids: song.creator_ids || [],
    has_lyrics: !!song.has_lyrics,
    playable: firstPlayableRelease(song),
    // Full lyrics remain in the server-only row index.  List responses carry a
    // compact search string; lyric searches use the q-filtered API response.
    search_text: songSummarySearchText(song, music)
  };
}

function creatorSearchText(creator) {
  return musicSearchText([
    creator.name,
    ...(creator.aliases || []),
    ...(creator.affiliations || []),
    ...(creator.roles || []).map((role) => role.label),
    ...(creator.works || []).map((work) => work.title)
  ].join(' '));
}

function creatorSummary(creator, searchText) {
  return {
    id: creator.id,
    name: creator.name,
    aliases: creator.aliases || [],
    type: creator.type || 'person',
    image: creator.image || '',
    affiliations: creator.affiliations || [],
    roles: creator.roles || [],
    work_count: creator.work_count || 0,
    version_count: creator.version_count || 0,
    search_text: searchText || creatorSearchText(creator)
  };
}

function songForAppearance(song, type, id) {
  const versions = (song.versions || []).map((version) => {
    const releases = (version.releases || []).map((release) => {
      const participates = (release.vocalists || []).some((vocalist) => type === 'character'
        ? vocalist.character_id === id
        : vocalist.voice_actor_id === id);
      if (!participates) return null;
      return Object.assign({}, release, { vocalists: (release.vocalists || []).slice() });
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
    id: stableAlbumId(album),
    name: album.name,
    count: album.count,
    cover: album.cover,
    release: album.release,
    company: album.company,
    catalog: album.catalog,
    type: album.type,
    neteaseAlbumId: album.neteaseAlbumId,
    work: albumWork(album.name),
    search_text: musicSearchText([album.name, album.catalog, ...tracks].join(' '))
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
    if (this.signatureCheckedAt && Date.now() - this.signatureCheckedAt < 100) return this.checkedSignature;
    const stats = await Promise.all(CATALOG_FILES.concat(MUSIC_SOURCE_FILES, CHARACTER_INDEX_FILE).map((name) => fs.promises.stat(path.join(this.dataDir, name))));
    const pending = await fs.promises.stat(path.join(this.dataDir, 'auto_update/catalog_pending.json')).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    const eventImages = await fs.promises.stat(path.join(this.dataDir, EVENT_IMAGE_MAP)).catch(() => null);
    const anime = await fs.promises.stat(path.join(this.dataDir, 'anime_catalog.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    this.checkedSignature = stats.map((stat) => stat.size + ':' + stat.mtimeMs).join('|') + ':' + (pending ? pending.mtimeMs + ':' + pending.size : 'published') + ':' + (eventImages ? eventImages.mtimeMs + ':' + eventImages.size : 'no-event-images');
    this.checkedSignature += ':' + (anime ? anime.mtimeMs + ':' + anime.size : 'no-anime');
    this.signatureCheckedAt = Date.now();
    return this.checkedSignature;
  }

  async readTexts(names) {
    const pendingFile = path.join(this.dataDir, 'auto_update/catalog_pending.json');
    for (let attempt = 0; attempt < 3; attempt++) {
      const readPending = () => fs.promises.readFile(pendingFile, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
      const before = await readPending();
      const saved = before ? JSON.parse(before) : {};
      const texts = await Promise.all(names.map(name => Object.hasOwn(saved, name)
        ? JSON.stringify(saved[name]) : fs.promises.readFile(path.join(this.dataDir, name), 'utf8')));
      if (before === await readPending()) return texts;
    }
    throw new Error('Catalog publication changed during reading');
  }

  async get() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const signature = await this.fileSignature();
        if (this.snapshot && signature === this.signature) return this.snapshot;
        return await this.load(signature);
      } catch (error) {
        // All readers keep the last complete revision during a refresh.
        if (this.lastError !== error.message) console.error('[catalog:reload]', error.message);
        this.lastError = error.message;
        if (this.snapshot) return this.snapshot;
        throw error;
      }
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async load(signature) {
    const texts = await this.readTexts(CATALOG_FILES.concat(MUSIC_SOURCE_FILES, CHARACTER_INDEX_FILE));
    const manifest = JSON.parse(texts[0]);
    const eventsDoc = JSON.parse(texts[1]);
    const songsDoc = JSON.parse(texts[2]);
    const creatorsDoc = JSON.parse(texts[3]);
    const appearancesDoc = JSON.parse(texts[4]);
    const voicesDoc = JSON.parse(texts[5]);
    const albums = JSON.parse(texts[6]);
    const musicCreatorsDoc = JSON.parse(texts[7]);
    const lyricsDoc = JSON.parse(texts[8]);
    const timingsDoc = JSON.parse(texts[9]);
    const animeText = await fs.promises.readFile(path.join(this.dataDir, 'anime_catalog.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error; });
    const classifyAlbum = createClassification(JSON.parse(animeText), songsDoc.songs || [], albumWork);
    const music = {
      creatorsById: new Map((musicCreatorsDoc.creators || []).map((creator) => [String(creator.id), creator])),
      lyrics: lyricsDoc.versions || {},
      lyricDocuments: lyricsDoc.documents || {},
      timings: timingsDoc.versions || {}
    };
    const buildIds = new Set([
      eventsDoc.build_id,
      songsDoc.build_id,
      creatorsDoc.build_id,
      appearancesDoc.build_id,
      voicesDoc.build_id
    ]);
    if (buildIds.size !== 1 || !buildIds.has(manifest.build_id)) {
      throw new Error('catalog revision mismatch');
    }
    let sourceRevision = crypto.createHash('sha1')
      .update(texts.join('\u0000') + animeText)
      .digest('hex')
      .slice(0, 12);

    const seriesById = new Map((eventsDoc.series || []).map((series) => [series.id, series]));
    let eventImages = {};
    try {
      const document = JSON.parse(await fs.promises.readFile(path.join(this.dataDir, EVENT_IMAGE_MAP), 'utf8'));
      const siteRoot = path.resolve(this.dataDir, '..');
      const localAsset = (value) => {
        if (typeof value !== 'string' || !value.startsWith('/')) return '';
        const target = path.resolve(siteRoot, `.${value}`);
        if (target !== siteRoot && !target.startsWith(siteRoot + path.sep)) return '';
        return fs.existsSync(target) ? value : '';
      };
      const imageSources = new Map([...(eventsDoc.events || []), ...(eventsDoc.event_groups || [])].map(row => [String(row.id), row]));
      eventImages = Object.fromEntries(Object.entries(document.items || {}).flatMap(([id, item]) => {
        const source = imageSources.get(id);
        if (source && item?.source_image && item.source_image !== source.image) return [];
        const mapped = item && typeof item === 'object' ? {
          ...item,
          image_url: localAsset(item.image_url),
          hero_image_url: localAsset(item.hero_image_url),
          original_url: localAsset(item.original_url)
        } : null;
        return mapped && mapped.image_url && mapped.hero_image_url && mapped.original_url ? [[id, mapped]] : [];
      }));
    } catch (error) { if (error.code !== 'ENOENT') console.warn('[catalog:event-images]', error.message); }
    sourceRevision = crypto.createHash('sha1')
      .update(sourceRevision + '\u0000' + JSON.stringify(eventImages))
      .digest('hex')
      .slice(0, 12);
    const fallbackImage = (event) => {
      const mapped = eventImages[String(event.id || '')];
      if (mapped && mapped.image_url) return mapped.image_url;
      if (String(event.image || '').startsWith('/')) return event.image;
      const series = seriesById.get(event.series_id) || {};
      if (String(series.cover || '').startsWith('/')) return series.cover;
      return EVENT_KIND_COVERS[event.kind] || '/uma_tools/img/event-covers/onsite.svg';
    };
    const sourceEvents = (Array.isArray(eventsDoc.events) ? eventsDoc.events : []).map((event) => {
      const mapped = eventImages[String(event.id || '')] || {};
      return { ...event, image: fallbackImage(event), image_preview: mapped.image_url || fallbackImage(event), image_original: mapped.original_url || mapped.source_image || event.source_image || (String(event.image || '').startsWith('http') ? event.image : ''), source_image: mapped.source_image || event.source_image || (String(event.image || '').startsWith('http') ? event.image : '') };
    });
    const groups = (eventsDoc.event_groups || []).map(group => {
      const mapped = eventImages[String(group.id)] || {};
      return { ...group, image: mapped.image_url || group.image,
        image_preview: mapped.image_url || group.image,
        image_original: mapped.original_url || group.image_original || group.image };
    });
    const presentation = projectEvents(sourceEvents, groups);
    const events = presentation.events;
    const songs = Array.isArray(songsDoc.songs) ? songsDoc.songs : [];
    const creators = Array.isArray(creatorsDoc.creators) ? creatorsDoc.creators : [];
    const voiceActors = Array.isArray(voicesDoc.voice_actors) ? voicesDoc.voice_actors : [];
    const albumRows = Array.isArray(albums) ? albums.map(album => ({...album, type: albumType(album.type)})) : [];
    const characters = JSON.parse(texts[10].replace(/^window\.CHAR_INDEX\s*=\s*/, '').replace(/;\s*$/, ''));
    const charactersById = new Map(characters.map((character) => [character.id, character]));
    const actorsById = new Map(voiceActors.map(actor => [actor.id, actor]));
    const eventRows = events.map((event) => {
      const series = seriesById.get(event.series_id) || {};
      const names = (event.character_ids || []).map((id) => {
        const character = charactersById.get(id) || {};
        return [character.zh, character.ja, character.en].filter(Boolean).join(' ');
      });
      const search = searchText.fields([event.title, event.title_ja, event.title_aliases, event.venue, event.venue_raw, event.venue_aliases, event.venue_city, event.summary, ['cancelled','partially_cancelled'].includes(event.schedule_status) ? '已取消' : '', event.status_note, eventSearchText(event, actorsById), series.name, series.name_ja, ...names, ...(event.character_ids || []).map(id => charactersById.get(id)), ...(event.cast || []).map(row => actorsById.get(row.voice_actor_id)?.identity), ...(event.sessions || []).flatMap(row => [row.label, row.summary, row.venue, presentation.rawById.get(row.source_event_id)?.title])]);
      return { data: event, summary: eventSummary(event, search), search };
    });
    const songRows = songs.map((song) => {
      const search = searchText.fields([songSearchText(song, music), song.title, song.aliases, song.artists, ...(song.character_ids || []).map(id => charactersById.get(id)), ...(song.voice_actor_ids || []).map(id => actorsById.get(id)?.identity)]);
      const summary = songSummary(song, search, music);
      summary.artist_names = (song.voice_actor_ids || []).map((id) => {
        const actor = actorsById.get(id);
        return actor && actor.identity && (actor.identity.zh || actor.identity.ja);
      }).filter(Boolean);
      return { data: song, summary, search };
    });
    const creatorRows = creators.map((creator) => {
      const search = searchText.fields([creatorSearchText(creator), creator.name, creator.aliases]);
      return { data: creator, summary: creatorSummary(creator, search), search };
    });
    const albumRowsIndexed = albumRows.map((album) => ({ data: album, summary: { ...albumSummary(album), ...classifyAlbum(album, stableAlbumId(album)) } }));
    const snapshot = {
      buildId: manifest.build_id + '-api' + CATALOG_RESPONSE_SCHEMA + '-' + sourceRevision,
      manifest,
      eventsDoc,
      eventImages,
      songsDoc,
      creatorsDoc,
      appearancesDoc,
      voicesDoc,
      albums: albumRows,
      charactersById,
      eventRows,
      songRows,
      creatorRows,
      music,
      albumRows: albumRowsIndexed,
      eventsById: new Map([...presentation.byId, ...sourceEvents.flatMap(event => [...(event.id_aliases || []), ...Object.keys(event.event_session_aliases || {})].map(id => [String(id), event]))]),
      parentForChild: presentation.parentForChild,
      songsById: new Map(songs.map((song) => [String(song.id), song])),
      creatorsById: new Map(creators.map((creator) => [String(creator.id), creator])),
      songAliases: new Map(),
      albumsById: new Map(),
      albumsByName: new Map(),
      albumTracks: new Map()
    };
    songRows.forEach((row) => {
      for (const version of row.data.versions || []) {
        for (const release of version.releases || []) {
          const key = release.album_id + ':' + Number(release.track_number);
          if (!snapshot.albumTracks.has(key)) snapshot.albumTracks.set(key, row.data);
        }
      }
      [row.data.id, ...(row.data.legacy_ids || []), row.data.title, ...(row.data.aliases || [])].forEach((key) => {
        const normalized = songIdentityKey(key);
        if (!normalized) return;
        const previous = snapshot.songAliases.get(normalized);
        if (!snapshot.songAliases.has(normalized) || (previous && previous.id === row.data.id)) snapshot.songAliases.set(normalized, row.data);
        else snapshot.songAliases.set(normalized, null);
      });
    });
    albumRowsIndexed.forEach((row) => {
      snapshot.albumsById.set(row.summary.id, row.data);
      snapshot.albumsByName.set(String(row.data.name), row.data);
    });
    songRows.forEach(row => {
      const ambiguous = [row.data.title, ...(row.data.aliases || [])].map(songIdentityKey).filter(key => snapshot.songAliases.has(key) && !snapshot.songAliases.get(key));
      row.data.ambiguous_aliases = ambiguous;
      row.summary.ambiguous_aliases = ambiguous;
    });
    this.snapshot = snapshot;
    this.lastError = null;
    this.signature = signature;
    return snapshot;
  }

  async home() {
    if (this.homeLoading) return this.homeLoading;
    this.homeLoading = this.loadHome();
    try { return await this.homeLoading; }
    finally { this.homeLoading = null; }
  }

  async loadHome() {
    const files = ['catalog_manifest.json', 'events_catalog.json'];
    let stats;
    try {
      stats = await Promise.all(files.map(name => fs.promises.stat(path.join(this.dataDir, name))));
    } catch (error) {
      if (this.homeSnapshot) return this.homeSnapshot.value;
      throw error;
    }
    const signature = stats.map(stat => stat.size + ':' + stat.mtimeMs).join('|') + businessDate.today();
    if (this.homeSnapshot?.signature === signature) return this.homeSnapshot.value;
    let manifest, catalog;
    try {
      [manifest, catalog] = await Promise.all(files.map(async name => JSON.parse(await fs.promises.readFile(path.join(this.dataDir, name), 'utf8'))));
    } catch (error) {
      if (this.homeSnapshot) return this.homeSnapshot.value;
      throw error;
    }
    if (manifest.home_stats && manifest.build_id === catalog.build_id) {
      const today = businessDate.today();
      const events = projectEvents(catalog.events || [], catalog.event_groups || []).events;
      const next = nextUpcomingEvent(events, today);
      const payload = { stats: { ...manifest.home_stats, events: events.length }, nextEvent: next ? eventSummary(next) : null };
      const revision = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
      const value = { build_id: manifest.build_id + '-home1-' + revision, ...payload };
      this.homeSnapshot = { signature, value };
      return value;
    }
    const store = await this.get();
    const events = store.eventsDoc.events || [];
    const liveEvents = events.filter((event) => event.kind === 'concert' && event.schedule_status !== 'cancelled');
    const today = businessDate.today();
    const nextEvent = nextUpcomingEvent(store.eventRows.map(row => row.data), today);
    return {
      build_id: store.buildId,
      business_date: today,
      stats: {
        songs: store.songsDoc.coverage.songs,
        albums: store.songsDoc.coverage.albums,
        live: liveEvents.reduce((total, event) => total + Math.max(1, (event.sessions || []).length), 0),
        performances: liveEvents.length,
        characters: Object.keys(store.appearancesDoc.characters || {}).length,
        voiceActors: (store.voicesDoc.voice_actors || []).length,
        events: store.eventRows.length
      },
      nextEvent: nextEvent ? eventSummary(nextEvent) : null
    };
  }

  async events(params) {
    const store = await this.get();
    params = new URL('http://catalog.invalid' + routes.resolve('/zh-Hans/events?' + params, {
      eventSeries: (store.eventsDoc.series || []).map(row => row.id),
    })).searchParams;
    const query = normalize(params.get('q'));
    const time = params.get('time') || 'all';
    let kind = params.get('kind') || 'all';
    const mode = params.get('mode') || 'all';
    const year = params.get('year') || 'all';
    const series = params.get('series') || 'all';
    const selectedSeries = (store.eventsDoc.series || []).find(row => row.id === series);
    if (selectedSeries) kind = selectedSeries.kind;
    const today = businessDate.today();
    let rows = store.eventRows.filter((row) => {
      const event = row.data;
      const eventTime = businessDate.eventDate(event.end_date || event.date);
      if (query && !searchText.matchesIndex(row.search, query)) return false;
      if (kind !== 'all' && event.kind !== kind) return false;
      if (mode !== 'all' && event.mode !== mode) return false;
      if (year !== 'all' && ![event.date, ...(event.sessions || []).map(session => session.date)].some(date => releaseYear(date) === year)) return false;
      if (series !== 'all' && (event.series_id || 'unclassified') !== series) return false;
      if (time === 'upcoming' && (event.schedule_status === 'cancelled' || !eventTime || eventTime < today)) return false;
      if (time === 'cancelled' && !['cancelled', 'partially_cancelled'].includes(event.schedule_status)) return false;
      if (time === 'past' && (!eventTime || eventTime >= today)) return false;
      if (time === 'announced' && eventTime) return false;
      return true;
    });
    rows = rows.slice().sort((a, b) => (query ? searchText.rank([a.data.title,a.data.title_ja,a.data.title_aliases],query) - searchText.rank([b.data.title,b.data.title_ja,b.data.title_aliases],query) : 0) || String(b.data.sort_date || b.data.date || '').localeCompare(String(a.data.sort_date || a.data.date || '')) || String(a.data.title).localeCompare(String(b.data.title), 'ja'));
    const total = rows.length;
    const pageSize = Math.min(5000, pageNumber(params.get('page_size'), 20));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, pageNumber(params.get('page'), 1));
    return {
      build_id: store.buildId,
      business_date: today,
      series: (store.eventsDoc.series || [])
        .filter(series => store.eventRows.some(row => row.data.series_id === series.id))
        .map(series => ({...series, kinds: [series.kind]})),
      years: Array.from(new Set(store.eventRows.flatMap(row => [row.data.date, ...(row.data.sessions || []).map(session => session.date)]).filter(Boolean).map(releaseYear))).sort().reverse(),
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((row) => row.summary),
      total,
      page,
      page_size: pageSize
    };
  }

  async event(id, legacy, snapshot) {
    const store = snapshot || await this.get();
    let event = (id && store.eventsById.get(String(id))) || (legacy && (store.eventsDoc.events || [])
      .find((item) => item.legacy_url === legacy || (item.legacy_aliases || []).includes(legacy)));
    if (!event) return null;
    const aliasedSession = event.event_session_aliases?.[String(id)];
    const requested = store.parentForChild.get(event.id);
    if (requested) event = { ...requested.parent, requested_session_id: requested.session_id };
    if (aliasedSession) event = { ...event, requested_session_id: aliasedSession };
    const versionsBySong = new Map();
    (event.sessions || []).forEach((session) => (session.performances || []).forEach((performance) => {
      if (!versionsBySong.has(performance.song_id)) versionsBySong.set(performance.song_id, new Set());
      versionsBySong.get(performance.song_id).add(performance.version_id);
    }));
    const songs = Array.from(versionsBySong, ([songId, versionIds]) => {
      const song = store.songsById.get(songId);
      if (!song) return null;
      return Object.assign(songSummary(song, '', store.music), {
        versions: (song.versions || []).filter((version) => versionIds.has(version.id)).map((version) => ({
          id: version.id, title: version.title, version_label: version.version_label, instrumental: !!version.instrumental,
          releases: (version.releases || []).filter((release) => release.audio_url).slice(0, 1)
        }))
      });
    }).filter(Boolean);
    const imageMap = store.eventImages || {};
    const mapped = imageMap[String(event.id)] || {};
    const detailEvent = mapped.hero_image_url ? { ...event, image: mapped.hero_image_url, image_preview: mapped.image_url, source_image: mapped.source_image || event.source_image || '' } : event;
    return { build_id: store.buildId, event: detailEvent, series: (store.eventsDoc.series || []).find(series => series.id === event.series_id) || null, catalog_songs: songs };
  }

  async songs(params) {
    const store = await this.get();
    const query = musicSearchText(params.get('q'));
    let rows = query ? store.songRows.filter((row) => searchText.matchesIndex(row.search, query)) : store.songRows.slice();
    rows.sort((a, b) => (query ? searchText.rank([a.data.title,a.data.aliases],query) - searchText.rank([b.data.title,b.data.aliases],query) : 0) || String(a.data.title).localeCompare(String(b.data.title), 'ja'));
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

  async song(id, snapshot) {
    const store = snapshot || await this.get();
    const target = songIdentityKey(id);
    const song = store.songsById.get(String(id)) || store.songAliases.get(target);
    return song ? { build_id: store.buildId, song: hydrateSong(song, store.music) } : null;
  }

  async creators(params) {
    const store = await this.get();
    const query = musicSearchText(params.get('q'));
    const role = params.get('role') || '';
    let rows = store.creatorRows.filter((row) => {
      if (params.get('type') === 'person' && row.data.type === 'organization') return false;
      if (query && !searchText.matchesIndex(row.search, query)) return false;
      if (role && !(row.data.roles || []).some((item) => item.role === role)) return false;
      return true;
    });
    rows = rows.slice().sort((a, b) => (query ? searchText.rank([a.data.name,a.data.identity,a.data.aliases],query) - searchText.rank([b.data.name,b.data.identity,b.data.aliases],query) : 0) || String(a.data.name).localeCompare(String(b.data.name), 'ja'));
    const total = rows.length;
    const pageSize = Math.min(5000, pageNumber(params.get('page_size'), 40));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, pageNumber(params.get('page'), 1));
    return {
      build_id: store.buildId,
      coverage: store.creatorsDoc.coverage || {},
      items: rows.slice((page - 1) * pageSize, page * pageSize).map((row) => row.summary),
      total,
      page,
      page_size: pageSize
    };
  }

  async creator(id) {
    const store = await this.get();
    const creator = store.creatorsById.get(String(id));
    return creator ? { build_id: store.buildId, creator: { ...creator,
      collaborators: (creator.collaborators || []).map(relation => {
        const other = store.creatorsById.get(relation.creator_id);
        return { ...(other ? creatorSummary(other) : {}), ...relation };
      }) } } : null;
  }

  async albums(params) {
    const store = await this.get();
    params = new URL('http://catalog.invalid' + routes.resolve('/zh-Hans/music/albums?' + params, {
      albumYears: [...new Set(store.albums.map(row => releaseYear(row.release)))],
    })).searchParams;
    const query = musicSearchText(params.get('q'));
    const work = params.get('work') === 'all' ? '' : params.get('work') || '';
    const releaseSeries = params.get('release_series') === 'all' ? '' : params.get('release_series') || '';
    const type = params.get('type') ? albumType(params.get('type')) : '';
    const year = params.get('year') || '';
    const sort = params.get('sort') || 'newest';
    let rows = store.albumRows.filter((row) => {
      const album = row.summary;
      if (query && !searchText.includes([album.search_text, album.works?.map(key => routes.albumWorks.find(row => row.key === key)?.label), routes.albumSeries.find(row => row.key === album.release_series)?.label], query)) return false;
      if (work && !(album.works || [album.work]).includes(work)) return false;
      if (releaseSeries && album.release_series !== releaseSeries) return false;
      if (type && album.type !== type) return false;
      if (year && releaseYear(album.release) !== year) return false;
      return true;
    });
    rows = rows.slice().sort((a, b) => (query ? searchText.rank([a.data.name,a.data.aliases],query) - searchText.rank([b.data.name,b.data.aliases],query) : 0) || (sort === 'name'
      ? String(a.data.name).localeCompare(String(b.data.name), 'ja')
      : String(b.data.release || '').localeCompare(String(a.data.release || '')) || String(a.data.name).localeCompare(String(b.data.name), 'ja')));
    const total = rows.length;
    const pageSize = Math.min(5000, pageNumber(params.get('page_size'), 30));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pageCount, pageNumber(params.get('page'), 1));
    const types = Array.from(new Set(store.albums.map((album) => album.type).filter(Boolean)));
    const years = Array.from(new Set(store.albums.map((album) => releaseYear(album.release)))).sort().reverse();
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

  async album(id, name) {
    const store = await this.get();
    const album = (id && store.albumsById.get(String(id))) || (name && store.albumsByName.get(String(name)));
    if (!album) return null;
    const songs = (album.songs || []).map((track, index) => {
      // A title is not an identity. Album and track position identify the release.
      const song = store.albumTracks.get(stableAlbumId(album) + ':' + (index + 1));
      return song ? { ...songSummary(song, '', store.music), versions: (song.versions || []).map(version => ({
        id: version.id, title: version.title, version_label: version.version_label, instrumental: !!version.instrumental,
        releases: (version.releases || []).filter(release => release.album_id === stableAlbumId(album))
      })).filter(version => version.releases.length) } : null;
    }).filter(Boolean);
    return { build_id: store.buildId, album, catalog_songs: Array.from(new Map(songs.map((song) => [song.id, song])).values()) };
  }

  async albumSummaries(ids, snapshot) {
    const store = snapshot || await this.get();
    return ids.map(id => store.albumsById.get(id)).filter(Boolean).map(albumSummary);
  }

  async voices(params) {
    const store = await this.get();
    let voices = store.voicesDoc.voice_actors || [];
    if (params && params.get('id')) {
      voices = voices.filter(row => row.id === params.get('id'));
      if (!voices.length) return null;
    }
    if (params?.get('q')) voices = voices.filter(row => searchText.includes([row.identity, row.aliases, ...(row.roles || []).map(role => store.charactersById.get(role.character_id) || role)], params.get('q')));
    if (params?.get('q')) voices = voices.slice().sort((a,b) => searchText.rank([a.identity,a.aliases],params.get('q')) - searchText.rank([b.identity,b.aliases],params.get('q')));
    if (params && params.get('scope') === 'index') voices = voices.map(row => ({id:row.id,identity:row.identity,photo:row.photo,roles:row.roles}));
    return { build_id: store.buildId, voice_actors: voices };
  }

  async appearance(type, id) {
    const store = await this.get();
    const table = type === 'voice_actor' ? store.appearancesDoc.voice_actors : store.appearancesDoc.characters;
    if (!table || !Object.hasOwn(table, id)) return null;
    const originalAppearance = table[id];
    const appearance = { ...originalAppearance, events: (originalAppearance.events || []).map(row => {
      const mapped = store.parentForChild.get(row.event_id);
      if (!mapped) return row;
      const session = mapped.parent.sessions.find(session => session.id === row.session_id) || mapped.parent.sessions.find(session => session.source_event_id === row.event_id);
      return { ...row, parent_event_id: mapped.parent.id, parent_title: mapped.parent.title, child_label: session?.label || row.session_label, event_id: mapped.parent.id, session_id: row.session_id || mapped.session_id };
    }) };
    const songIds = new Set((appearance.songs || []).map((item) => item.song_id).filter(Boolean));
    const songs = Array.from(songIds)
      .map((songId) => store.songsById.get(String(songId)))
      .filter(Boolean)
      .map((song) => songForAppearance(song, type, id));
    return { build_id: store.buildId, appearance, songs };
  }
}

module.exports = { CatalogStore, albumSlug, stableAlbumId };
