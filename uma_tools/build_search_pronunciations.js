'use strict';

// Build offline pronunciation data. This runs during data/build or publish;
// the website never needs pinyin-pro at runtime.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let pinyin;
let kuromoji;
try { ({ pinyin } = require('pinyin-pro')); }
catch (error) {
  console.error('[search-pronunciations] pinyin-pro is unavailable; keeping the existing mapping');
  process.exitCode = 2;
  return;
}
try { kuromoji = require('kuromoji'); }
catch (error) {
  console.error('[search-pronunciations] kuromoji is unavailable; Japanese romaji entries will be omitted');
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
const japaneseCandidates = new Set();
const uiKeyPattern = /(?:title|name|label|alias|venue|identity|artist|author)/i;
const KATA = {'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o','カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko','サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so','タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to','ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no','ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho','マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo','ヤ':'ya','ユ':'yu','ヨ':'yo','ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro','ワ':'wa','ヲ':'o','ン':'n','ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go','ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo','ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do','バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo','パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po','ヴ':'vu','ー':''};
const KATA_PAIR = {'キャ':'kya','キュ':'kyu','キョ':'kyo','シャ':'sha','シュ':'shu','ショ':'sho','チャ':'cha','チュ':'chu','チョ':'cho','ニャ':'nya','ニュ':'nyu','ニョ':'nyo','ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo','ミャ':'mya','ミュ':'myu','ミョ':'myo','リャ':'rya','リュ':'ryu','リョ':'ryo','ギャ':'gya','ギュ':'gyu','ギョ':'gyo','ジャ':'ja','ジュ':'ju','ジョ':'jo','ビャ':'bya','ビュ':'byu','ビョ':'byo','ピャ':'pya','ピュ':'pyu','ピョ':'pyo','ファ':'fa','フィ':'fi','フェ':'fe','フォ':'fo','ティ':'ti','ディ':'di','トゥ':'tu','ドゥ':'du'};
// Confirmed readings for titles where a general dictionary chooses an
// unsuitable segmentation. Values include both spaced and compact search forms.
const ROMAJI_OVERRIDES = {'繚乱縁舞':'ryouran enbu ryouranenbu'};
function katakanaToRomaji(value) {
  let text = String(value || ''), out = '';
  for (let i=0; i<text.length; i++) {
    const pair = text.slice(i, i+2);
    if (KATA_PAIR[pair]) { out += KATA_PAIR[pair]; i++; continue; }
    if (text[i] === 'ッ') { out += (KATA[text[i+1]] || '').charAt(0); continue; }
    if (Object.prototype.hasOwnProperty.call(KATA, text[i])) out += KATA[text[i]];
    else if (!/[゛゜]/.test(text[i])) out += /[\s　]/.test(text[i]) ? ' ' : text[i];
  }
  return out.replace(/\s+/g, ' ').trim().toLowerCase();
}
function normalizeKey(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s　]+/g, ' ').trim();
}
function collect(value, target = values) {
  if (typeof value === 'string') {
    if (/[\u3400-\u9fffぁ-んァ-ン]/.test(value) && value.length <= 120) target.add(value);
  } else if (Array.isArray(value)) value.forEach(item => collect(item, target));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collect(item, target));
}
function collectJapanese(value, key = '') {
  if (typeof value === 'string') {
    if ((key === 'ja' || key === 'title' || key === 'name' || key === 'aliases') && /[\u3400-\u9fffぁ-んァ-ン]/.test(value) && value.length <= 120) japaneseCandidates.add(value);
  } else if (Array.isArray(value)) value.forEach(item => collectJapanese(item, key));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => collectJapanese(child, childKey));
}
function collectUi(value, key, target = uiTexts) {
  if (typeof value === 'string') {
    if (uiKeyPattern.test(String(key || '')) && /[\u3400-\u9fffぁ-んァ-ン]/.test(value) && value.length <= 120) target.add(value);
  } else if (Array.isArray(value)) value.forEach(item => collectUi(item, key, target));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => collectUi(child, childKey, target));
}
function readValue(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.js')) return JSON.parse(source.replace(/^window\.\w+\s*=\s*/, '').replace(/;\s*$/, ''));
  return JSON.parse(source);
}
async function main() {
for (const file of inputFiles) {
  try {
    if (fs.existsSync(path.join(root, file))) {
      const data = readValue(file);
      collect(data);
      if (['data/song_catalog.json','data/albums.json','data/character_index_data.js','data/voice_actor_profiles.json','data/anime/works.json','data/anime/units.json'].includes(file)) collectJapanese(data);
    }
  }
  catch (error) { console.warn('[search-pronunciations] skipped', file, error.message); }
}
let tokenizer = null;
if (kuromoji) {
  try {
    tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: path.join(__dirname, 'node_modules/kuromoji/dict') }).build((error, value) => error ? reject(error) : resolve(value)));
  } catch (error) { console.warn('[search-pronunciations] skipped Japanese readings:', error.message); }
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
  const item = {
    pinyin: roman,
    initials: syllables.map(item => item[0] || '').join('').toLowerCase()
  };
  if (tokenizer && japaneseCandidates.has(text)) {
    const tokens = tokenizer.tokenize(text);
    const readings = tokens.map(token => token.pronunciation || '').filter(Boolean);
    if (readings.length === tokens.length) {
      const reading = ROMAJI_OVERRIDES[text] || katakanaToRomaji(readings.join(''));
      if (reading) item.romaji = reading;
    }
  }
  if ((item.pinyin && /[a-z]/.test(item.pinyin)) || item.romaji) items[normalizeKey(text)] = item;
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
  if (!/^[\u3400-\u9fffぁ-んァ-ン\s·・，。！？、“”‘’（）()\-—]+$/.test(key)) continue;
  // Single-character pronunciation is the default. Keep a phrase only when
  // phrase-level pinyin differs (usually a confirmed polyphonic name).
  const chars = Array.from(key);
  const composed = chars.map(ch => items[ch]?.pinyin || '').join('');
  const initials = chars.map(ch => items[ch]?.initials || '').join('');
  if (chars.length > 1 && entry.pinyin === composed && entry.initials === initials && !entry.romaji) continue;
  const compact = [entry.pinyin, entry.initials];
  if (entry.romaji) compact.push(entry.romaji);
  uiValues[key] = compact;
}
atomic(path.join(__dirname, 'search-pronunciations-ui.js'), `window.UmaSearchPronunciations = ${JSON.stringify(uiValues)};\n`);
console.log(`[search-pronunciations] mapped ${Object.keys(items).length} values; ui ${Object.keys(uiValues).length}`);
}
main().catch(error => { console.error('[search-pronunciations] failed:', error); process.exitCode = 1; });
