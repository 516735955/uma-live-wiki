(function (root, factory) {
  const routes = factory();
  if (typeof module === 'object' && module.exports) module.exports = routes;
  if (root) root.UmaRoutes = routes;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const language = 'zh-Hans';
  const prefix = '/' + language;
  const sections = Object.freeze({
    song: ['releases', 'credits', 'lyrics', 'performances'],
    creator: ['works', 'collaborators'],
    character: ['profile', 'pedigree', 'songs', 'anime', 'events'],
    voiceActor: ['profile', 'songs', 'anime', 'events']
  });
  const sectionAliases = Object.freeze({ appearances: 'events' });

  function normalizeSection(section) {
    return sectionAliases[String(section || '').toLowerCase()] || section;
  }

  function part(value) { return encodeURIComponent(String(value || '')); }
  function entity(base, id, section, allowed, defaultSection) {
    let path = prefix + base;
    if (!id) return path;
    path += '/' + part(id);
    section = normalizeSection(section);
    if (section && section !== defaultSection && allowed.indexOf(section) >= 0) path += '/' + section;
    return path;
  }

  function resolve(path) {
    const input = String(path || '');
    const url = new URL(input, 'http://uma-live-wiki.invalid');
    const segments = url.pathname.split('/');
    const entityIndex = segments[1] === language && segments[2] === 'database' &&
      (segments[3] === 'characters' || segments[3] === 'voice-actors') ? 3 : -1;
    const isPersonPath = entityIndex >= 0 && segments[4] &&
      (segments.length === 5 || (segments.length === 6 && segments[5]));
    if (isPersonPath) {
      const section = normalizeSection(segments[5] || url.searchParams.get('section'));
      const allowed = segments[3] === 'characters' ? sections.character : sections.voiceActor;
      if (allowed.includes(section)) {
        url.pathname = segments.slice(0, 5).concat(section === 'profile' ? [] : [section]).join('/');
        url.searchParams.delete('section');
      }
    }
    // The anime index no longer exposes a year filter, and web_short is a
    // distribution detail of the canonical short-animation format. Limit this
    // rewrite to the index so real work editions and episode URLs are intact.
    if (/^\/zh-Hans\/database\/anime\/?$/.test(url.pathname)) {
      url.searchParams.delete('year');
      if (url.searchParams.get('format') === 'web_short') url.searchParams.set('format', 'short');
    }
    const oneOf = (key, values) => {
      if (url.searchParams.has(key) && !values.includes(url.searchParams.get(key))) url.searchParams.delete(key);
    };
    if (/^\/zh-Hans\/events\/?$/.test(url.pathname)) {
      oneOf('kind', ['concert', 'onsite', 'official_program', 'all']);
      oneOf('mode', ['online', 'onsite', 'all']);
      oneOf('time', ['upcoming', 'past', 'announced', 'all']);
      if (url.searchParams.has('year') && !/^(20\d{2}|unknown|all)$/.test(url.searchParams.get('year'))) url.searchParams.delete('year');
      if (url.searchParams.get('series') === 'unclassified' && !['concert', 'onsite', 'official_program'].includes(url.searchParams.get('kind'))) url.searchParams.delete('series');
    }
    if (/^\/zh-Hans\/music\/albums\/?$/.test(url.pathname)) {
      oneOf('sort', ['name', 'newest']);
      if (url.searchParams.get('type') === '数字单曲') url.searchParams.set('type', '单曲');
    }
    if (url.searchParams.has('page') && !/^[1-9]\d*$/.test(url.searchParams.get('page'))) url.searchParams.delete('page');
    const query = url.searchParams.toString();
    return url.pathname + (query ? '?' + query : '') + (url.hash || '');
  }
  function query(path, values) {
    const params = new URLSearchParams();
    Object.keys(values || {}).forEach(function (key) {
      const value = values[key];
      if (value !== undefined && value !== null && value !== '' && value !== 'all' && value !== 1) params.set(key, value);
    });
    const suffix = params.toString();
    return suffix ? path + '?' + suffix : path;
  }

  return Object.freeze({
    language: language,
    prefix: prefix,
    sections: sections,
    normalizeSection: normalizeSection,
    resolve: resolve,
    home: function () { return prefix + '/'; },
    news: function (id) { return prefix + '/news' + (id ? '/' + part(id) : ''); },
    events: function (id, sessionId) {
      const base = prefix + '/events' + (id ? '/' + part(id) : '');
      return id && sessionId ? base + '/sessions/' + part(sessionId) : base;
    },
    songs: function (id, section) { return entity('/music/songs', id, section, sections.song, 'releases'); },
    albums: function (id) { return prefix + '/music/albums' + (id ? '/' + part(id) : ''); },
    creators: function (id, section) { return entity('/music/creators', id, section, sections.creator, 'works'); },
    characters: function (id, section) { return entity('/database/characters', id, section, sections.character, 'profile'); },
    voiceActors: function (id, section) { return entity('/database/voice-actors', id, section, sections.voiceActor, 'profile'); },
    anime: function (workId, unitId) {
      const base = prefix + '/database/anime' + (workId ? '/' + part(workId) : '');
      return workId && unitId ? base + '/episodes/' + part(unitId) : base;
    },
    staff: function (id) { return prefix + '/database/staff' + (id ? '/' + part(id) : ''); },
    other: function () { return prefix + '/database/other'; },
    horses: function (id) { return prefix + '/database/horses' + (id ? '/' + part(id) : ''); },
    jockeys: function (id) { return prefix + '/database/jockeys' + (id ? '/' + part(id) : ''); },
    relationships: function () { return prefix + '/database/relationships'; },
    videos: function () { return prefix + '/resources/videos'; },
    links: function () { return prefix + '/links'; },
    contribute: function (page) { return prefix + '/contribute/' + (page === 'contact' ? 'contact' : 'fix'); },
    legal: function (page) { return prefix + '/legal/' + (page === 'privacy' ? 'privacy' : 'terms'); },
    query: query
  });
});
