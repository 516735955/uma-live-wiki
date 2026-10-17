'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { previewStore, localImageLoader, previewWidth } = require('./image-previews');

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-preview-test-'));
  const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  try {
    const preview = previewStore(directory, python);
    const load = localImageLoader(path.resolve(__dirname, '..'), preview);
    const source = '/uma_tools/img/hero_bg.jpg';
    const results = await Promise.all(Array.from({length: 6}, () => load(source, 480)));
    assert(results.every(row => row.bytes.equals(results[0].bytes)));
    assert.strictEqual(fs.readdirSync(directory).length, 1, 'concurrent requests share a single encoded variant');
    assert(results[0].bytes.length < fs.statSync(path.join(__dirname, 'img/hero_bg.jpg')).size / 4);
    const dimensions = execFileSync(python, ['-c', 'from PIL import Image; import sys; im=Image.open(sys.stdin.buffer); print(*im.size)'], {input: results[0].bytes}).toString().trim().split(' ').map(Number);
    assert(dimensions[0] <= 480);
    assert(Math.abs(dimensions[0] / dimensions[1] - 2428 / 1518) < 0.01);
    assert.strictEqual((await load(source, 480)).etag, results[0].etag);
    assert.notStrictEqual((await load(source, 960)).etag, results[0].etag);
    await assert.rejects(load('/data/baidu.conf.json', 480), /unsupported/);
    await assert.rejects(load('https://example.com/uma_tools/img/foo.png', 480), /unsupported/);
    assert.throws(() => previewWidth('nonsense'), /invalid/);
    assert.strictEqual(previewWidth(9000), 1440);
    console.log('real image resizing, proportional dimensions, shared cache and restricted sources passed');
  } finally { fs.rmSync(directory, {recursive: true, force: true}); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
