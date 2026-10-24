'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { createService } = require('./server-translation');
const { createTerms } = require('./translation-terms');
const { NewsContent } = require('./news-content');

function fixtureData() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-translation-data-'));
  fs.mkdirSync(path.join(directory, 'auto_update'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'anime'), { recursive: true });
  for (const name of ['character_index_data.js', 'voice_actor_profiles.json', 'events_catalog.json', 'anime/works.json']) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '../data', name), target);
  }
  return directory;
}

function serviceFor(dataDir, cacheValues, onRequest) {
  class Cache {
    constructor() { this.values = { ...cacheValues }; }
    get(key) { return this.values[key]; }
    findBySuffix(suffix, prefix) {
      return Object.entries(this.values).find(([key]) => key.startsWith(prefix) && key.endsWith(suffix))?.[1] || '';
    }
    async set() {}
    async setMany() {}
  }
  return createService({
    fs, path, crypto, ROOT: path.resolve(__dirname, '..'), DATA_DIR: dataDir,
    TranslationCache: Cache, NewsContent,
    createTerms, loadTerms: () => [{ ja: '架空名', zh: '名称' }],
    https: { request(url, options, callback) { onRequest(); const request = new EventEmitter(); request.setTimeout = () => request; request.destroy = error => request.emit('error', error); request.end = () => setImmediate(() => { const response = new EventEmitter(); callback(response); response.emit('data', JSON.stringify({ error_code: '54004' })); response.emit('end'); }); return request; } }
  });
}

async function main() {
  let dataDir;
  const previous = [process.env.BAIDU_APPID, process.env.BAIDU_SECRET];
  process.env.BAIDU_APPID = process.env.BAIDU_SECRET = 'fixture';
  try {
    dataDir = fixtureData();
    let calls = 0;
    const oldTerms = 'terms_previous:架空名新闻';
    const service = serviceFor(dataDir, { [oldTerms]: '名称新闻' }, () => { calls++; });
    await new Promise(resolve => service.translateTitle('架空名新闻', () => resolve(), new AbortController().signal));
    assert.strictEqual(calls, 0, 'a successful translation under an older terms revision is reused');
    const shared = serviceFor(dataDir, { 'fragment:terms_previous:架空名新闻': '名称新闻' }, () => { calls++; });
    await new Promise(resolve => shared.translateTitle('架空名新闻', resolve, new AbortController().signal));
    assert.strictEqual(calls, 0, 'entity copy reuses an already translated news text fragment');

    let quotaCalls = 0;
    const quotaService = serviceFor(dataDir, {}, () => { quotaCalls++; });
    const translate = () => new Promise(resolve => quotaService.translateTitle('新しいタイトル', resolve, new AbortController().signal));
    await translate();
    const status = JSON.parse(fs.readFileSync(path.join(dataDir, 'auto_update/translation_status.json'), 'utf8'));
    assert.strictEqual(status.code, '54004');
    assert.strictEqual(status.blocked_until, null);
    assert.strictEqual(quotaService.translationAvailable, false);
    await translate();
    assert.strictEqual(quotaCalls, 1, 'quota exhaustion does not probe Baidu again in the same process');
    const restarted = serviceFor(dataDir, {}, () => { quotaCalls++; });
    await new Promise(resolve => restarted.translateTitle('新しい別のタイトル', resolve, new AbortController().signal));
    assert.strictEqual(quotaCalls, 1, 'quota exhaustion also survives process recreation');
    console.log('translation cache version reuse and persistent 54004 blocking passed');
  } finally {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    for (const [index, name] of ['BAIDU_APPID', 'BAIDU_SECRET'].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
