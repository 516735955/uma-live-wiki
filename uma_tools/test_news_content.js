'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeNews, NewsContent } = require('./news-content');
const { TranslationCache } = require('./translation-cache');
const { createTerms, loadTerms } = require('./translation-terms');
const { officialImage } = require('./news-images');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-news-test-'));
try {
  const rows = mergeNews([
    { announce_id: 1, title: 'source', title_zh: '人工订正', image: 'tuned.jpg', label: 'kept' },
    { announce_id: 2, title: 'missing page' }
  ], [{ announce_id: '1', title: 'source', image: 'incoming.jpg', label: '' }]);
  assert.strictEqual(rows.length, 2, 'an absent upstream row is not a deletion');
  assert.strictEqual(rows[0].image, 'tuned.jpg');
  assert.strictEqual(rows[0].label, 'kept');
  assert.strictEqual(rows[0].title_zh, '人工订正');
  assert.strictEqual(mergeNews(rows, [{ announce_id: 1, title: 'new source' }])[0].title_zh, '');
  const edits = path.join(temporary, 'edits.json');
  fs.writeFileSync(edits, JSON.stringify({ titles: { source: '人工订正' }, messages: { msg_1: '订正正文' }, news: {} }));
  const content = new NewsContent(edits, () => '新的机器结果', () => '旧的机器结果');
  assert.strictEqual(content.title('source', '旧的机器结果'), '人工订正');
  assert.strictEqual(content.title('other', '其他精调'), '其他精调');
  assert.strictEqual(content.title('other', '旧的机器结果'), '新的机器结果');
  assert.strictEqual(content.message('msg_1'), '订正正文');
  const file = path.join(temporary, 'cache.json');
  fs.writeFileSync(file, JSON.stringify({ first: 'one' }));
  const cache = new TranslationCache(file);
  fs.writeFileSync(file, JSON.stringify({ first: 'changed outside', second: 'two' }));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
  cache.set('third', 'three');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file)), { first: 'changed outside', second: 'two', third: 'three' });
  if (process.platform !== 'win32') {
    const link = path.join(temporary, 'release-cache.json');
    fs.symlinkSync(file, link);
    new TranslationCache(link).set('fourth', 'four');
    assert(fs.lstatSync(link).isSymbolicLink(), 'cache writes retain the shared release symlink');
    assert.strictEqual(JSON.parse(fs.readFileSync(file)).fourth, 'four');
  }
  const terms = createTerms(loadTerms(path.resolve(__dirname, '..')));
  const protectedText = terms.protect('トウカイテイオー、和氣あず未');
  assert.strictEqual(protectedText.restore(protectedText.text), '东海帝王、和气杏未');
  assert.strictEqual(protectedText.restore('lost tokens'), null);
  assert.strictEqual(protectedText.restore(protectedText.text + protectedText.text), null);
  const numbered = terms.protect('トウカイテイオー、和氣あず未', '0004');
  assert(!/\d/.test(numbered.text), 'translation markers have no lossy numeric identifiers');
  assert.strictEqual(numbered.restore(numbered.text), '东海帝王、和气杏未');
  assert(officialImage('https://prd-info-umamusume.akamaized.net/announce/3469/Header/test.png?c=1'));
  assert.strictEqual(officialImage('https://example.com/test.png'), null);
  assert.strictEqual(officialImage('https://prd-info-umamusume.akamaized.net:8080/announce/1/Header/test.png'), null);
  const articleSource = '原文正文';
  const articleKey = 'msg_' + require('crypto').createHash('md5').update(articleSource).digest('hex');
  fs.writeFileSync(edits, JSON.stringify({ titles: {}, messages: {}, news: { 1: { source_message: articleKey, message_zh: '订正正文' } } }));
  fs.utimesSync(edits, new Date(), new Date(Date.now() + 2000));
  assert.strictEqual(content.apply({ announce_id: 1, message: articleSource }).message_zh, '订正正文');
  assert.strictEqual(content.apply({ announce_id: 1, message: '原文已更新' }).message_zh, undefined, 'a correction does not overwrite changed source content');
  console.log('news content, external cache edits and glossary regressions passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
