'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { imageStore } = require('./news-images');
const { TranslationCache } = require('./translation-cache');
const { translationFactsMatch } = require('./translation-facts');
const { AnimeStore } = require('./anime-store');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-recovery-'));
  const get = https.get, now = Date.now;
  let clock = now(), offline = false, bytes = Buffer.from('first'), failedRequests = 0;
  async function until(check) {
    const deadline = now() + 5000;
    while (!(await check())) {
      if (now() >= deadline) throw new Error('cache recovery did not complete within 5 seconds');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  Date.now = () => clock;
  https.get = (url, options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = error => { request.emit('error', error); request.emit('close'); };
    setImmediate(() => {
      if (offline) { failedRequests++; return request.destroy(new Error('offline')); }
      const response = new EventEmitter();
      response.resume = () => {};
      response.statusCode = url.pathname.endsWith('/maxresdefault.jpg') ? 404 : 200;
      response.headers = {'content-type':'image/webp'};
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
    clock += 61000;
    offline = true;
    assert.strictEqual((await load(url)).bytes.toString(), 'first', 'stale preview survives source failure');
    await until(() => failedRequests === 1);
    clock += 61000; offline = false; bytes = Buffer.from('updated');
    await load(url);
    await until(async () => (await load(url)).bytes.toString() === 'updated');
    assert.strictEqual((await load(url)).bytes.toString(), 'updated', 'source recovery replaces actual cache content');
    const lazy = await load(url, {deferBytes:true});
    assert.strictEqual(lazy.bytes, undefined, 'preview lookup does not read the original bytes');
    assert.strictEqual((await lazy.read()).toString(), 'updated');
    const thumbnails = imageStore(path.join(directory, 'thumbnails'), {validateUrl:require('./media-url').remoteImage});
    assert.strictEqual((await thumbnails('https://i.ytimg.com/vi/example/maxresdefault.jpg')).bytes.toString(), 'updated', 'a video without max-resolution artwork uses its available standard thumbnail');

    const cacheFile = path.join(directory, 'translations.json');
    fs.writeFileSync(cacheFile, '{"accepted":"译文"}');
    const translations = new TranslationCache(cacheFile);
    fs.writeFileSync(cacheFile, '{broken');
    fs.utimesSync(cacheFile, new Date(clock), new Date(clock));
    assert.strictEqual(translations.get('accepted'), '译文');
    translations.set('recovered', '恢复');
    assert.strictEqual(JSON.parse(fs.readFileSync(cacheFile)).accepted, '译文');

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
  console.log('resource timeouts, stale-cache recovery and snapshot recovery passed');
}
main().catch(error => {console.error(error);process.exitCode=1;});
