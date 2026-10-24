'use strict';

// Persist translations for newly discovered entity copy.  This deliberately
// handles descriptions and explicit title_zh fields only; canonical names,
// voice-actor names, horse names, song titles and lyrics remain curated data.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const https = require('https');
const { TranslationCache } = require('./translation-cache');
const { NewsContent } = require('./news-content');
const { createTerms, loadTerms } = require('./translation-terms');
const { untranslatedJapanese, translationFactsMatch } = require('./translation-facts');
const { execFileSync } = require('child_process');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function readWindow(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  const context = {};
  context.window = context;
  vm.runInNewContext(source + `\nthis.__value = ${name};`, context);
  return context.__value;
}

function hasJapanese(value) { return /[ぁ-ゖァ-ヺ]/.test(String(value || '')); }

function hasJapaneseDescription(html) {
  // Character cards embed the canonical Japanese name in lang=ja spans even
  // when the actual description is already Chinese. Do not enqueue those
  // cards merely because an identity label is bilingual.
  const description = String(html || '')
    .replace(/<span\b[^>]*\blang=["']ja["'][^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  return hasJapanese(description);
}

function sourceRecords(root) {
  const data = path.join(root, 'data');
  const records = [];
  for (const work of (readJson(path.join(data, 'anime/works.json'), {}).works || [])) {
    if (!hasJapanese(work.title_ja) && !hasJapanese(work.summary_ja)) continue;
    if (work.title_ja && ((work.title_zh === work.title_ja || !work.title_zh) || work.summary_ja))
      records.push({ key: `anime-work:${work.id}`, entity_type: 'anime_work', entity_id: work.id, file: 'works', title_ja: work.title_ja, title_zh: work.title_zh || '', summary_ja: work.summary_ja || '', summary_zh: work.summary_zh || '' });
  }
  const units = readJson(path.join(data, 'anime/units.json'), {});
  for (const series of units.series || []) for (const [number, detail] of Object.entries(series.details || {})) {
    if (detail.summary_ja) records.push({ key: `anime-episode:${series.work_id}:${number}`, entity_type: 'anime_episode', entity_id: `${series.work_id}:${number}`, file: 'units', work_id: series.work_id, number, summary_ja: detail.summary_ja, summary_zh: detail.summary_zh || '' });
  }
  const detail = readWindow(path.join(data, 'character_detail_data.js'), 'CHAR_DETAIL');
  for (const [id, row] of Object.entries(detail)) {
    // Only send a character description when it really contains Japanese.
    const original = row.language === 'ja' ? row.html : (row.html_ja || row.html);
    if ((row.language === 'ja' || row.html_ja) && hasJapaneseDescription(original)) records.push({ key: `character:${id}`, entity_type: 'character', entity_id: id, file: 'characters', summary_ja: original, summary_zh: row.language === 'zh' ? row.html : '' });
  }
  const horses = readWindow(path.join(data, 'horses_details.js'), 'HORSES_DETAIL');
  for (const [id, row] of Object.entries(horses)) {
    for (const field of ['intro', 'career', 'retirement', 'breeding', 'blood']) {
      if (row.wiki && row.wiki.lang && row.wiki.lang !== 'ja' && !row[`${field}_ja`]) continue;
      const values = Array.isArray(row[field]) ? row[field] : [];
      values.forEach((text, index) => {
        const original = (row[`${field}_zh`] || [])[index] === text
          ? (row[`${field}_ja`] || [])[index]
          : (hasJapanese(text) ? text : (row[`${field}_ja`] || [])[index]);
        if (original && hasJapanese(original)) records.push({ key: `horse:${id}:${field}:${index}`, entity_type: 'horse', entity_id: id, field, index, summary_ja: original, summary_zh: !hasJapanese(text) ? text : '' });
      });
    }
  }
  return records;
}

function createTranslator(root, noApi) {
  if (noApi) return { terms: { normalize: value => value }, translate: async () => '' };
  const terms = createTerms(loadTerms(root));
  let service;
  async function translate(text, html) {
    if (!text || !hasJapanese(text) || noApi) return '';
    service ||= require('./server-translation').createService({
      fs, path, crypto, https, ROOT: root, DATA_DIR: path.join(root, 'data'),
      TranslationCache, NewsContent, createTerms, loadTerms,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      return await new Promise(resolve => {
        const done = value => resolve(value || '');
        // HTML must go through the HTML-preserving translator. If the running
        // service has not exported it yet, leave the item pending instead of
        // sending tags through the title translator.
        if (html && service.translateHtmlMessage) service.translateHtmlMessage(text, done, controller.signal);
        else if (!html) service.translateTitle(text, done, controller.signal);
        else done('');
      });
    } finally { clearTimeout(timeout); }
  }
  return { terms, translate, get quotaPaused() { return service && service.translationBlockCode === '54004'; } };
}

function writeWindow(file, name, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `window.${name} = ${JSON.stringify(value, null, 2)};\n`);
  fs.renameSync(temporary, file);
}

function writeJson(file, document) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(document, null, 2) + '\n');
  fs.renameSync(temporary, file);
}

function applyEntity(root, source, field, translated, replace = false) {
  const data = path.join(root, 'data');
  if (source.entity_type === 'anime_work') {
    const file = path.join(data, 'anime/works.json');
    const document = readJson(file, {});
    const row = (document.works || []).find(item => item.id === source.entity_id);
    if (!row) return;
    const target = `${field}_zh`, original = `${field}_ja`;
    if (row[target] === translated) return;
    if (!row[target] || row[target] === row[original] || replace) row[target] = translated;
    else return;
    writeJson(file, document);
    return true;
  } else if (source.entity_type === 'anime_episode') {
    const file = path.join(data, 'anime/units.json');
    const document = readJson(file, {});
    const series = (document.series || []).find(item => item.work_id === source.work_id);
    const row = series && series.details && series.details[source.number];
    if (!row || row[`${field}_zh`] === translated) return;
    if (!row[`${field}_zh`] || replace) row[`${field}_zh`] = translated;
    else return;
    writeJson(file, document);
    return true;
  } else if (source.entity_type === 'character' && field === 'summary') {
    const file = path.join(data, 'character_detail_data.js');
    const document = readWindow(file, 'CHAR_DETAIL');
    const row = document[source.entity_id];
    if (!row) return;
    if (row.html === translated && row.html_ja === source.summary_ja) return;
    row.html_ja = source.summary_ja;
    row.html = translated;
    row.language = translated === source.summary_ja ? 'ja' : 'zh';
    writeWindow(file, 'CHAR_DETAIL', document);
    return true;
  } else if (source.entity_type === 'horse' && field === 'summary') {
    const file = path.join(data, 'horses_details.js');
    const document = readWindow(file, 'HORSES_DETAIL');
    const row = document[source.entity_id];
    if (!row) return;
    if (row[source.field][source.index] === translated) return;
    const target = `${source.field}_zh`;
    row[target] = Array.isArray(row[target]) ? row[target] : [];
    row[target][source.index] = translated === source.summary_ja ? '' : translated;
    row[`${source.field}_ja`] = Array.isArray(row[`${source.field}_ja`]) ? row[`${source.field}_ja`] : row[source.field].slice();
    row[`${source.field}_ja`][source.index] = source.summary_ja;
    row[source.field][source.index] = translated;
    writeWindow(file, 'HORSES_DETAIL', document);
    return true;
  }
}

async function run(root = path.resolve(__dirname, '..'), options = {}) {
  const file = path.join(root, 'data/auto_update/entity_localizations.json');
  const initialize = options.initialize || !fs.existsSync(file);
  const document = readJson(file, { schema_version: 1, records: {}, pending: [] });
  const records = { ...(document.records || {}) };
  let pending = [];
  const previousPending = new Map((document.pending || []).map(item => [`${item.key}:${item.field}`, item]));
  const handledKeys = new Set();
  const translator = createTranslator(root, options.noApi);
  const translate = options.translate || translator.translate;
  let changed = 0;
  let animeChanged = false;
  for (const source of sourceRecords(root)) {
    handledKeys.add(source.key);
    const previous = records[source.key] || {};
    const next = { ...previous, entity_type: source.entity_type, entity_id: source.entity_id };
    for (const field of ['title', 'summary']) {
      const sourceText = source[`${field}_ja`] || '';
      if (!sourceText || !hasJapanese(sourceText)) continue;
      if (source[`${field}_zh`] && source[`${field}_zh`] !== sourceText && source[`${field}_zh`] !== previous[`${field}_zh`] && source[`${field}_zh`] !== previous[`${field}_stale_zh`]) {
        next[`${field}_ja`] = sourceText;
        next[`${field}_zh`] = source[`${field}_zh`];
        next[`${field}_translator`] = 'accepted';
        delete next[`${field}_stale_zh`];
        continue;
      }
      if (previous[`${field}_ja`] === sourceText && previous[`${field}_zh`]) {
        const applied = applyEntity(root, source, field, previous[`${field}_zh`], previous[`${field}_translator`] === 'baidu');
        if (applied && source.entity_type.startsWith('anime_')) animeChanged = true;
        continue;
      }
      // Existing confirmed Chinese copy is accepted without a new API call;
      // names and manually curated copy are never machine-translated.
      if (source[`${field}_zh`] && source[`${field}_zh`] !== sourceText && !previous[`${field}_ja`]) {
        next[`${field}_ja`] = sourceText;
        next[`${field}_zh`] = source[`${field}_zh`];
        next[`${field}_translator`] = 'accepted';
        continue;
      }
      const oldPending = previousPending.get(`${source.key}:${field}`);
      const changedReviewedSource = previous[`${field}_ja`] && previous[`${field}_ja`] !== sourceText && previous[`${field}_translator`] === 'accepted';
      if (initialize || changedReviewedSource || (previous[`${field}_ja`] === sourceText && oldPending && oldPending.owner === 'assistant')) {
        next[`${field}_ja`] = sourceText;
        if (previous[`${field}_zh`]) next[`${field}_stale_zh`] = previous[`${field}_zh`];
        delete next[`${field}_zh`];
        pending.push({ key: source.key, field, source: sourceText, owner: 'assistant' });
        continue;
      }
      const translated = await translate(sourceText, source.entity_type === 'character');
      if (translated && !untranslatedJapanese(sourceText, translated) && translationFactsMatch(sourceText, translated)) {
        next[`${field}_ja`] = sourceText;
        next[`${field}_zh`] = translator.terms.normalize(translated);
        next[`${field}_translator`] = 'baidu';
        delete next[`${field}_stale_zh`];
        next.state = 'complete';
        applyEntity(root, source, field, next[`${field}_zh`], previous[`${field}_translator`] === 'baidu');
        if (source.entity_type.startsWith('anime_')) animeChanged = true;
      } else {
        next[`${field}_ja`] = sourceText;
        if (previous[`${field}_zh`]) next[`${field}_stale_zh`] = previous[`${field}_zh`];
        delete next[`${field}_zh`];
        if (previous[`${field}_translator`] === 'baidu' && previous[`${field}_ja`] !== sourceText) {
          const cleared = applyEntity(root, source, field, source.entity_type === 'character' || source.entity_type === 'horse' ? sourceText : '', true);
          if (cleared && source.entity_type.startsWith('anime_')) animeChanged = true;
        }
        next.state = 'pending';
        pending.push({ key: source.key, field, source: sourceText, owner: 'baidu' });
      }
    }
    const unresolved = pending.some(item => item.key === source.key);
    if (unresolved) next.state = 'pending';
    else if (Object.keys(next).some(key => key.endsWith('_zh') && next[key])) next.state = 'complete';
    if (JSON.stringify(previous) !== JSON.stringify(next)) changed++;
    records[source.key] = next;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ schema_version: 1, records, pending }, null, 2) + '\n');
  fs.renameSync(temporary, file);
  if (animeChanged && options.rebuild !== false) execFileSync(
    process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
    [path.join(root, 'uma_tools/build_anime_catalog.py')], { cwd: root, stdio: 'inherit' });
  const pendingAutomatic = pending.filter(item => item.owner !== 'assistant').length;
  return { entities: Object.keys(records).length, changed, pending: pending.length, pendingAutomatic,
    deferredQuota: translator.quotaPaused ? pendingAutomatic : 0,
    deferredOwner: options.noApi ? pendingAutomatic : 0 };
}

if (require.main === module) run(undefined, { noApi: process.argv.includes('--no-api'), initialize: process.argv.includes('--initialize') })
  .then(result => { console.log('entity localization:', JSON.stringify(result)); if (result.pendingAutomatic > Math.max(result.deferredQuota, result.deferredOwner)) process.exitCode = 1; })
  .catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { run, sourceRecords };
