'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeNews, NewsContent } = require('./news-content');
const { TranslationCache } = require('./translation-cache');
const { createTerms, loadTerms } = require('./translation-terms');
const { officialImage } = require('./news-images');
async function main() {
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-news-test-'));
try {
  const rows = mergeNews([
    { announce_id: 1, title: 'source', title_zh: '人工订正', image: 'tuned.jpg', image_source: 'manual', label: 'kept' },
    { announce_id: 2, title: 'missing page' }
  ], [{ announce_id: '1', title: 'source', image: 'incoming.jpg', label: '' }]);
  assert.strictEqual(rows.length, 2, 'an absent upstream row is not a deletion');
  assert.strictEqual(rows[0].image, 'tuned.jpg');
  assert.strictEqual(mergeNews([{ announce_id: 3, image: 'old.jpg' }],
    [{ announce_id: 3, image: 'new.jpg' }])[0].image, 'new.jpg', 'source image corrections replace automatic images');
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
  fs.writeFileSync(edits, '{invalid');
  content.checkedAt = 0;
  assert.strictEqual(content.message('msg_1'), '订正正文', 'an interrupted edit keeps the last usable overrides');
  const absolute = require('./news-content').absoluteArticleLinks('<a href="../info/">详情</a><img src="img/a.jpg">', 'https://umamusume.lantis.jp/news/1/');
  assert(absolute.includes('https://umamusume.lantis.jp/news/info/'));
  assert(absolute.includes('https://umamusume.lantis.jp/news/1/img/a.jpg'));
  const file = path.join(temporary, 'cache.json');
  fs.writeFileSync(file, JSON.stringify({ first: 'one' }));
  const cache = new TranslationCache(file);
  fs.writeFileSync(file, JSON.stringify({ first: 'changed outside', second: 'two' }));
  fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
  await cache.set('third', 'three');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file)), { first: 'changed outside', second: 'two', third: 'three' });
  fs.writeFileSync(file + '.lock', 'other writer');
  let heartbeat = false;
  setTimeout(() => {
    heartbeat = true;
    const current = JSON.parse(fs.readFileSync(file));
    fs.writeFileSync(file, JSON.stringify({ ...current, external: 'arrived while waiting' }));
    fs.unlinkSync(file + '.lock');
  }, 25);
  await cache.set('waiting', 'saved');
  assert(heartbeat, 'waiting for the cross-process lock leaves the event loop available');
  assert.strictEqual(JSON.parse(fs.readFileSync(file)).external, 'arrived while waiting');
  await Promise.all([cache.set('writerA', 'a'), new TranslationCache(file).set('writerB', 'b')]);
  const concurrent = JSON.parse(fs.readFileSync(file));
  assert.strictEqual(concurrent.writerA, 'a');
  assert.strictEqual(concurrent.writerB, 'b', 'concurrent cache writers retain both accepted translations');
  if (process.platform !== 'win32') {
    const link = path.join(temporary, 'release-cache.json');
    fs.symlinkSync(file, link);
    await new TranslationCache(link).set('fourth', 'four');
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
  const gacha = terms.protect('10回引く!（有償） / 10回引く!（通常） / 1回引く! / 有償ジュエル / 無償ジュエル');
  assert.strictEqual(gacha.restore(gacha.text), '付费十连抽 / 普通十连抽 / 单抽 / 付费宝石 / 免费宝石');
  const program = terms.protect('そこそこぱかライブTV／ぱかライブTV\'／ぱかチューブっ!');
  assert.strictEqual(program.restore(program.text), 'SokoSoko PakaLive TV／PakaLive TV\'／PakaTube');
  assert.strictEqual(terms.normalize('差不多Paka Live TV／赛马娘直播TV／ぱか频道っ!'),
    'SokoSoko PakaLive TV／PakaLive TV／PakaTube');
  const linkedProgram = terms.protect('ぱかライブTV https://example.com/ぱかライブTV?id=123');
  assert.strictEqual(linkedProgram.restore(linkedProgram.text), 'PakaLive TV https://example.com/ぱかライブTV?id=123');
  assert.strictEqual(terms.normalize('<a href="https://example.com/ぱかライブTV">ぱか直播TV</a>'),
    '<a href="https://example.com/ぱかライブTV">PakaLive TV</a>');
  const { untranslatedJapanese } = require('./translation-facts');
  assert(untranslatedJapanese('新しい情報をご確認ください。', '请确认新しい情報をご確認ください。'));
  assert(officialImage('https://prd-info-umamusume.akamaized.net/announce/3469/Header/test.png?c=1'));
  assert.strictEqual(officialImage('https://example.com/test.png'), null);
  assert.strictEqual(officialImage('https://prd-info-umamusume.akamaized.net:8080/announce/1/Header/test.png'), null);
  const articleSource = '原文正文';
  const articleKey = 'msg_' + require('crypto').createHash('md5').update(articleSource).digest('hex');
  fs.writeFileSync(edits, JSON.stringify({ titles: {}, messages: {}, news: { 1: { source_message: articleKey, message_zh: '订正正文' } } }));
  fs.utimesSync(edits, new Date(), new Date(Date.now() + 2000));
  const now = Date.now;
  Date.now = () => now() + 2000;
  assert.strictEqual(content.apply({ announce_id: 1, message: articleSource }).message_zh, '订正正文');
  assert.strictEqual(content.apply({ announce_id: 1, message: '原文已更新' }).message_zh, undefined, 'a correction does not overwrite changed source content');
  Date.now = now;
  console.log('news content, external cache edits and glossary regressions passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
