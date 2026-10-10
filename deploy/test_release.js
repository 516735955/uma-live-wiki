'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepareRelease } = require('./prepare-release');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-release-test-'));
try {
  const root = path.join(temporary, 'source');
  fs.mkdirSync(path.join(root, 'uma_tools'), { recursive: true });
  const html = '<head><script src="/uma_tools/app.js"></script></head>';
  fs.writeFileSync(path.join(root, '赛马娘LIVE相关.html'), html);
  fs.writeFileSync(path.join(root, 'uma_tools/app.js'), 'load("/uma_tools/child.js"); load("/data/index.js");');
  fs.writeFileSync(path.join(root, 'uma_tools/child.js'), 'const value = 1;');
  const commit = 'a'.repeat(40);
  const first = prepareRelease(root, commit);
  const firstApp = fs.readFileSync(path.join(root, first.assets['/uma_tools/app.js']), 'utf8');
  assert(firstApp.includes(first.assets['/uma_tools/child.js']), 'lazy loader references its exact dependency');
  assert(firstApp.includes('/data/index.js'), 'mutable data is not bundled into immutable assets');
  const oldChild = fs.readFileSync(path.join(root, first.assets['/uma_tools/child.js']), 'utf8');
  fs.writeFileSync(path.join(root, '赛马娘LIVE相关.html'), html);
  fs.writeFileSync(path.join(root, 'uma_tools/child.js'), 'const value = 2;');
  const second = prepareRelease(root, 'b'.repeat(40));
  assert.notStrictEqual(first.assets['/uma_tools/app.js'], second.assets['/uma_tools/app.js'], 'changing a lazy dependency changes the parent asset address');
  assert.strictEqual(fs.readFileSync(path.join(root, first.assets['/uma_tools/child.js']), 'utf8'), oldChild, 'previous browser tabs can still read their original resource');
  assert(fs.readFileSync(path.join(root, '赛马娘LIVE相关.html'), 'utf8').includes('content="' + 'b'.repeat(40) + '"'));
  console.log('release resource identity and previous-tab regressions passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
