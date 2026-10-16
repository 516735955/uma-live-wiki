'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const state = require('./deployment-state');
if (process.platform === 'win32') {
  console.log('systemd deployment symlink checks run on Linux; Windows catalog checks remain enabled');
  process.exit(0);
}
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'uma-switch-')));
try {
  const old = path.join(root, 'releases', 'a'.repeat(40));
  const next = path.join(root, 'releases', 'b'.repeat(40));
  const sharedData = path.join(root, 'shared/data');
  fs.mkdirSync(old, {recursive: true});
  fs.mkdirSync(next, {recursive: true});
  fs.mkdirSync(path.join(sharedData, 'auto_update'), {recursive: true});
  fs.writeFileSync(path.join(sharedData, 'auto_update/news.sqlite'), 'live bilingual archive');
  fs.writeFileSync(path.join(sharedData, 'news_snapshot.json'), JSON.stringify({information_list:[{announce_id:1,title:'one'}]}));
  fs.writeFileSync(path.join(sharedData, 'lantis_news.json'), '[]');
  fs.writeFileSync(path.join(sharedData, 'catalog.json'), 'old complete catalog');
  fs.writeFileSync(path.join(old, 'release.json'), JSON.stringify({commit:'a'.repeat(40)}));
  fs.writeFileSync(path.join(next, 'release.json'), JSON.stringify({commit:'b'.repeat(40)}));
  fs.symlinkSync(old, path.join(root, 'current'), 'dir');
  fs.symlinkSync(sharedData, path.join(old, 'data'), 'dir');
  const previous = state.initialize(root);
  const generation = path.join(root, 'shared/datasets/candidate');
  const inputs = path.join(root, 'inputs');
  fs.mkdirSync(inputs);
  require('./data-sync').stage(inputs, inputs, sharedData, generation);
  state.prepareData(root, generation);
  fs.writeFileSync(path.join(generation, 'catalog.json'), 'new complete catalog');
  fs.symlinkSync(generation, path.join(next, 'data'), 'dir');
  assert.strictEqual(fs.readFileSync(path.join(root, 'current/data/catalog.json'), 'utf8'), 'old complete catalog');
  assert.strictEqual(fs.readFileSync(path.join(old, 'data/catalog.json'), 'utf8'), 'old complete catalog');
  state.activate(root, next, 8081);
  assert.strictEqual(fs.realpathSync(path.join(root, 'current')), next);
  assert.strictEqual(fs.readFileSync(path.join(root, 'current/data/catalog.json'), 'utf8'), 'new complete catalog');
  fs.appendFileSync(path.join(next, 'data/auto_update/news.sqlite'), '+incremental translation');
  state.apply(root, previous);
  assert.strictEqual(fs.realpathSync(path.join(root, 'current')), old);
  assert.strictEqual(fs.readFileSync(path.join(old, 'data/auto_update/news.sqlite'), 'utf8'), 'live bilingual archive+incremental translation');
  assert.strictEqual(fs.readFileSync(path.join(old, 'data/catalog.json'), 'utf8'), 'old complete catalog');
  console.log('complete generation cutover, failed-candidate restoration and shared archive continuity passed');
} finally { fs.rmSync(root, {recursive:true, force:true}); }
