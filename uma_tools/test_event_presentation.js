'use strict';
const assert = require('assert');
const { projectEvents } = require('./event-presentation');
const { createClassification } = require('./music-classification');

const sources = [1,2].map(n => ({ id:'source-'+n, title:'活动 第'+n+'回', date:'2026-01-01', kind:'onsite', image:'cover-'+n,
  summary:'本场简介'+n, cast:[{voice_actor_id:'actor-'+n}], character_ids:['character-'+n], sessions:[{id:'slot-'+n,label:'本公演',cast:[{voice_actor_id:'actor-'+n}],performances:[{song_id:'song',note:'保留注释'}]}], sources:[{url:'source-url-'+n}] }));
const original = JSON.stringify(sources);
const result = projectEvents(sources, [{id:'parent',kind:'onsite_group',title:'活动',summary:'总简介',members:[{event_id:'source-1',label:'第1回'},{event_id:'source-2',label:'第2回'}]}]);
assert.strictEqual(result.events.length,1);
assert.strictEqual(result.events[0].sessions.length,2);
assert.strictEqual(result.parentForChild.get('source-2').session_id,'slot-2');
assert.strictEqual(result.events[0].sessions[1].summary,'本场简介2');
assert.strictEqual(result.events[0].sessions[1].cast[0].voice_actor_id,'actor-2');
assert.strictEqual(result.events[0].sessions[1].performances[0].note,'保留注释');
assert.strictEqual(JSON.stringify(sources),original);
for (const kind of ['release_event', 'screening', 'recording_event', 'festival_program', 'online_series']) {
  assert.strictEqual(projectEvents(sources, [{id:'p',kind,title:'Parent',members:sources.map(e => ({event_id:e.id}))}]).events.length, 1, kind + ' remains one parent');
}
const mixed = projectEvents(sources.map((e,i) => ({...e, venue:'venue-'+i, schedule_status:i ? 'cancelled' : '', status_note:i ? '官方取消本场' : '', status_source_url:i ? 'https://example.com/cancel' : ''})), [{id:'mixed',kind:'onsite_group',title:'Mixed',members:sources.map(e => ({event_id:e.id}))}]).events[0];
assert.strictEqual(mixed.venue, '');
assert.strictEqual(mixed.schedule_status, 'partially_cancelled');
assert.strictEqual(mixed.sessions[1].status_note, '官方取消本场');
assert.strictEqual(mixed.sessions[1].venue, 'venue-1');
assert.strictEqual(mixed.sessions[0].status_note, '');
const classify = createClassification({relations:[{source_type:'anime_work',source_id:'anime-cinderella-gray',relation_type:'uses_song',target_type:'song',target_id:'s',version_id:'v',release_id:'a'}]},[],()=> 'other');
assert.deepStrictEqual(classify({name:'外部歌手独立单曲'},'a'),{works:['cinderella'],release_series:'other'});
console.log('event parent projection, source preservation and independent music classification passed');
