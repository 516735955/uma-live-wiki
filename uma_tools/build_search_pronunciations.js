'use strict';

// Build offline pronunciation data. This runs during data/build or publish;
// the website never needs pinyin-pro at runtime.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let pinyin;
try { ({ pinyin } = require('pinyin-pro')); }
catch (error) {
  console.error('[search-pronunciations] pinyin-pro is unavailable; keeping the existing mapping');
  process.exitCode = 2;
  return;
}

const root = path.resolve(__dirname, '..');
const inputFiles = [
  'data/character_index_data.js', 'data/voice_actor_profiles.json',
  'data/events_catalog.json', 'data/events/venues.json', 'data/events/groupings.json',
  'data/song_catalog.json', 'data/albums.json', 'data/creator_catalog.json',
  'data/anime/works.json', 'data/anime/units.json', 'data/news_snapshot.json',
  'data/lantis_news.json'
];
const values = new Set();
const uiTexts = new Set();
const uiKeyPattern = /(?:title|name|label|alias|venue|identity|artist|author)/i;
function normalizeKey(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, ' ').trim();
}
function collect(value, target = values) {
  if (typeof value === 'string') {
    if (/[\u3400-\u9fff]/.test(value) && value.length <= 120) target.add(value);
  } else if (Array.isArray(value)) value.forEach(item => collect(item, target));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collect(item, target));
}
function collectUi(value, key, target = uiTexts) {
  if (typeof value === 'string') {
    if (uiKeyPattern.test(String(key || '')) && /[\u3400-\u9fff]/.test(value) && value.length <= 120) target.add(value);
  } else if (Array.isArray(value)) value.forEach(item => collectUi(item, key, target));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => collectUi(child, childKey, target));
}
function readValue(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.js')) return JSON.parse(source.replace(/^window\.\w+\s*=\s*/, '').replace(/;\s*$/, ''));
  return JSON.parse(source);
}
for (const file of inputFiles) {
  try { if (fs.existsSync(path.join(root, file))) collect(readValue(file)); }
  catch (error) { console.warn('[search-pronunciations] skipped', file, error.message); }
}
// Keep single-character entries as a compact offline fallback so a query can
// be a substring of a title (for example “赛马娘” in a longer event title).
// Full phrases still win whenever the source contains the complete phrase.
for (const text of Array.from(values)) {
  for (const ch of text) if (/^[\u3400-\u9fff]$/.test(ch)) values.add(ch);
}
const items = {};
for (const text of values) {
  const syllables = pinyin(text, { toneType: 'none', type: 'array' });
  const roman = syllables.join('').toLowerCase();
  if (roman && /[a-z]/.test(roman)) items[normalizeKey(text)] = {
    pinyin: roman,
    initials: syllables.map(item => item[0] || '').join('').toLowerCase()
  };
}
const contentHash = crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 12);
const document = { schema_version: 1, content_hash: contentHash, items };
function atomic(file, content) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}
atomic(path.join(__dirname, 'search-pronunciations.json'), JSON.stringify(document) + '\n');
for (const file of inputFiles) {
  try {
    collectUi(readValue(file), '', uiTexts);
  } catch (error) { /* already warned above */ }
}
for (const text of Array.from(uiTexts)) {
  for (const ch of text) if (/^[\u3400-\u9fff]$/.test(ch)) uiTexts.add(ch);
}
const uiValues = {};
for (const text of uiTexts) {
  const key = normalizeKey(text);
  const entry = items[key];
  if (!entry) continue;
  if (!/^[\u3400-\u9fff\s·・，。！？、“”‘’（）()\-—]+$/.test(key)) continue;
  // Single-character pronunciation is the default. Keep a phrase only when
  // phrase-level pinyin differs (usually a confirmed polyphonic name).
  const chars = Array.from(key);
  const composed = chars.map(ch => items[ch]?.pinyin || '').join('');
  const initials = chars.map(ch => items[ch]?.initials || '').join('');
  if (chars.length > 1 && entry.pinyin === composed && entry.initials === initials) continue;
  uiValues[key] = [entry.pinyin, entry.initials];
}
atomic(path.join(__dirname, 'search-pronunciations-ui.js'), `window.UmaSearchPronunciations = ${JSON.stringify(uiValues)};\n`);
console.log(`[search-pronunciations] mapped ${Object.keys(items).length} values; ui ${Object.keys(uiValues).length}`);
