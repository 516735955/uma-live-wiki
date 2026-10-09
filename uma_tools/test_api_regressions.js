'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
let now = 0, requests = 0;
const context = vm.createContext({
  window: {}, URLSearchParams, AbortController, setTimeout, clearTimeout, Date: { now: () => now },
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
  const replies = [];
  context.fetch = () => new Promise((resolve) => replies.push(resolve));
  const old = api.request('/race', { fresh: true });
  const latest = api.request('/race', { fresh: true });
  replies[1]({ ok: true, json: async () => ({ version: 'latest' }) });
  await latest;
  replies[0]({ ok: true, json: async () => ({ version: 'old' }) });
  await old;
  assert.strictEqual((await api.request('/race')).version, 'latest', 'late refresh cannot regress the shared cache');
  const { scoreAlbum, buildCandidate } = require('./scrape');
  assert.strictEqual(scoreAlbum('ANIMATION DERBY Season 2 Vol.1', 'ANIMATION DERBY Season 3 Vol.1'), 0);
  assert.strictEqual(scoreAlbum('WINNING MELODY', 'WINNING MELODY Remix'), 0);
  assert.strictEqual(buildCandidate({}, { tracks: [{ name: 'trial', id: 1, playable: false }] }).songs[0].url, '');
  console.log('API and import regressions passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
