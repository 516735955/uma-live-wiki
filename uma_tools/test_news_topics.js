'use strict';

const assert = require('assert');
const { createNewsTopics } = require('./news-topics');

async function main() {
  const event = { id: 'program-1', title: '第1回公式番組', kind: 'official_program', sessions: [],
    sources: [{ kind: 'official_announcement', url: 'https://umamusume.jp/news/detail?id=1' }],
    cast: [{ character_id: 'character-1', voice_actor_id: 'voice-1' }] };
  const base = { eventsDoc: { events: [] }, eventsById: new Map(), eventRows: [], parentForChild: new Map(),
    albumsById: new Map(), songsById: new Map(),
    charactersById: new Map([['character-1', { id: 'character-1', ja: '登場キャラ', zh: '登场角色' }]]),
    voicesDoc: { voice_actors: [{ id: 'voice-1', identity: { ja: '出演声優', zh: '出演声优' } }] } };
  let store = base;
  let topics = null;
  const detail = { title: '公式番組の放送が決定！', post_at: '2026-11-20 18:00:00', message: '<p>出演者発表！</p>' };
  const service = createNewsTopics({ DATA_DIR: __dirname, catalogStore: { get: async () => store },
    animeStore: { load: async () => anime }, newsContent: { isRemoved: () => false },
    archiveRequest: async (operation, args = {}) => {
      if (operation === 'topic_queue') return args.after || (topics !== null && !args.recheck) ? []
        : [{ key: 'official-1', cursor: 1, detail, text: '出演者発表！' }];
      if (operation === 'topic_complete') topics = args.rows[0].topics;
      if (operation === 'topic_records') return topics && Object.keys(topics).length ? { 'official-1': topics } : {};
    }, sendJson() {} });
  const anime = { works: [] };
  await service.update();
  assert.deepStrictEqual(await service.article('official-1'), []);
  store = { ...base, eventsDoc: { events: [event] }, eventsById: new Map([[event.id, event]]), eventRows: [{ data: event }] };
  await service.update();
  const result = await service.article('official-1');
  assert.deepStrictEqual(result.map(row => row.type).sort(), ['character', 'event', 'voice']);
  const first = await service.matchArticle('official-1', detail);
  assert.deepStrictEqual(first.event, ['program-1']);
  assert.deepStrictEqual(first.character, ['character-1']);
  assert.deepStrictEqual(first.voice, ['voice-1']);
  console.log('first-translation topics and late catalog relationship regressions passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
