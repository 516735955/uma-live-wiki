'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { ImageJobs } = require('./image-jobs');
const { fileIdentity, readSnapshot, touchImage, imageAccess } = require('./news-images');

const widths = [160, 480, 960, 1440];
function previewWidth(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('invalid preview width');
  return widths.find(width => width >= number) || widths.at(-1);
}

function previewStore(directory, python) {
  const jobs = new ImageJobs(2);
  let lastCleanup = 0;
  async function cleanup() {
    if (Date.now() - lastCleanup < 60000) return;
    lastCleanup = Date.now();
    const names = await fs.promises.readdir(directory);
    const rows = (await Promise.all(names.filter(name => /^[a-f0-9]{64}\.webp$/.test(name)).map(async name => {
      const file = path.join(directory, name);
      const stat = await fs.promises.stat(file).catch(() => null);
      return stat && { file, size: stat.size, at: imageAccess(file, stat) };
    }))).filter(Boolean).sort((a, b) => a.at - b.at);
    let total = rows.reduce((sum, row) => sum + row.size, 0);
    for (const row of rows) {
      if (total <= 128 * 1024 * 1024) break;
      if (jobs.jobs.has(path.basename(row.file, '.webp'))) continue;
      await fs.promises.unlink(row.file).catch(() => {});
      total -= row.size;
    }
  }
  return async function preview(identity, requestedWidth, read, { signal, invalidate } = {}) {
    const width = previewWidth(requestedWidth);
    const key = crypto.createHash('sha256').update('webp78-v1:' + identity + ':' + width).digest('hex');
    const file = path.join(directory, key + '.webp');
    const cached = await fs.promises.readFile(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (cached) { touchImage(file); return { bytes: cached, extension: '.webp', etag: '"' + key + '"' }; }
    try { return await jobs.run(key, async (workSignal, expires) => {
        const input = await read();
        if (workSignal.aborted) throw workSignal.reason;
        if (input.length > 32 * 1024 * 1024) throw new Error('preview source too large');
        const bytes = await new Promise((resolve, reject) => {
          const child = execFile(python, [path.join(__dirname, 'image_preview.py'), String(width)],
            { signal: workSignal, timeout: Math.max(1, expires - Date.now()), maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' },
            (error, stdout, stderr) => {
              if (!error) return resolve(stdout);
              const failure = new Error('image preview failed');
              if (/UnidentifiedImageError|image file is truncated|broken data stream|cannot identify image file/i.test(String(stderr))) failure.code = 'INVALID_IMAGE';
              reject(failure);
            });
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
        touchImage(file);
        return { bytes, extension: '.webp', etag: '"' + key + '"' };
    }, signal, 15000); }
    catch (error) { if (error.code === 'INVALID_IMAGE' && invalidate) await invalidate(); throw error; }
  };
}

function localImageLoader(root, preview) {
  return async (value, width, options) => {
    const url = new URL(value, 'http://local');
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== 'http://local' || !/^\/(?:uma_tools\/img|album_covers|uma_avatars|uma_moe|uma_official|uma_va|video_thumbs)\/.+\.(?:png|jpe?g|webp)$/i.test(pathname)) throw new Error('unsupported preview image');
    const file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep)) throw new Error('unsupported preview image');
    const handle = await fs.promises.open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('unsupported preview image');
      const read = () => readSnapshot(handle, stat.size);
      if (width === undefined || width === null || width === '') {
        return { bytes: await read(), extension: path.extname(pathname).toLowerCase() };
      }
      return await preview(await fileIdentity(file, stat, read), width, read, options);
    } finally { await handle.close(); }
  };
}
module.exports = { previewStore, previewWidth, localImageLoader };
