'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { NewsArchive } = require('./news-archive');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-news-archive-'));
  let sourceCalls = 0, translationCalls = 0, service;
  const archive = new NewsArchive(directory);
  const lantisHtml = fs.readFileSync(path.join(__dirname, 'fixtures/lantis-article.html'), 'utf8');
  try {
    const source = { detail: { announce_id: 1, title: 'ニュース', message: '<p>ニュース本文</p>' } };
    await archive.request('put', { key: 'official-1', data: source, owner: 'assistant' });
    await archive.request('translate', { key: 'official-1', revision: 1, translator: 'assistant',
      detail: { ...source.detail, title_zh: '新闻', message_zh: '<p>新闻正文</p>' } });
    const lantis = { detail: { announce_id: 'lantis-2', title: '発売ニュース', message: '<p>発売本文</p>' } };
    await archive.request('put', { key: 'lantis-2', data: lantis, owner: 'assistant' });
    await archive.request('translate', { key: 'lantis-2', revision: 1, translator: 'assistant',
      detail: { ...lantis.detail, title_zh: '发售新闻', message_zh: '<p>发售正文</p>' } });
    fs.writeFileSync(path.join(directory, 'news_snapshot.json'), JSON.stringify({ generated_at: new Date().toISOString(), information_list: [{ announce_id: 1, title: source.detail.title, title_zh: '旧标题' }] }));
    fs.writeFileSync(path.join(directory, 'lantis_news.json'), JSON.stringify([{id: 'lantis-2', title: lantis.detail.title}]));
    const serviceOptions = { DATA_DIR: directory, path, fs, crypto,
      NO_AUTO_CRAWL: true, newsContent: { isRemoved: key => key === 'official-1568', apply: item => item, message: () => '', title: (_, existing) => existing || '' },
      httpsGet() { sourceCalls++; throw new Error('Visitor requested upstream source'); },
      httpsGetHtml(url, callback) { callback(null, lantisHtml); },
      translateArticle() { translationCalls++; throw new Error('Visitor requested translation'); },
      sendJson(res, status, data, options) { res.status = status; res.data = data; res.options = options; } };
    service = require('./server-news').createService(serviceOptions);
    service.start();
    const index = {}, cd = {};
    await service.handleNewsIndex(index);
    await service.handleLantisNews(cd);
    assert.strictEqual(index.data.information_list[0].title_zh, '新闻');
    assert.strictEqual(cd.data.information_list[0].title_zh, '发售新闻');
    const removed = {};
    await service.handleNewsDetail(null, removed, new URLSearchParams('id=1568'));
    assert.strictEqual(removed.status, 404);
    await archive.request('translate', { key: 'official-1', revision: 1, translator: 'assistant',
      detail: { ...source.detail, title_zh: '修订后的新闻', message_zh: '<p>新闻正文</p>' } });
    const updated = {};
    await service.handleNewsIndex(updated);
    assert.strictEqual(updated.data.information_list[0].title_zh, '修订后的新闻');
    assert.notStrictEqual(updated.options.etag, index.options.etag);
    for (let visit = 0; visit < 5; visit++) {
      const response = {};
      await service.handleNewsDetail(null, response, new URLSearchParams('id=1'));
      // The public handler schedules the asynchronous archive read.
      for (let attempt = 0; !response.data && attempt < 100; attempt++) await new Promise(done => setTimeout(done, 10));
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.data.detail.message, source.detail.message);
      assert.strictEqual(response.data.detail.message_zh, '<p>新闻正文</p>');
    }
    assert.strictEqual(sourceCalls, 0);
    assert.strictEqual(translationCalls, 0);
    for (const [handler, id, expected] of [['handleNewsDetail','1',200], ['handleNewsDetail','987654',404], ['handleLantisDetail','lantis-2',200], ['handleLantisDetail','lantis-987654',404]]) {
      const response = {};
      await service[handler](null, response, new URLSearchParams({id,prefetch:'1'}));
      for (let attempt=0; !response.data && attempt<100; attempt++) await new Promise(done=>setTimeout(done,10));
      assert.strictEqual(response.status, expected, 'prefetch reads archived articles only');
    }
    assert.strictEqual(sourceCalls, 0, 'prefetch never starts an upstream source request');
    assert.strictEqual(translationCalls, 0, 'prefetch never starts translation');
    serviceOptions.NO_AUTO_CRAWL = false;
    const prefetchedIndex = {};
    await service.handleNewsIndex(prefetchedIndex,new URLSearchParams('prefetch=1'));
    assert.strictEqual(prefetchedIndex.status,200);
    assert.strictEqual(sourceCalls,0,'index prefetch does not refresh upstream sources');
    serviceOptions.NO_AUTO_CRAWL = true;
    await service.handleLantisDetail(null, { archiveLoad: true }, new URLSearchParams('id=77'));
    let extracted;
    for (let attempt = 0; !extracted && attempt < 100; attempt++) {
      extracted = await archive.request('get', { key: 'lantis-77' });
      if (!extracted) await new Promise(done => setTimeout(done, 10));
    }
    assert(extracted, 'online source fetch is archived');
    const local = require('child_process').execFileSync(process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'), ['-c',
      "import json;from io import BytesIO;from unittest.mock import patch;from pathlib import Path;from archive_news import source_article\nwith patch('archive_news.urllib.request.urlopen',return_value=BytesIO(Path('fixtures/lantis-article.html').read_bytes())): print(json.dumps(source_article({'source':'lantis','announce_id':'lantis-77','url':'https://umamusume.lantis.jp/news/77/'})[1]['detail']))"],
      { cwd: __dirname, encoding: 'utf8' });
    for (const field of ['title', 'message']) assert.strictEqual(extracted.detail[field], JSON.parse(local)[field], 'local and online fetchers archive identical ' + field);
    console.log('persisted bilingual news reads bypass upstream and translation on every visit');
  } finally {
    service?.close();
    archive.close();
    await new Promise(done => setTimeout(done, 100));
    fs.rmSync(directory, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
