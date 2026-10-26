'use strict';

// Translate only new or changed event text during maintenance, never on visits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { TranslationCache } = require('./translation-cache');
const { NewsContent } = require('./news-content');
const { createTerms, loadTerms } = require('./translation-terms');
const { translationFactsMatch, untranslatedJapanese } = require('./translation-facts');
const { execFileSync } = require('child_process');

async function run(root = path.resolve(__dirname, '..'), options = {}) {
  const data = path.join(root, 'data');
  const read = (name, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(data, name), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  };
  const manual = read('events/localizations.json', {}).records || {};
  const saved = read('auto_update/event_localizations.json', {}).records || {};
  const records = { ...saved };
  const events = read('events_catalog.json', {}).events || [];
  const terms = createTerms(loadTerms(root));
  let service;
  const translate = async text => {
    const normalized = terms.normalize(text);
    // Standard series names and known entity names need no network translation.
    if (!/[\u3040-\u30ff]/.test(normalized)) return { text: normalized, translator: normalized === text ? 'source' : 'glossary' };
    if (options.noApi) return '';
    service ||= require('./server-translation').createService({
      fs, path, crypto, https, ROOT: root, DATA_DIR: data,
      TranslationCache, NewsContent, createTerms, loadTerms,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const result = await new Promise(resolve => service.translateTitle(text, resolve, controller.signal));
      return { text: result, translator: 'baidu' };
    } finally { clearTimeout(timeout); }
  };
  let changed = 0;
  const pending = [];
  for (const event of events) {
    const original = {
      title_ja: event.title_ja || event.title || '',
      summary_ja: event.summary_ja ?? event.summary ?? '',
    };
    const approved = manual[event.id] || {};
    const previous = saved[event.id] || {};
    const next = { ...previous, ...original };
    for (const field of ['title', 'summary']) {
      const source = original[field + '_ja'];
      if (approved[field + '_zh'] && approved[field + '_ja'] === source) {
        next[field + '_zh'] = approved[field + '_zh'];
        next[field + '_translator'] = approved[field + '_translator'] || approved.translator || 'assistant';
        continue;
      }
      if (!source) { next[field + '_zh'] = ''; continue; }
      const reviewed = approved[field + '_zh'] ? approved : previous;
      const owner = reviewed[field + '_translator'] || reviewed.translator;
      if (reviewed[field + '_zh'] && reviewed[field + '_ja'] !== source &&
          ['assistant', 'manual', 'reviewed'].includes(owner) && /[\u3040-\u30ff]/.test(terms.normalize(source))) {
        next[field + '_ja'] = reviewed[field + '_ja'];
        next[field + '_zh'] = reviewed[field + '_zh'];
        next[field + '_translator'] = owner;
        pending.push({ id: event.id, field, owner: 'assistant' });
        continue;
      }
      if (previous[field + '_ja'] === source && previous[field + '_zh']) continue;
      const result = await translate(source);
      const translated = result && result.text;
      if (translated && !untranslatedJapanese(source, translated) && translationFactsMatch(source, translated)) {
        next[field + '_zh'] = translated;
        next[field + '_translator'] = result.translator;
      } else {
        // Keep the old archived copy but do not apply it to changed source text.
        delete next[field + '_zh'];
        delete next[field + '_translator'];
        pending.push({ id: event.id, field });
      }
    }
    if (JSON.stringify(previous) !== JSON.stringify(next)) changed++;
    records[event.id] = next;
  }
  const target = path.join(data, 'auto_update/event_localizations.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify({ schema_version: 1, records, pending }, null, 2) + '\n');
    fs.renameSync(temporary, target);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  if (changed && options.rebuild !== false) {
    execFileSync(process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
      [path.join(root, 'uma_tools/update_events.py')], { cwd: root, stdio: 'inherit' });
  }
  const result = { events: events.length, changed, pending: pending.length,
    deferredQuota: service && service.translationBlockCode === '54004' ? pending.filter(item => item.owner !== 'assistant').length : 0,
    deferredOwner: options.noApi ? pending.length : pending.filter(item => item.owner === 'assistant').length };
  console.log('event localization:', JSON.stringify(result));
  return result;
}

module.exports = { run };
if (require.main === module) {
  run(undefined, { noApi: process.argv.includes('--no-api') })
    .then(result => { if (result.pending > result.deferredQuota + result.deferredOwner) process.exitCode = 1; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
