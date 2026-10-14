'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { imageStore } = require('./news-images');
const { TranslationCache } = require('./translation-cache');
const { createArticleCache } = require('./article-cache');
const { translationFactsMatch } = require('./translation-facts');
const { AnimeStore } = require('./anime-store');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-recovery-'));
  const get = https.get, now = Date.now;
  let clock = now(), offline = false, bytes = Buffer.from('first');
  Date.now = () => clock;
  https.get = (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = error => { request.emit('error', error); request.emit('close'); };
    setImmediate(() => {
      if (offline) return request.destroy(new Error('offline'));
      const response = new EventEmitter();
      response.statusCode = 200; response.headers = {'content-type':'image/webp'};
      callback(response); response.emit('data', bytes); response.emit('end'); request.emit('close');
    });
    return request;
  };
  try {
    const load = imageStore(path.join(directory, 'images'));
    const url = 'https://prd-info-umamusume.akamaized.net/announce/1/Header/test.webp';
    assert.strictEqual((await load(url)).bytes.toString(), 'first');
    const file = path.join(directory, 'images', fs.readdirSync(path.join(directory, 'images'))[0]);
    fs.utimesSync(file, new Date(0), new Date(0));
    offline = true;
    assert.strictEqual((await load(url)).bytes.toString(), 'first', 'stale preview survives source failure');
    await new Promise(resolve => setTimeout(resolve, 20));
    clock += 61000; offline = false; bytes = Buffer.from('updated');
    await load(url);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.strictEqual((await load(url)).bytes.toString(), 'updated', 'source recovery replaces actual cache content');

    const cacheFile = path.join(directory, 'translations.json');
    fs.writeFileSync(cacheFile, '{"accepted":"译文"}');
    const translations = new TranslationCache(cacheFile);
    fs.writeFileSync(cacheFile, '{broken');
    fs.utimesSync(cacheFile, new Date(clock), new Date(clock));
    assert.strictEqual(translations.get('accepted'), '译文');
    translations.set('recovered', '恢复');
    assert.strictEqual(JSON.parse(fs.readFileSync(cacheFile)).accepted, '译文');

    let translated, loaded = 0, article;
    const articles = createArticleCache({ send: (res, status, data) => {res.data=structuredClone(data);}, applyEdits: data => data,
      translate: (detail, signal, done) => { translated = value => done(200, {detail:{...detail,message_zh:value,translation_state:value==='完成'?'complete':'partial'}}); }
    });
    const source = (signal, done) => { loaded++; done(200, {detail:{title:'ニュース',message:'原文'}}); };
    article = new EventEmitter(); articles.serve('one', article, source, true);
    assert.strictEqual(article.data.detail.message, '原文', 'readable article does not wait for translation');
    translated('部分'); clock += 31000;
    article = new EventEmitter(); articles.serve('one', article, source, true);
    assert.strictEqual(loaded, 1, 'partial translation retries without refetching the original');
    translated('完成');
    article = new EventEmitter(); articles.serve('one', article, source, true);
    assert.strictEqual(article.data.detail.message_zh, '完成');

    assert(!translationFactsMatch('1.5倍', '15倍'));
    assert(!translationFactsMatch('12元，3人', '1元，23人'));
    assert(translationFactsMatch('9/28 17:50', '9/2817：50'));
    const animeFile = path.join(directory, 'anime_catalog.json');
    const valid = {build_id:'one',works:[],units:[],people:[],staff:[],relations:[],watch_resources:[]};
    fs.writeFileSync(animeFile, JSON.stringify(valid));
    const anime = new AnimeStore(directory);
    await anime.load();
    fs.writeFileSync(animeFile, '{bad');
    assert.strictEqual((await anime.load()).build_id, 'one');
    fs.writeFileSync(animeFile, JSON.stringify({...valid,build_id:'recovered'}));
    assert.strictEqual((await anime.load()).build_id, 'recovered');
  } finally {
    https.get = get; Date.now = now;
    fs.rmSync(directory, {recursive:true,force:true});
  }
  console.log('resource timeouts, stale-cache recovery, article progress and snapshot recovery passed');
}
main().catch(error => {console.error(error);process.exitCode=1;});
