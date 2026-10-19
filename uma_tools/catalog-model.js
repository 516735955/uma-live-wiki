(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.UmaCatalog = model;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function playableRecording(song, versionId) {
    const versions = [...(song?.versions || [])];
    versions.sort((a, b) => Number(b.id === song.original_version_id) - Number(a.id === song.original_version_id));
    for (const version of versions) {
      if (versionId && version.id !== versionId) continue;
      const release = (version.releases || []).find(row => row.audio_url);
      if (release) return {version, release};
    }
    const playable = song?.playable;
    if (playable?.audio_url && (!versionId || playable.version_id === versionId)) return {
      version: {id:playable.version_id, title:playable.version_title},
      release: {audio_url:playable.audio_url, artist:playable.artist, cover:playable.cover,
        album_id:playable.album_id, album_name:playable.album_name,
        voice_actor_ids:playable.voice_actor_ids || song.voice_actor_ids || []},
    };
    return null;
  }

  function eventSongCount(event) {
    if (!event?.sessions) return Number.isFinite(event?.song_count) ? event.song_count : 0;
    return event.sessions.reduce((total, session) => total +
      (session.performances?.length ? session.performances : session.songs || []).length, 0);
  }

  function isInstrumental(title, artist) {
    return /(?:off[ -]?vocal|instrumental|inst\.?|\bBGM\b|纯音乐|伴奏)/i
      .test(String(title || '').normalize('NFKC') + ' ' + String(artist || '').normalize('NFKC'));
  }

  function youtubeVideoId(value) {
    const text = String(value || '');
    if (/^[\w-]{11}$/.test(text)) return text;
    try {
      const url = new URL(text);
      const host = url.hostname.replace(/^(?:www\.|m\.)/, '');
      const id = host === 'youtu.be' ? url.pathname.split('/')[1]
        : ['youtube.com','youtube-nocookie.com'].includes(host)
          ? url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] : '';
      return /^[\w-]{11}$/.test(id || '') ? id : '';
    } catch (_) { return ''; }
  }

  return {playableRecording, eventSongCount, isInstrumental, youtubeVideoId};
});
