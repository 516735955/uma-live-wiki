'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AnimeStore } = require('./anime-store');
const { create } = require('./anime-loader');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const original = JSON.parse(fs.readFileSync(path.join(dataDir, 'anime_catalog.json'), 'utf8'));
  const store = new AnimeStore(dataDir);
  const calls = [];
  const client = create(async url => {
    calls.push(url);
    const params = new URL(url, 'http://localhost').searchParams;
    return store.response(params.get('scope'), params.get('id'));
  });
  const directory = await client.load();
  assert.strictEqual(directory.works.length, original.works.length);
  assert.strictEqual(directory.units.length, original.units.length);
  assert.strictEqual(directory.staff.length, 0, 'directory never downloads staff credits');
  assert(Buffer.byteLength(JSON.stringify(directory)) < Buffer.byteLength(JSON.stringify(original)) / 100);
  await client.load();
  assert.strictEqual(calls.length, 1, 'revisiting a loaded scope reuses its response');
  await client.load('index', '', true);
  assert.strictEqual(calls.length, 2, 'explicit retry bypasses a loaded scope');
  const firstId = original.works[0].id;
  await Promise.all([client.load('work', firstId), client.load('work', firstId)]);
  assert.strictEqual(calls.length, 3, 'concurrent work requests share one load');
  const firstWork = await client.load('work', firstId);
  assert.strictEqual(firstWork.staff.length, original.staff.filter(row => row.work_id === firstId).length);
  const imageUnit = original.units.find(unit => unit.work_id === firstId && unit.stills.length);
  if (imageUnit) assert.deepStrictEqual(firstWork.units.find(unit => unit.id === imageUnit.id).stills,
    JSON.parse(JSON.stringify(imageUnit.stills)).map(row => {
      if (typeof row !== 'object') return row;
      const { source_refs, source_ref, ...display } = row;
      return display;
    }));
  await client.load('graph');
  let merged;
  for (const work of original.works) merged = await client.load('work', work.id);
  assert.strictEqual(merged.staff.length, original.staff.length, 'all work scopes preserve every credit, including duplicates');
  assert.strictEqual(merged.relations.length, original.relations.length);
  assert.strictEqual(merged.watch_resources.length, original.watch_resources.length);
  for (const row of merged.staff) {
    const accepted = original.staff[row._row];
    for (const field of ['work_id', 'unit_id', 'person_id', 'role', 'group', 'name', 'institutions', 'order', 'edition', 'editions']) {
      assert.deepStrictEqual(row[field], accepted[field], 'scoped credit retains ' + field);
    }
  }
  const withPeople = await client.load('people');
  assert.strictEqual(withPeople.people.length, original.people.length);
  const aliasPerson = original.people.find(person => (person.alias_ids || []).length);
  assert(aliasPerson);
  const legacy = await store.response('person', aliasPerson.alias_ids[0]);
  assert.strictEqual(legacy.people[0].id, aliasPerson.id, 'legacy person IDs use the canonical identity');
  assert.strictEqual(legacy.staff.length, original.staff.filter(row => row.person_id === aliasPerson.id).length);
  assert.strictEqual(await store.response('person', 'missing-person'), null);
  assert.strictEqual(await store.response('work', 'missing-work'), null);
  assert(!JSON.stringify(await store.response('work', firstId)).includes('source_refs'), 'internal evidence stays out of display responses');

  let fail = true;
  const retry = create(async () => {
    if (fail) { fail = false; throw new Error('offline'); }
    return store.response('index');
  });
  await assert.rejects(retry.load(), /offline/);
  assert.strictEqual((await retry.load()).works.length, original.works.length);

  const old = deferred();
  let freshCalls = 0;
  const hot = create(async (url, options) => {
    if (url.includes('scope=people')) {
      if (!options.fresh) return old.promise;
      freshCalls += 1;
      return { ...(await store.response('people')), build_id: 'new' };
    }
    if (url.includes('scope=work')) return { ...(await store.response('work', firstId)), build_id: 'new' };
    return { ...(await store.response('index')), build_id: 'old' };
  });
  await hot.load('index');
  const oldPeople = hot.load('people');
  await Promise.resolve();
  await hot.load('work', firstId);
  old.resolve({ ...(await store.response('people')), build_id: 'old' });
  const after = await oldPeople;
  assert.strictEqual(after.build_id, 'new', 'late old responses cannot replace a refreshed build');
  assert.strictEqual(freshCalls, 1, 'late old responses retry against fresh data');
  assert.strictEqual(after.staff.length, firstWork.staff.length, 'refreshed detail survives a late request');

  const coldOldIndex = deferred();
  const cold = create(async (url, options) => {
    if (url.includes('scope=index') && !options.fresh) return coldOldIndex.promise;
    const payload = await store.response(url.includes('scope=index') ? 'index' : 'work', firstId);
    return { ...payload, build_id: 'new' };
  });
  const coldIndexing = cold.load('index');
  await cold.load('work', firstId);
  coldOldIndex.resolve({ ...(await store.response('index')), build_id: 'old' });
  const coldResult = await coldIndexing;
  assert.strictEqual(coldResult.build_id, 'new', 'a late first-load index cannot roll back a newer detail');
  assert.strictEqual(coldResult.staff.length, firstWork.staff.length);

  const lateIndex = deferred();
  const late = create(async url => url.includes('scope=index') ? lateIndex.promise : store.response('work', firstId));
  const indexing = late.load('index');
  await late.load('work', firstId);
  lateIndex.resolve(await store.response('index'));
  const detailed = await indexing;
  assert.strictEqual(detailed.works.find(row => row.id === firstId).summary_zh,
    original.works.find(row => row.id === firstId).summary_zh, 'late summaries do not erase full details');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-anime-load-'));
  try {
    const fixtureFile = path.join(temporary, 'anime_catalog.json');
    fs.writeFileSync(fixtureFile, JSON.stringify(original));
    const local = new AnimeStore(temporary);
    await local.response('index');
    fs.writeFileSync(fixtureFile, '{');
    assert.strictEqual((await local.response('index')).build_id, original.build_id,
      'a corrupt refresh keeps the last complete catalog available');
    assert(local.lastError instanceof SyntaxError, 'a corrupt refresh still records the parsing failure');
    fs.writeFileSync(fixtureFile, JSON.stringify({ ...original, build_id: 'changed-build' }));
    assert.strictEqual((await local.response('index')).build_id, 'changed-build', 'failed refresh can recover without a server restart');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  console.log('Anime scoped loading: complete data parity, legacy IDs, request reuse, retry and refresh passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
