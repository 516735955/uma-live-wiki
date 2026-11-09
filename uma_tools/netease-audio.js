'use strict';

const fs = require('node:fs/promises');

const LEVELS = ['standard', 'exhigh', 'lossless', 'hires'];
const ORIGIN = 'https://music.163.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

function neteaseTrackId(value) {
  try {
    const url = new URL(value, 'https://wiki.invalid');
    const params = url.searchParams;
    const id = url.origin === 'https://wiki.invalid' && url.pathname === '/api/audio' ? params.get('track')
      : url.hostname === 'api.injahow.cn' && url.pathname === '/meting/' &&
        params.get('server') === 'netease' && params.get('type') === 'url' ? params.get('id') : '';
    return /^\d{1,16}$/.test(id || '') ? id : '';
  } catch (error) {
    return '';
  }
}

function neteaseCdn(value) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.port && ['http:', 'https:'].includes(url.protocol) &&
      (url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net'));
  } catch (error) {
    return false;
  }
}

function createNetEaseAudio({ sessionFile, fetchJson } = {}) {
  let playback = { session: '', cache: new Map() };
  const anonymous = { session: '', cache: new Map() };
  const metadata = new Map();
  async function readSession() {
    if (!sessionFile) return '';
    return fs.readFile(sessionFile, 'utf8').then(value => value.trim(), error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    }).then(value => /^([^\r\n]+)$/.test(value) && /(?:^|;\s*)MUSIC_U=[^;\s]+/.test(value) ? value : '');
  }

  function cached(cache, key, read) {
    const time = Date.now();
    const entry = cache.get(key);
    if (entry && entry.until > time) return entry.value;
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    const value = Promise.resolve().then(read).catch(error => {
      if (cache.get(key)?.value === value) cache.delete(key);
      throw error;
    });
    cache.set(key, { until: time + 90_000, value });
    return value;
  }

  const request = fetchJson || (async (endpoint, params, cookie) => {
    const headers = { 'User-Agent': USER_AGENT, Referer: ORIGIN + '/', Origin: ORIGIN };
    if (cookie) {
      headers.Cookie = cookie;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const response = await fetch(ORIGIN + endpoint + (cookie ? '' : '?' + params), {
      method: cookie ? 'POST' : 'GET',
      body: cookie ? params : undefined,
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) throw new Error('NetEase response unavailable');
    return response.json();
  });

  function resolve(id, quality, state) {
    const wanted = quality === 'auto' ? 'exhigh' : quality;
    return cached(state.cache, id + ':' + wanted, async () => {
      const params = new URLSearchParams({
        ids: JSON.stringify([Number(id)]), level: wanted,
        encodeType: wanted === 'lossless' || wanted === 'hires' ? 'flac' : 'mp3'
      });
      const doc = await request('/api/song/enhance/player/url/v1', params, state.session);
      if (doc.code !== 200) throw new Error('NetEase playback lookup failed');
      const row = (doc.data || []).find(item => String(item.id) === id);
      if (!row || row.code !== 200 || !neteaseCdn(row.url)) return null;
      const url = new URL(row.url);
      url.protocol = 'https:';
      const actual = LEVELS.includes(row.level) ? row.level : '';
      if (['lossless', 'hires'].includes(actual) && row.type !== 'flac') return null;
      return { url: url.href, actual, duration: Number(row.time) || 0, trial: !!row.freeTrialInfo, cookie: state.session };
    });
  }

  async function lookup(id, quality, expectedDuration, info, includeLevels) {
    const session = await readSession().catch(() => '');
    if (session !== playback.session) playback = session ? { session, cache: new Map() } : anonymous;
    const current = playback;
    const duration = info && !expectedDuration
      ? cached(metadata, id, async () => {
          const params = new URLSearchParams({ c: JSON.stringify([{ id: Number(id) }]) });
          const doc = await request('/api/v3/song/detail', params, '');
          return Number(doc.songs?.find(song => String(song.id) === id)?.dt) || 0;
        }).catch(() => 0)
      : expectedDuration;
    async function preferred(level) {
      const member = await resolve(id, level, current).catch(() => null);
      if (!current.session || (member && !member.trial)) return member;
      const publicRow = await resolve(id, level, anonymous).catch(() => null);
      return publicRow && (!member || !publicRow.trial) ? publicRow : member;
    }
    let row = await preferred(quality);
    if ((!row || row.trial) && !['auto', 'exhigh'].includes(quality)) {
      const fallback = await preferred('auto');
      if (fallback && (!row || !fallback.trial)) row = fallback;
    }
    if (!row) return null;
    const expected = await duration;
    const classify = stream => stream.trial || (expected > 0 && stream.duration > 0 && stream.duration < expected - 2000) ? 'preview'
      : stream.duration > 0 ? 'full' : 'unknown';
    const result = { ...row, status: classify(row), levels: [] };
    if (includeLevels && result.status === 'full') {
      const available = await Promise.allSettled(LEVELS.map(level => resolve(id, level, row.cookie ? current : anonymous)));
      result.levels = LEVELS.filter((level, index) => {
        const item = available[index];
        return item.status === 'fulfilled' && item.value?.actual === level && classify(item.value) === 'full';
      });
    }
    return result;
  }

  return { lookup };
}

module.exports = { LEVELS, neteaseTrackId, neteaseCdn, createNetEaseAudio, USER_AGENT };
