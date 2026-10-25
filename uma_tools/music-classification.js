'use strict';

const WORK_KEYS = {
  'anime-s1':'s1', 'anime-s2':'s2', 'anime-s3':'s3', 'anime-rttt':'rttp',
  'anime-movie-beginning-new-era':'movie', 'anime-cinderella-gray':'cinderella',
  'anime-umayon':'yon', 'anime-umayuru':'yuru',
  'anime-umayuru-prettygray':'pretty-gray', 'anime-umayuru-fullgate':'fullgate',
  'anime-1st-anniversary':'anniversary',
};

function releaseSeries(album) {
  const title = String(album.name || '');
  if (/Solo Vocal Tracks/i.test(title)) return 'solo-vocal';
  if (/WINNING LIVE/i.test(title)) return 'winning-live';
  if (/STARTING GATE/i.test(title)) return 'starting-gate';
  if (/ANIMATION DERBY/i.test(title)) return 'animation-derby';
  return 'other';
}

function createClassification(anime = {}, songs = [], fallbackWork = () => '') {
  const unitWork = new Map((anime.units || []).map(row => [row.id, row.work_id]));
  const worksByAlbum = new Map();
  const recordings = new Map();
  for (const song of songs) for (const version of song.versions || []) recordings.set(version.id, version);
  function add(album, work) {
    if (!album || !WORK_KEYS[work]) return;
    if (!worksByAlbum.has(album)) worksByAlbum.set(album, new Set());
    worksByAlbum.get(album).add(WORK_KEYS[work]);
  }
  for (const relation of anime.relations || []) {
    const work = relation.source_type === 'anime_unit' ? unitWork.get(relation.source_id) : relation.source_id;
    if (relation.target_type === 'album') add(relation.target_id, work);
    if (relation.target_type !== 'song' || relation.relation_type !== 'uses_song') continue;
    if (relation.release_id) add(relation.release_id, work);
    // Without an explicit release, use the documented recording, not every
    // version of the same composition (covers and TV edits may be different).
    if (relation.version_id) for (const release of recordings.get(relation.version_id)?.releases || []) add(release.album_id, work);
  }
  return (album, id) => {
    const series = album.release_series || releaseSeries(album);
    if (Array.isArray(album.works) && album.works.length) {
      return { works: [...new Set(album.works)], release_series: series };
    }
    const works = new Set(worksByAlbum.get(id) || []);
    const fallback = fallbackWork(album.name);
    if (!works.size && !['other','winning-live','starting-gate','solo-vocal'].includes(fallback)) works.add(fallback);
    if (!works.size) works.add(['winning-live','starting-gate','solo-vocal'].includes(series) ? 'game' : 'independent');
    return { works: [...works], release_series: series };
  };
}

module.exports = { createClassification, releaseSeries };
