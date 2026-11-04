'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { createTerms } = require('./translation-terms');
const { createService } = require('./server-translation');
const { splitHtmlText } = require('./html-text');

async function main() {
  const previous = [process.env.BAIDU_APPID, process.env.BAIDU_SECRET];
  process.env.BAIDU_APPID = process.env.BAIDU_SECRET = 'fixture';
  try {
    async function article(message, destination, { fragments = {}, seed = {}, title = 'ニュース', title_zh = '新闻' } = {}) {
      const queries = [];
      class Cache {
        constructor() { this.values = { ...seed }; }
        get(key) { return this.values[key]; }
        async set(key, value) { this.values[key] = value; }
        async setMany(values) { Object.assign(this.values, values); }
      }
      class Edits { title() { return ''; } message() { return ''; } apply(value) { return value; } }
      const fixtureFs = { ...fs, readFileSync(file, ...args) {
        if (path.basename(String(file)) === 'translation_status.json') throw Object.assign(new Error('isolated provider state'), { code: 'ENOENT' });
        return fs.readFileSync(file, ...args);
      } };
      const service = createService({ fs: fixtureFs, path, crypto, ROOT: path.resolve(__dirname, '..'),
        DATA_DIR: path.resolve(__dirname, '../data'), TranslationCache: Cache, NewsContent: Edits,
        createTerms, loadTerms: () => [{ ja: '架空名', zh: '名称' }],
        https: { request(url, options, callback) {
          const request = new EventEmitter();
          request.setTimeout = () => request;
          request.destroy = error => request.emit('error', error);
          request.end = body => setImmediate(() => {
            const source = new URLSearchParams(body).get('q');
            queries.push(source);
            const response = new EventEmitter(); callback(response);
            response.emit('data', JSON.stringify(destination === null ? {} : { trans_result: [{ src: source, dst: destination }] }));
            response.emit('end');
          });
          return request;
        } },
      });
      const data = await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('article callback missing')), 5000);
        service.translateArticle({ title, title_zh, message, archive_fragments: fragments },
          new AbortController().signal, (status, result) => { clearTimeout(deadline); resolve(result.detail); });
      });
      return { data, queries };
    }
    const raw = '<p title="補足 > 詳細">&#12362;&#30693;&#12425;&#12379; &amp; &lt;NEW&gt;</p><script>非表示です</script>';
    const translated = await article(raw, '通知 & <NEW>');
    assert.deepStrictEqual(translated.queries, ['お知らせ & <NEW>']);
    assert.strictEqual(translated.data.message_zh, '<p title="補足 > 詳細">通知 &amp; &lt;NEW&gt;</p><script>非表示です</script>');
    assert.strictEqual(translated.data.translation_state, 'complete');
    const emoji = await splitHtmlText('<p>🐎 &copy; お知らせ</p>');
    assert.strictEqual(emoji[1].text, '🐎 © お知らせ', 'parser offsets preserve Unicode and decode named entities');
    const reused = await article('<p>&#12362;&#30693;&#12425;&#12379;</p>', null,
      { fragments: { '&#12362;&#30693;&#12425;&#12379;': '通知' } });
    assert.strictEqual(reused.queries.length, 0, 'existing reviewed fragments work across entity decoding');
    assert.strictEqual(reused.data.message_zh, '<p>通知</p>');
    const acceptedName = await article('<p>・シンパシー</p>', null,
      { fragments: { '・シンパシー': '・シンパシー' } });
    assert.strictEqual(acceptedName.queries.length, 0, 'accepted unchanged names in the bilingual archive are not billed again');
    const failed = await article('<p>お知らせ</p>', null);
    const repeated = await article('<p>お知らせ</p><p>お知らせ</p>', '通知');
    assert.deepStrictEqual(repeated.queries, ['お知らせ'], 'repeated article paragraphs consume one provider translation');
    assert.strictEqual(repeated.data.message_zh, '<p>通知</p><p>通知</p>');
    const sharedTitle = await article('<h2>お知らせ</h2>', '通知', {title:'お知らせ', title_zh:''});
    assert.strictEqual(sharedTitle.queries.length, 1, 'the body reuses a title archived during the same update');
    assert.strictEqual(sharedTitle.data.message_zh, '<h2>通知</h2>');
    assert.strictEqual(failed.data.translation_state, 'partial');
    assert.strictEqual(failed.data.message_zh, '<p>お知らせ</p>', 'upstream failure preserves the source and remains retryable');
    const message = '<p>お知らせ</p>';
    const oldKey = 'msg_' + crypto.createHash('md5').update(message).digest('hex');
    const repaired = await article(message, '通知', { seed: { [oldKey]: '<p>broken old markup</p>' } });
    assert.strictEqual(repaired.queries.length, 1, 'obsolete machine HTML cache cannot bypass the corrected parser');
    assert.strictEqual(repaired.data.message_zh, '<p>通知</p>');
    console.log('HTML translation, literal text and reviewed fragment regressions passed');
  } finally {
    for (const [index, name] of ['BAIDU_APPID', 'BAIDU_SECRET'].entries()) {
      if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index];
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
