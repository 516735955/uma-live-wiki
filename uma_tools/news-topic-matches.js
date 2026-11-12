'use strict';

const fold = value => String(value || '').normalize('NFKC').toLowerCase().replace(/髙/g, '高');
const compact = value => fold(value).replace(/[^\p{L}\p{N}]+/gu, '');
const stripBrand = value => fold(value).replace(/ウマ娘\s*プリティーダービー|赛马娘\s*pretty\s*derby/g, '');
const releaseNumber = value => fold(value).match(/(?:winning\s*live|starting\s*gate|animation\s*derby(?:\s*season\s*\d)?(?:\s*vol\.?\s*)?)\s*\d+/g) || [];
const castHeading = /^(?:[■●◆▼▽◎◇【\s]*)(?:出演(?:者|声優|キャスト)?|出走者|キャスト|歌唱者|登場キャラクター)(?:[】：:\s]|$)/;
const roleCredit = /\bCV[.：:\s]|[（(][^）)]{1,24}役[）)]/i;
const characterContext = /育成|ウマ娘|赛马娘|ガチャ|卡池|サポート|支援卡|主人公|漫画|コミック|キャラクター/;
const musicContext = /楽曲|主題歌|挿入歌|新曲|曲名|収録|配信|音源|ストリーミング|单曲|主题曲|原声带|mv/i;
const fields = ['event', 'character', 'voice', 'album', 'song', 'anime'];

function distinctNames(rows) {
  const found = new Map();
  for (const [key, names] of rows) {
    for (const raw of names.filter(Boolean)) {
      const name = compact(raw);
      if (!name || /^(ウマ娘|赛马娘|prettyderby|umamusume|ウマ娘プリティーダービー|赛马娘prettyderby|umamusumeprettyderby)$/.test(name)) continue;
      if (!found.has(name)) found.set(name, key);
      else if (found.get(name) !== key) found.set(name, null);
    }
  }
  return [...found].filter(([, id]) => id);
}

function contains(text, name) {
  const start = text.indexOf(name);
  return start >= 0 && (!/\d$/.test(name) || !/\d/.test(text[start + name.length] || ''));
}

function canonicalUrl(value, base) {
  try {
    const url = new URL(String(value || '').replace(/&amp;/g, '&'), base);
    if (url.hostname === 'umamusume.jp' && url.searchParams.has('id')) return 'official:' + url.searchParams.get('id');
    if (url.hostname === 'youtu.be') return 'youtube:' + url.pathname.split('/')[1];
    if (url.hostname.endsWith('.youtube.com') && url.searchParams.has('v')) return 'youtube:' + url.searchParams.get('v');
    return url.hostname + url.pathname.replace(/\/$/, '');
  } catch (_) { return ''; }
}

function createTopicMatcher(store, anime) {
  const eventId = id => store.parentForChild.get(id)?.parent.id || id;
  const eventSources = new Map();
  const events = distinctNames([...store.eventsById.values()].map(row => [eventId(row.id), [row.title_ja, row.title].filter(Boolean)
    .flatMap(name => [stripBrand(name), stripBrand(name).replace(/\s*day\s*\d+.*$/i, '')])]));
  for (const row of store.eventsDoc.events) {
    for (const source of row.sources || []) {
      if (!['official_announcement','official_youtube','eventernote'].includes(source.kind)) continue;
      const key = canonicalUrl(source.url);
      if (!key) continue;
      if (!eventSources.has(key)) eventSources.set(key, new Set());
      eventSources.get(key).add(eventId(row.id));
    }
  }
  const albums = distinctNames([...store.albumsById].map(([id, row]) =>
    [id, [stripBrand(row.name), ...releaseNumber(row.name), id.replace(/^album-/, '')]]));
  const albumCodes = new Map([...store.albumsById.keys()].map(id => [compact(id.replace(/^album-/, '')), id]));
  const songs = new Map(distinctNames([...store.songsById].map(([id, row]) => [id, [row.title, ...(row.aliases || [])]])));
  const works = distinctNames(anime.works.map(row =>
    [row.id, [row.title_ja, row.title_zh, ...(row.aliases || [])]]));
  const characters = distinctNames([...store.charactersById].map(([id, row]) => [id, [row.ja, row.zh]]));
  const voices = distinctNames(store.voicesDoc.voice_actors.map(row => [row.id, [row.identity.ja, row.identity.zh]]));

  return function match({ key, detail, text, localizedTitle = '' }) {
    const sourceTitle = String(detail.title || '');
    const title = sourceTitle + '\n' + localizedTitle;
    const titleKeys = [sourceTitle, localizedTitle].map(compact);
    const inTitle = name => titleKeys.some(text => contains(text, name));
    const selected = Object.fromEntries(fields.map(type => [type, new Set()]));
    const quoted = new Set([...title.matchAll(/[「『【《]([^」』】》]+)[」』】》]/g)].map(match => compact(match[1])));
    const ownUrl = key.startsWith('official-') ? 'official:' + key.slice(9) : canonicalUrl(detail.url);
    for (const id of eventSources.get(ownUrl) || []) selected.event.add(id);
    const eventNames = events.filter(([name]) => name.length >= 8 && inTitle(name));
    for (const [name, id] of eventNames) {
      if (!eventNames.some(([other, otherId]) => id !== otherId && other.length > name.length && other.includes(name))) selected.event.add(id);
    }
    if (/開催|公演|出走|出演|\bevent\b|イベント/i.test(sourceTitle)) {
      for (const match of String(detail.message || '').matchAll(/<a\s[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
        const url = canonicalUrl(match[1], detail.url || 'https://umamusume.jp');
        const ids = eventSources.get(url);
        if (ids?.size === 1 && /^(?:youtube:|(?:www\.)?eventernote\.com\/events\/)/.test(url)) {
          for (const id of ids) selected.event.add(id);
        }
      }
    }
    for (const [name, id] of albums) if (name.length >= 7 && inTitle(name)) selected.album.add(id);
    if (/発売|発表|収録|特典|サウンドトラック|リリース|cd|发售|勘误|誤表記|訂正/i.test(title)) {
      for (const code of (text || '').matchAll(/(?:品番|商品番号)\s*[：:]\s*([A-Z]{2,7}[-−–]\d{3,})/gi)) {
        const id = albumCodes.get(compact(code[1]));
        if (id) selected.album.add(id);
      }
    }
    for (const [name, id] of works) if (quoted.has(name) || (name.length >= 4 && inTitle(name))) selected.anime.add(id);
    if (musicContext.test(title) || /楽曲「|テーマソング「/.test(text || '')) {
      for (const name of quoted) if (songs.has(name)) selected.song.add(songs.get(name));
      for (const name of (text || '').matchAll(/(?:楽曲|テーマソング|主題歌)「([^」]+)」/g)) {
        const song = compact(name[1]);
        if (songs.has(song) && inTitle(song)) selected.song.add(songs.get(song));
      }
    }
    for (const name of (text || '').matchAll(/(?:楽曲「([^」]+)」を追加|正[）)]\s*([^\n]+)|「([^」]+)」\s*MVを公開)/g)) {
      const id = songs.get(compact(name[1] || name[2] || name[3]));
      if (id) selected.song.add(id);
    }
    for (const [name, id] of characters) {
      if (quoted.has(name) || (name.length >= 4 && characterContext.test(title) && inTitle(name))) selected.character.add(id);
    }
    for (const [name, id] of voices) {
      if (quoted.has(name) || (name.length >= 4 && /出演|声優|ゲスト|登壇/.test(title) && inTitle(name))) selected.voice.add(id);
    }
    let remainingCastLines = 0;
    for (const line of String(text || '').split('\n')) {
      if (castHeading.test(line)) remainingCastLines = 12;
      else if (/^[■●◆▼◎◇]|^【[^】]+】$/.test(line)) remainingCastLines = 0;
      const credit = roleCredit.test(line);
      const lineKey = compact(line);
      const creditLine = line.normalize('NFKC');
      if (/^[■▼・\s]*\[?(?:★{1,3}[1-3]?|SSR|SR)/i.test(creditLine) ||
          (/育成|覚醒|ガチャ|卡池/.test(title) && /^・\[[^\]]+\][^。]+$/.test(creditLine)) ||
          /サポートカード「\[[^\]]+\][^」]+」$/.test(creditLine)) {
        const match = characters.filter(([name]) => lineKey.endsWith(name)).sort((a, b) => b[0].length - a[0].length)[0];
        if (match) selected.character.add(match[1]);
      }
      if (credit || remainingCastLines > 0) {
        const tokens = new Set(fold(line).split(/[()「」『』、,：:\s・]/).map(compact));
        for (const [type, entries] of [['character', characters], ['voice', voices]]) {
          for (const [name, id] of entries) {
            if (tokens.has(name) || tokens.has(name + '役') || (credit && name.length >= 5 && lineKey.includes(name))) selected[type].add(id);
          }
        }
      }
      remainingCastLines--;
    }
    return Object.fromEntries(fields.filter(type => selected[type].size).map(type => [type, [...selected[type]]]));
  };
}

module.exports = { createTopicMatcher, fields };
