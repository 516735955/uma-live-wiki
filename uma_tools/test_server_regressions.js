'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

async function main() {
  const timers = [];
  const pages = [];
  const images = [];
  const saved = [];
  const context = vm.createContext({
    newsRefreshPromise: null, newsRefreshRevision: 0,
    newsIndexCache: { at: 0, data: { information_list: [] } }, transCache: {},
    NEWS_MAX_CONC: 3, NEWS_TTL: 900000, NO_AUTO_CRAWL: true,
    setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {},
    fetchNewsPageRetry(page, callback) { pages.push(callback); },
    persistNewsSnapshot(data) { saved.push(data); },
    mergeLantis() {}, backfillNewsImages(rows, callback) { images.push({ rows, callback }); },
    translateTitle() {}, reloadNewsSnapshotIfNewer() {}, reloadLantisIfNewer() {},
    console: { log() {}, error() {} }, crypto,
    sendJson(res, status, body, options) { res.body = body; res.options = options; }
  });
  vm.runInContext(section('function refreshNewsIndex()', 'function handleNewsDetail('), context);
  const abandoned = context.refreshNewsIndex();
  const failed = abandoned.catch(() => {});
  timers[0]();
  await failed;
  const replacement = context.refreshNewsIndex();
  pages[1](null, { total_page_count: 1, information_list: [{ announce_id: 2, title: 'new', post_at: '2026-10-08' }] });
  await replacement;
  pages[0](null, { total_page_count: 1, information_list: [{ announce_id: 1, title: 'expired' }] });
  assert.strictEqual(context.newsIndexCache.data.information_list[0].announce_id, 2, 'timed-out refresh cannot publish later');
  context.newsIndexCache.data = { generated_at: 'same', information_list: [
    { announce_id: 2, title: 'new' }, { announce_id: 'lantis-new', title: 'new CD' }
  ] };
  images[0].rows[0].image = 'cover.webp';
  images[0].callback();
  assert.strictEqual(context.newsIndexCache.data.information_list.length, 2, 'image backfill retains newly merged CD news');
  assert.strictEqual(context.newsIndexCache.data.information_list[0].image, 'cover.webp');
  const first = {}, second = {};
  context.handleNewsIndex(first);
  context.transCache.new = '新标题';
  context.handleNewsIndex(second);
  assert.notStrictEqual(first.options.etag, second.options.etag, 'ETag changes when translation changes');

  let requestCount = 0;
  const sensitive = vm.createContext({
    crypto, BAIDU_APPID: 'test', BAIDU_SECRET: 'test', sanitizeSensitive: (text) => text,
    https: { get(url, options, callback) {
      requestCount += 1;
      const request = new EventEmitter();
      request.setTimeout = () => request;
      queueMicrotask(() => {
        const response = new EventEmitter(); callback(response);
        response.emit('data', JSON.stringify({ error_code: '20003' })); response.emit('end');
      });
      return request;
    } }
  });
  vm.runInContext(section('function translateOne(', 'async function pumpTranslations()'), sensitive);
  await sensitive.translateOne('拒绝', 0);
  assert.strictEqual(requestCount, 2, 'sensitive-word fallback is bounded');

  let pendingTimeout;
  const translation = vm.createContext({
    crypto, BAIDU_APPID: 'test', BAIDU_SECRET: 'test', transCache: {}, transDirty: false,
    saveTransCache() {}, hasCjk: () => true,
    https: { get() {
      const request = new EventEmitter();
      request.setTimeout = (unused, callback) => { pendingTimeout = callback.bind(request); return request; };
      request.destroy = () => request.emit('error', new Error('timeout'));
      return request;
    } }
  });
  vm.runInContext(section('function translateBatchLines(', 'function httpsGet('), translation);
  let callbacks = 0;
  translation.translateBatchLines(['原文'], () => { callbacks += 1; });
  pendingTimeout();
  assert.strictEqual(callbacks, 1, 'timeout plus error invokes translation callback once');
  translation.translateBatchLines = (lines, callback) => callback(null);
  translation.translateOne = async () => '';
  let result;
  translation.translateHtmlMessage('<p>原文</p>', (value) => { result = value; });
  await tick();
  assert.strictEqual(result, '<p>原文</p>');
  assert.strictEqual(Object.keys(translation.transCache).length, 0, 'failed translations remain retryable');
  translation.translateBatchLines = (lines, callback) => callback(['译文']);
  translation.translateHtmlMessage('<p>原文</p>', (value) => { result = value; });
  assert.strictEqual(result, '<p>译文</p>');
  assert.strictEqual(Object.keys(translation.transCache).length, 1);
  console.log('server regressions passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
