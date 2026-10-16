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
  try {
    const source = { detail: { announce_id: 1, title: 'ニュース', message: '<p>ニュース本文</p>' } };
    await archive.request('put', { key: 'official-1', data: source, owner: 'assistant' });
    await archive.request('translate', { key: 'official-1', revision: 1, translator: 'assistant',
      detail: { ...source.detail, title_zh: '新闻', message_zh: '<p>新闻正文</p>' } });
    fs.writeFileSync(path.join(directory, 'news_snapshot.json'), JSON.stringify({ generated_at: new Date().toISOString(), information_list: [{ announce_id: 1 }] }));
    fs.writeFileSync(path.join(directory, 'lantis_news.json'), '[]');
    service = require('./server-news').createService({ DATA_DIR: directory, path, fs, crypto,
      NO_AUTO_CRAWL: true, newsContent: { apply: item => item, message: () => '' },
      httpsGet() { sourceCalls++; throw new Error('Visitor requested upstream source'); },
      translateArticle() { translationCalls++; throw new Error('Visitor requested translation'); },
      sendJson(res, status, data) { res.status = status; res.data = data; } });
    service.start();
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
    console.log('persisted bilingual news reads bypass upstream and translation on every visit');
  } finally {
    service?.close();
    archive.close();
    await new Promise(done => setTimeout(done, 100));
    fs.rmSync(directory, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
