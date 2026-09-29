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
    character: ['profile', 'pedigree', 'songs', 'appearances'],
    voiceActor: ['profile', 'songs', 'appearances']
  });

  function part(value) { return encodeURIComponent(String(value || '')); }
  function entity(base, id, section, allowed, defaultSection) {
    let path = prefix + base;
    if (!id) return path;
    path += '/' + part(id);
    if (section && section !== defaultSection && allowed.indexOf(section) >= 0) path += '/' + section;
    return path;
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
