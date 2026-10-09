'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const { mergeNews } = require('./news-content');
const { createTerms } = require('./translation-terms');
const emptyTerms = createTerms([{ ja: 'トウカイテイオー', zh: '东海帝王' }]);

async function main() {
  const timers = [];
  const pages = [];
  const images = [];
  const saved = [];
  const context = vm.createContext({
    newsRefreshPromise: null, newsRefreshRevision: 0,
    newsIndexCache: { at: 0, data: { information_list: [] } }, transCache: {},
    mergeNews, newsContent: { apply: (item) => ({ ...item, title_zh: item.title_zh || context.transCache[item.title] || '' }), title: () => '' },
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
  context.newsIndexCache.data = { information_list: [{ announce_id: 2, title: 'new', image: 'manual.webp', title_zh: '人工译文' }] };
  const replacement = context.refreshNewsIndex();
  pages[1](null, { total_page_count: 1, information_list: [{ announce_id: 2, title: 'new', post_at: '2026-10-08' }] });
  await replacement;
  pages[0](null, { total_page_count: 1, information_list: [{ announce_id: 1, title: 'expired' }] });
  assert.strictEqual(context.newsIndexCache.data.information_list[0].announce_id, 2, 'timed-out refresh cannot publish later');
  assert.strictEqual(context.newsIndexCache.data.information_list[0].image, 'manual.webp', 'refresh preserves an enriched image');
  assert.strictEqual(context.newsIndexCache.data.information_list[0].title_zh, '人工译文', 'unchanged titles preserve translations');
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

  let manualTitle = '', manualMessage = '';
  const articles = vm.createContext({ AbortController, Date, Map, Set, crypto,
    newsContent: {
      apply: (item) => ({ ...item, title_zh: manualTitle || item.title_zh }),
      message: () => manualMessage
    },
    sendJson(response, status, body) { response.status = status; response.body = body; }
  });
  vm.runInContext(section('const articleCache =', 'function handleNewsDetail('), articles);
  const subscriberA = new EventEmitter(), subscriberB = new EventEmitter();
  let articleLoads = 0, complete, signal;
  const load = (token, done) => { articleLoads += 1; signal = token; complete = done; };
  articles.serveArticle('one', subscriberA, load);
  articles.serveArticle('one', subscriberB, load);
  assert.strictEqual(articleLoads, 1, 'concurrent readers share an upstream article request');
  subscriberA.emit('close');
  assert.strictEqual(signal.aborted, false, 'one closed reader does not cancel another');
  complete(200, { detail: { title: 'article', message: '<p>原文</p>' } });
  assert.strictEqual(subscriberB.status, 200);
  articles.serveArticle('one', new EventEmitter(), load);
  assert.strictEqual(articleLoads, 1, 'a completed article is served from cache');
  manualTitle = '人工订正标题';
  manualMessage = '<p>人工订正正文</p>';
  const updated = new EventEmitter();
  articles.serveArticle('one', updated, load);
  assert.strictEqual(updated.body.detail.title_zh, manualTitle);
  assert.strictEqual(updated.body.detail.message_zh, manualMessage, 'cached articles apply current manual corrections');
  const cancelled = new EventEmitter();
  articles.serveArticle('two', cancelled, load);
  cancelled.emit('close');
  assert.strictEqual(signal.aborted, true, 'the last closed reader cancels upstream work');
  articles.serveArticle('two', new EventEmitter(), load);
  assert.strictEqual(articleLoads, 3, 'cancelled article requests remain retryable');

  let requestCount = 0;
  const sensitive = vm.createContext({
    crypto, BAIDU_APPID: 'test', BAIDU_SECRET: 'test',
    currentTerms: () => emptyTerms,
    fetchTranslation: async () => { requestCount += 1; return { error_code: '20003' }; },
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
  assert.strictEqual(requestCount, 1, 'rejected translations are not split into context-free fragments');

  const translation = vm.createContext({
    crypto, Buffer, setTimeout, BAIDU_APPID: 'test', BAIDU_SECRET: 'test', transCache: {},
    hasCjk: () => true,
    currentTerms: () => emptyTerms, translationKey: (source) => source,
    newsContent: { message: () => '' },
    fetchTranslation: () => Promise.reject(new Error('timeout')),
    https: { get() {
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.destroy = () => request.emit('error', new Error('timeout'));
      return request;
    } }
  });
  translation.translations = { get: (key) => translation.transCache[key], set: (key, value) => { translation.transCache[key] = value; } };
  vm.runInContext(section('function translateBatchLines(', 'function httpsGet('), translation);
  let callbacks = 0;
  translation.translateBatchLines(['原文'], () => { callbacks += 1; });
  await tick();
  assert.strictEqual(callbacks, 1, 'timeout plus error invokes translation callback once');
  translation.translateBatchLines = (lines, callback) => callback(null);
  translation.translateOne = async () => '';
  let result;
  translation.translateHtmlMessage('<p>原文</p>', (value) => { result = value; });
  await tick();
  assert.strictEqual(result, '', 'a failed translation is not presented as a Japanese or partially translated success');
  assert.strictEqual(Object.keys(translation.transCache).length, 0, 'failed translations remain retryable');
  translation.translateBatchLines = (lines, callback) => callback(['译文']);
  translation.translateHtmlMessage('<p>原文</p>', (value) => { result = value; });
  assert.strictEqual(result, '<p>译文</p>');
  assert.strictEqual(Object.keys(translation.transCache).length, 1);

  translation.fetchTranslation = async (text) => ({ trans_result: text.split('\n').map((src) => ({ src, dst: src.replace(/原文/g, '译文') })) });
  vm.runInContext(section('function translateBatchLines(', 'function translateHtmlMessage('), translation);
  let lines;
  translation.translateHtmlMessage('<p>原文\n原文</p>', (value) => { result = value; });
  await tick();
  assert.strictEqual(result, '<p>译文 译文</p>', 'HTML whitespace does not create extra API translation rows');
  translation.fetchTranslation = async (text) => ({ trans_result: [{ src: text, dst: '★★★★译文1500' }] });
  translation.translateBatchLines(['★★★原文1500'], (value) => { lines = value; });
  await tick();
  assert.strictEqual(lines[0], '★★★译文1500', 'a translated rating retains its original star count');
  translation.fetchTranslation = async (text) => ({ trans_result: [{ src: text, dst: '译文150' }] });
  translation.translateBatchLines(['原文1500'], (value) => { lines = value; });
  await tick();
  assert.strictEqual(lines, null, 'a changed amount is rejected');
  translation.translateBatchLines(['原文'.repeat(1000)], (value) => { lines = value; });
  assert.strictEqual(lines, null, 'query length is checked before sending');

  let titleDone, bodyDone, articleResult;
  const completedArticles = vm.createContext({
    newsContent: { apply: (detail) => detail },
    translateTitle: (text, done) => { titleDone = done; },
    translateHtmlMessage: (text, done) => { bodyDone = done; }
  });
  vm.runInContext(section('function translateArticle(', 'function httpsGet('), completedArticles);
  completedArticles.translateArticle({ title: 'ニュース', message: '原文' }, null, (status, data) => { articleResult = { status, data }; });
  bodyDone('译文');
  assert.strictEqual(articleResult, undefined, 'an article waits for both title and body');
  titleDone('新闻');
  assert.strictEqual(articleResult.status, 200);
  assert.strictEqual(articleResult.data.detail.message_zh, '译文');
  completedArticles.translateArticle({ title: 'ニュース', message: '原文' }, null, (status, data) => { articleResult = { status, data }; });
  titleDone('新闻'); bodyDone('');
  assert.strictEqual(articleResult.status, 503, 'failed translation remains an explicit retryable failure');
  console.log('server regressions passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
