'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const { EventEmitter } = require('events');
// Deterministic upstream failures exercise the shipped service functions with
// fixture dependencies. The browser/API tests exercise complete composition.
const sources = ['server-news', 'server-translation', 'server-transport'].map(name =>
  fs.readFileSync(require.resolve('./' + name), 'utf8'));
const declaration = (source, requested) => {
  const name = requested.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (!name) return -1;
  const match = source.match(new RegExp('(?:async\\s+)?function\\s+' + name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '\\s*\\('));
  return match ? match.index : -1;
};
const section = (start, end) => {
  const source = sources.find(text => text.includes(start));
  if (!source) throw new Error('Missing service function: ' + start);
  const begin = declaration(source, start);
  if (begin < 0) throw new Error('Missing service function: ' + start);
  const finish = declaration(source, end);
  const lifecycle = source.slice(begin).search(/\n\s*function start\(\)/);
  const boundary = lifecycle < 0 ? source.lastIndexOf('\n  return {') : begin + lifecycle;
  return source.slice(begin, finish < 0 ? boundary : finish).replace(/\bdeps\s*\./g, '');
};
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const { mergeNews } = require('./news-content');
const { createTerms } = require('./translation-terms');
const emptyTerms = createTerms([{ ja: 'トウカイテイオー', zh: '东海帝王' }]);

async function main() {
  const headlines = vm.createContext({});
  vm.runInContext(section('function cleanHtml(', 'function extractInnercon('), headlines);
  assert.strictEqual(headlines.cleanHtml('A &#038; B &#x1F40E;'), 'A & B 🐎', 'online Lantis headings decode numeric entities like the archive parser');
  const timers = [];
  const pages = [];
  const images = [];
  const saved = [];
  const context = vm.createContext({
    newsRefreshPromise: null, newsRefreshRevision: 0, indexRepresentation: null,
    archiveSignature: () => String(Object.keys(context.transCache).length),
    newsIndexCache: { at: 0, data: { information_list: [] } }, transCache: {},
    mergeNews, newsContent: { isRemoved: () => false, apply: (item) => ({ ...item, title_zh: item.title_zh || context.transCache[item.title] || '' }), title: () => '' },
    NEWS_MAX_CONC: 3, NEWS_TTL: 900000, NO_AUTO_CRAWL: true,
    setTimeout(callback) { timers.push(callback); return timers.length; }, clearTimeout() {},
    fetchNewsPageRetry(page, callback) { pages.push(callback); },
    persistNewsSnapshot(data) { saved.push(data); },
    mergeLantis() {}, backfillNewsImages(rows, callback) { images.push({ rows, callback }); },
    translateTitle() {}, reloadNewsSnapshotIfNewer() {}, reloadLantisIfNewer() {},
    archive: { request: async () => ({}) },
    console: { log() {}, error() {} }, crypto, require,
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
  await context.handleNewsIndex(first);
  context.transCache.new = '新标题';
  await context.handleNewsIndex(second);
  assert.notStrictEqual(first.options.etag, second.options.etag, 'ETag changes when translation changes');

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

  let finishTitle, titleCalls = 0;
  const titleQueue = vm.createContext({
    titlePending: new Map(), transQueue: [], transRunning: false,
    AbortController, BAIDU_APPID: 'test', BAIDU_SECRET: 'test',
    translationKey: text => text, currentTerms: () => ({normalize: value => value}),
    newsContent: {title: () => ''}, console: {error() {}},
    setTimeout(callback) { queueMicrotask(callback); },
    translations: {set() { throw new Error('cache write failed'); }},
    translateOne() { titleCalls++; return new Promise(resolve => { finishTitle = resolve; }); }
  });
  vm.runInContext(section('async function pumpTranslations()', 'function hasCjk('), titleQueue);
  const titleResults = [];
  titleQueue.translateTitle('same', value => titleResults.push(value));
  titleQueue.translateTitle('same', value => titleResults.push(value));
  assert.strictEqual(titleCalls, 1, 'in-flight titles share one provider request');
  finishTitle('译文');
  await tick();
  assert.deepStrictEqual(titleResults, ['译文', '译文']);
  assert.strictEqual(titleQueue.transRunning, false, 'cache failures do not strand the title queue');
  titleQueue.translateTitle('next', () => {});
  assert.strictEqual(titleCalls, 2, 'the next title still runs after a cache failure');
  finishTitle('下一个');
  await tick();

  const translation = vm.createContext({
    crypto, Buffer, require, setTimeout, BAIDU_APPID: 'test', BAIDU_SECRET: 'test', transCache: {},
    hasCjk: () => true,
    currentTerms: () => emptyTerms, translationKey: (source) => source,
    cachedTranslation: () => '',
    translationKeyWithTerms: (source) => source,
    newsContent: { message: () => '' },
    fetchTranslation: () => Promise.reject(new Error('timeout')),
    https: { get() {
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.destroy = () => request.emit('error', new Error('timeout'));
      return request;
    } }
  });
  translation.translations = { get: (key) => translation.transCache[key], set: (key, value) => { translation.transCache[key] = value; }, setMany: entries => Object.assign(translation.transCache, entries) };
  vm.runInContext(section('function translateBatchLines(', 'function httpsGet('), translation);
  let callbacks = 0;
  translation.translateBatchLines(['原文'], () => { callbacks += 1; });
  await tick();
  assert.strictEqual(callbacks, 1, 'timeout plus error invokes translation callback once');
  translation.translateBatchLines = (lines, callback) => callback(null);
  translation.translateOne = async () => '';
  let result;
  await translation.translateHtmlMessage('<p>原文</p>', (value) => { result = value; });
  await tick();
  assert.strictEqual(result, '<p>原文</p>', 'a failed translation falls back to the original text instead of dropping the article');
  assert.strictEqual(Object.keys(translation.transCache).length, 0, 'fallback results are not cached so translations remain retryable');
  translation.translateBatchLines = (lines, callback) => callback(['译文']);
  await translation.translateHtmlMessage('<p>原文</p>', (value) => { result = value; });
  assert.strictEqual(result, '<p>译文</p>');
  assert.strictEqual(Object.keys(translation.transCache).filter(key => key.startsWith('msg_')).length, 1);
  assert.strictEqual(translation.transCache['fragment:原文'], '译文');

  translation.fetchTranslation = async (text) => ({ trans_result: text.split('\n').map((src) => ({ src, dst: src.replace(/原文/g, '译文') })) });
  vm.runInContext(section('function translateBatchLines(', 'function translateHtmlMessage('), translation);
  let lines, linesDirty;
  await translation.translateHtmlMessage('<p>原文\n原文</p>', (value) => { result = value; });
  await tick();
  assert.strictEqual(result, '<p>译文 译文</p>', 'HTML whitespace does not create extra API translation rows');
  translation.fetchTranslation = async (text) => ({ trans_result: [{ src: text, dst: '★★★★译文1500' }] });
  translation.translateBatchLines(['★★★原文1500'], (value) => { lines = value; });
  await tick();
  assert.strictEqual(lines[0], '★★★译文1500', 'a translated rating retains its original star count');
  translation.fetchTranslation = async (text) => ({ trans_result: [{ src: text, dst: '译文150' }] });
  translation.translateBatchLines(['原文1500'], (value, dirty) => { lines = value; linesDirty = dirty; });
  await tick();
  assert.strictEqual(lines[0], '原文1500', 'a changed amount keeps the original line');
  assert.strictEqual(linesDirty, true);
  translation.fetchTranslation = async (text) => ({ trans_result: [{ src: text, dst: '票价：￥2000（含10%税）' }] });
  translation.translateBatchLines(['チケット料金：￥2,000 (10%税込)'], (value) => { lines = value; });
  await tick();
  assert.strictEqual(lines[0], '票价：￥2000（含10%税）', 'thousands separators are formatting, not a changed amount');
  translation.fetchTranslation = async (text) => ({ trans_result: [{ src: text, dst: '【9/2817:50追记】' }] });
  translation.translateBatchLines(['【9/28 17:50追記】'], (value) => { lines = value; });
  await tick();
  assert.strictEqual(lines[0], '【9/2817:50追记】', 'merged date-time spacing keeps the same digits in order');
  translation.fetchTranslation = async (text) => ({ trans_result: [{ src: text, dst: '开场12：00' }] });
  translation.translateBatchLines(['開場12:00'], (value) => { lines = value; });
  await tick();
  assert.strictEqual(lines[0], '开场12：00', 'full-width colons are formatting, not a changed time');
  for (const [source, destination] of [['1.5倍', '15倍'], ['開場12:30', '开场1:23:0'], ['開催します', '開催します']]) {
    translation.fetchTranslation = async (text) => ({ trans_result: [{ src: text, dst: destination }] });
    translation.translateBatchLines([source], (value, dirty) => { lines = value; linesDirty = dirty; });
    await tick();
    assert.strictEqual(lines[0], source);
    assert.strictEqual(linesDirty, true);
  }
  translation.translateBatchLines(['原文'.repeat(1000)], (value, dirty) => { lines = value; linesDirty = dirty; });
  assert.strictEqual(lines[0], '原文'.repeat(1000), 'query length is checked before sending and oversized lines keep the original');
  assert.strictEqual(linesDirty, true);

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
  assert.strictEqual(articleResult.status, 200, 'a failed body falls back to the original text');
  assert.strictEqual(articleResult.data.detail.message_zh, '原文');
  completedArticles.translateArticle({ title: 'ニュース', message: '' }, null, (status, data) => { articleResult = { status, data }; });
  titleDone('ニュース');
  assert.strictEqual(articleResult.status, 200, 'an untranslated title falls back to the original');
  assert.strictEqual(articleResult.data.detail.title_zh, '');
  console.log('server regressions passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
