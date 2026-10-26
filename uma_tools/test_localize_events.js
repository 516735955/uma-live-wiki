'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {run} = require('./localize_events');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-event-translations-'));
  const write = (name, value) => { const p = path.join(root, 'data', name); fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(value)); };
  try {
    fs.mkdirSync(path.join(root, 'uma_tools'), {recursive:true});
    fs.copyFileSync(path.join(__dirname, 'translation-glossary.json'), path.join(root, 'uma_tools/translation-glossary.json'));
    fs.mkdirSync(path.join(root, 'data'), {recursive:true});
    fs.writeFileSync(path.join(root, 'data/character_index_data.js'), 'window.CHAR_INDEX = [];');
    write('anime/works.json', {works:[]});
    write('voice_actor_profiles.json', {voice_actors:[]});
    write('events_catalog.json', {series:[], events:[
      {id:'reviewed', title_ja:'番組の紹介', summary_ja:'紹介です'},
      {id:'source', title:'中文标题', summary:'保留人工说明和备注。'},
      {id:'cached', title_ja:'過去の番組', summary_ja:'説明です'},
      {id:'changed', title:'已改原文', summary_ja:'変更された新しい説明'},
    ]});
    write('events/localizations.json', {records:{reviewed:{title_ja:'番組の紹介', title_zh:'人工标题', summary_ja:'紹介です', summary_zh:'人工介绍', translator:'assistant'}, changed:{summary_ja:'古い説明', summary_zh:'原人工修订说明', summary_translator:'assistant'}}});
    write('auto_update/event_localizations.json', {records:{cached:{title_ja:'過去の番組', title_zh:'已有标题', title_translator:'baidu', summary_ja:'説明です', summary_zh:'已有介绍', summary_translator:'baidu'}, changed:{summary_ja:'変更された新しい説明', summary_zh:'缓存机器改写', summary_translator:'baidu'}}});
    const first = await run(root, {noApi:true, rebuild:false});
    assert.equal(first.pending, 1);
    assert.equal(first.deferredOwner, 1);
    const records = JSON.parse(fs.readFileSync(path.join(root, 'data/auto_update/event_localizations.json'))).records;
    assert.equal(records.reviewed.title_zh, '人工标题');
    assert.equal(records.reviewed.summary_translator, 'assistant');
    assert.equal(records.source.summary_zh, '保留人工说明和备注。');
    assert.equal(records.source.summary_translator, 'source');
    assert.equal(records.cached.title_translator, 'baidu');
    assert.equal(records.changed.summary_zh, '原人工修订说明', 'a machine cache cannot replace the reviewed archive after source changes');
    assert.equal(records.changed.summary_ja, '古い説明', 'the retained translation stays bound to its original source');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/events/localizations.json'))).records.changed.summary_zh, '原人工修订说明');
    assert.equal((await run(root, {noApi:true, rebuild:false})).changed, 0);
    console.log('Event translation provenance, reviewed copy and offline cache replay passed.');
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
