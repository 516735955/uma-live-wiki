'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const widths = [160, 480, 960, 1440];
function previewWidth(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('invalid preview width');
  return widths.find(width => width >= number) || widths.at(-1);
}

function previewStore(directory, python) {
  const pending = new Map();
  let active = 0, lastCleanup = 0;
  const waiting = [];
  async function cleanup() {
    if (Date.now() - lastCleanup < 60000) return;
    lastCleanup = Date.now();
    const names = await fs.promises.readdir(directory);
    const rows = (await Promise.all(names.filter(name => /^[a-f0-9]{64}\.webp$/.test(name)).map(async name => {
      const file = path.join(directory, name);
      const stat = await fs.promises.stat(file).catch(() => null);
      return stat && { file, size: stat.size, at: stat.atimeMs };
    }))).filter(Boolean).sort((a, b) => a.at - b.at);
    let total = rows.reduce((sum, row) => sum + row.size, 0);
    for (const row of rows) {
      if (total <= 128 * 1024 * 1024) break;
      await fs.promises.unlink(row.file).catch(() => {});
      total -= row.size;
    }
  }
  return async function preview(identity, requestedWidth, read) {
    const width = previewWidth(requestedWidth);
    const key = crypto.createHash('sha256').update('webp78-v1:' + identity + ':' + width).digest('hex');
    const file = path.join(directory, key + '.webp');
    const cached = await fs.promises.readFile(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (cached) return { bytes: cached, extension: '.webp', etag: '"' + key + '"' };
    if (pending.has(key)) return pending.get(key);
    if (waiting.length >= 64) throw new Error('preview queue full');
    const task = (async () => {
      if (active >= 2) await new Promise(resolve => waiting.push(resolve));
      else active++;
      try {
        const input = await read();
        if (input.length > 32 * 1024 * 1024) throw new Error('preview source too large');
        const bytes = await new Promise((resolve, reject) => {
          const child = execFile(python, [path.join(__dirname, 'image_preview.py'), String(width)],
            { timeout: 15000, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
            (error, stdout) => error ? reject(new Error('image preview failed')) : resolve(stdout));
          child.stdin.on('error', () => {});
          child.stdin.end(input);
        });
        await fs.promises.mkdir(directory, { recursive: true });
        const temporary = file + '.' + process.pid + '.tmp';
        try {
          await fs.promises.writeFile(temporary, bytes);
          await fs.promises.rename(temporary, file);
        } finally { await fs.promises.unlink(temporary).catch(() => {}); }
        cleanup().catch(() => {});
        return { bytes, extension: '.webp', etag: '"' + key + '"' };
      } finally {
        if (waiting.length) waiting.shift()();
        else active--;
      }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  };
}

function localImageLoader(root, preview) {
  return async (value, width) => {
    const url = new URL(value, 'http://local');
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== 'http://local' || !/^\/(?:uma_tools\/img|album_covers|uma_avatars|uma_moe|uma_official|uma_va|video_thumbs)\/.+\.(?:png|jpe?g|webp)$/i.test(pathname)) throw new Error('unsupported preview image');
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) throw new Error('unsupported preview image');
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('unsupported preview image');
    return preview(file + ':' + stat.mtimeMs + ':' + stat.size, width, () => fs.promises.readFile(file));
  };
}
module.exports = { previewStore, previewWidth, localImageLoader };
