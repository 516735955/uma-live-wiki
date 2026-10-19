'use strict';
const assert = require('assert');
const path = require('path');
const {AnimeStore} = require('./anime-store');
const {CatalogStore} = require('./catalog-store');
const {HorseStore} = require('./horse-store');

(async () => {
  const directory = path.join(__dirname, '..', 'data');
  const anime = new AnimeStore(directory), catalog = new CatalogStore(directory), horses = new HorseStore(directory);
  const unit = await anime.response('unit', 'anime-s1-e01');
  assert(unit.units.find(row => row.id === 'anime-s1-e01').summary_zh);
  assert(unit.staff.every(row => !row.unit_id || row.unit_id === 'anime-s1-e01'));
  assert(unit.units.length > 1, 'adjacent episodes remain navigable');
  const entity = await anime.response('entity', 'voice_actor:va-0001');
  assert(entity.relations.every(row => row.voice_actor_id === 'va-0001' || row.target_id === 'va-0001'));
  const source = await anime.load();
  const cueCreator = source.units.flatMap(unit => (unit.music_cues || []).flatMap(cue =>
    (cue.credits || []).flatMap(credit => credit.creator_ids || [])))[0];
  assert(cueCreator, 'fixture includes a creator credited in episode music');
  const creatorCues = await anime.response('entity', 'creator:' + cueCreator);
  assert(creatorCues.units.some(unit => unit.music_cues?.some(cue =>
    cue.credits.some(credit => credit.creator_ids?.includes(cueCreator)))), 'direct creator responses include music cue credits');
  const horse = await horses.detail('specialweek');
  assert(horse.horse.races.length > 0, 'entity projection retains the complete career');
  assert(Buffer.byteLength(JSON.stringify(horse)) < 100 * 1024);
  const first = await horses.index(new URLSearchParams('page=1'));
  const second = await horses.index(new URLSearchParams('page=2'));
  assert(first.total > 30 && second.page === 2 && first.items[0].id !== second.items[0].id);
  assert.strictEqual(await horses.detail('not-a-horse'), null);
  assert.strictEqual(await horses.detail('__proto__'), null);
  assert.strictEqual(await horses.detail('constructor'), null);
  for (let index = 0; index < 300; index++) await anime.response('entity', 'character:absent-' + index);
  assert(anime.responses.size <= 256, 'empty arbitrary entities cannot grow the response cache');
  const snapshot = await catalog.get();
  const rows = Array.from({length:601}, (_, index) => ({id:'album-fixture-'+index,name:'Fixture '+String(index).padStart(4,'0'),type:index%2?'单曲':'专辑',work:'other',release:'2026-10-14'}));
  catalog.get = async () => ({...snapshot,albums:rows,albumRows:rows.map(data => ({data,summary:data}))});
  const page = await catalog.albums(new URLSearchParams('page=21&page_size=30'));
  assert.strictEqual(page.items[0].id, 'album-fixture-600', 'records after 500 remain reachable');
  assert.strictEqual(page.total, 601);
  const filtered = await catalog.albums(new URLSearchParams('type=单曲&page_size=30'));
  assert.strictEqual(filtered.total, 300);
  assert(filtered.types.includes('专辑') && filtered.types.includes('单曲'), 'filter metadata covers the entire source');
  console.log('scoped anime/horse details and albums beyond 500 passed');
})().catch(error => { console.error(error); process.exitCode=1; });
