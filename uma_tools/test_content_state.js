'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(__dirname + '/frontend/content-state.js', 'utf8')
  .replace('export const ContentState', 'const ContentState');
const ContentState = vm.runInNewContext(`(() => { ${source}; return ContentState; })()`);
const message = (state, subject) => ContentState.computed.message.call({ state, subject });

assert.strictEqual(message('uncollected', '创作资料'), '尚未收录创作资料');
assert.strictEqual(message('not_announced', '动画关联'), '官方尚未公布动画关联');
assert.strictEqual(message('not_published', '歌词'), '歌词未公开');
assert.strictEqual(message('not_applicable', '歌词'), '歌词不适用');
assert.strictEqual(message('confirmed_none', '现场演出'), '已确认没有现场演出');
assert.strictEqual(message('loading', '歌曲资料'), '正在加载歌曲资料…');
assert.strictEqual(message('error', '歌曲资料'), '歌曲资料加载失败');
assert.strictEqual(message('filtered', '歌曲'), '没有符合条件的歌曲');
assert.strictEqual(message('unknown', '内容'), '尚未收录内容');
assert.strictEqual(ContentState.computed.message.call({ state: 'not_applicable', subject: '歌词', reason: '该录音为纯音乐，无歌词' }), '该录音为纯音乐，无歌词');
console.log('content-state component passed');
