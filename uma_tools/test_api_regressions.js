'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
let now = 0, requests = 0;
const context = vm.createContext({
  window: {}, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout, Date: { now: () => now },
  fetch: async () => { requests += 1; return { ok: true, json: async () => ({ requests }) }; }
});
// Read cache size in the test context without exposing it in the application.
const source = fs.readFileSync(require.resolve('./app-api.js'), 'utf8').replace('function invalidate(prefix)', 'window.cacheSize = () => resolved.size; function invalidate(prefix)');
vm.runInContext(source, context);
(async () => {
  const api = context.window.UmaApi;
  await Promise.all([api.request('/same', { maxAge: 10 }), api.request('/same', { maxAge: 10 })]);
  assert.strictEqual(requests, 1);
  now = 11;
  await api.request('/different', { maxAge: 10 });
  assert.strictEqual(context.window.cacheSize(), 1, 'expired paths are removed rather than retained indefinitely');
  for (let index = 0; index < 100; index++) await api.request('/bounded/' + index);
  assert.strictEqual(context.window.cacheSize(), 64, 'complete responses have a capacity bound');
  context.fetch = async () => ({ok: true, json: async () => ({text:'x'.repeat(9 * 1024 * 1024)})});
  await api.request('/oversized');
  assert.strictEqual(context.window.cacheSize(), 64, 'oversized entries do not evict useful cached responses');
  const replies = [];
  context.fetch = () => new Promise((resolve) => replies.push(resolve));
  const old = api.request('/race', { fresh: true });
  const latest = api.request('/race', { fresh: true });
  replies[1]({ ok: true, json: async () => ({ version: 'latest' }) });
  await latest;
  replies[0]({ ok: true, json: async () => ({ version: 'old' }) });
  await old;
  assert.strictEqual((await api.request('/race')).version, 'latest', 'late refresh cannot regress the shared cache');
  const controller = new AbortController();
  const cancelled = api.request('/shared', { signal: controller.signal });
  const survivor = api.request('/shared');
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  replies[2]({ ok: true, json: async () => ({ shared: true }) });
  assert.strictEqual((await survivor).shared, true);
  const invalidated = api.request('/invalidate');
  api.invalidate('/invalidate');
  replies[3]({ ok: true, json: async () => ({ obsolete: true }) });
  await invalidated;
  const refreshed = api.request('/invalidate');
  assert.strictEqual(replies.length, 5, 'invalidation detaches pending cache writer');
  replies[4]({ ok: true, json: async () => ({ obsolete: false }) });
  await refreshed;
  const { scoreAlbum, buildCandidate, fetchJson, neteaseSearchAlbum } = require('./scrape');
  assert.strictEqual(scoreAlbum('ANIMATION DERBY Season 2 Vol.1', 'ANIMATION DERBY Season 3 Vol.1'), 0);
  assert.strictEqual(scoreAlbum('WINNING MELODY', 'WINNING MELODY Remix'), 0);
  assert.strictEqual(scoreAlbum('WINNING LIVE 01', 'WINNING LIVE 010'), 0);
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({status:429});
    await assert.rejects(fetchJson('https://example.test', {}, 1), /HTTP 429.*exhausted/);
    global.fetch = async () => ({status:200,json:async()=>({result:{albums:[{id:1,name:'WINNING LIVE 01'},{id:2,name:'WINNING LIVE 01'}]}})});
    assert.strictEqual((await neteaseSearchAlbum('WINNING LIVE 01')).best,null);
  } finally {global.fetch = originalFetch;}
  assert.strictEqual(buildCandidate({}, { tracks: [{ name: 'trial', id: 1, playable: false }] }).songs[0].url, '');
  const animeContext = vm.createContext({Date:{now:()=>now}, URLSearchParams});
  vm.runInContext(fs.readFileSync(require.resolve('./anime-loader'),'utf8'), animeContext);
  const loader = animeContext.UmaAnimeLoader.create(async url => {
    const query = new URL(url,'https://example.test').searchParams, id = query.get('id');
    return {scope:query.get('scope'),build_id:'one',works:[{id}],units:[],people:[],staff:[],relations:[],watch_resources:[]};
  });
  let assembled;
  for (let index=0; index<40; index++) assembled = await loader.load('work',String(index));
  assert.strictEqual(assembled.works.length,32,'anime response retention is bounded');
  now += 300001;
  assembled = await loader.load('work','new');
  assert.strictEqual(assembled.works.length,1,'expired anime responses leave the assembled catalog');
  const {today} = require('./business-date');
  assert.strictEqual(today(new Date('2026-10-16T15:59:59Z')),'2026-10-16');
  assert.strictEqual(today(new Date('2026-10-16T16:00:00Z')),'2026-10-17');
  console.log('API and import regressions passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
