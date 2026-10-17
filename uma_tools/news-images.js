'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

function officialImage(value) {
  try {
    const url = new URL(value);
    const allowed = url.hostname === 'prd-info-umamusume.akamaized.net' && /^\/announce\/\d+\/(?:Header|Thumbnail)\//.test(url.pathname) ||
      url.hostname === 'umamusume.lantis.jp' && /^\/7uTXon4C\/wp-content\/uploads\//.test(url.pathname);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowed && /\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname) ? url : null;
  } catch (error) { return null; }
}

function imageStore(directory, options = {}) {
  const validateUrl = options.validateUrl || officialImage;
  const pending = new Map(), attempts = new Map();
  let active = 0;
  const waiting = [];
  async function acquire() {
    if (active >= 4) {
      if (waiting.length >= 64) throw new Error('news image queue full');
      await new Promise(resolve => waiting.push(resolve));
    } else active++;
  }
  function release() {
    if (waiting.length) waiting.shift()();
    else active--;
  }
  const capacity = Number(options.capacity || process.env.NEWS_IMAGE_CACHE_BYTES) || 256 * 1024 * 1024;
  let lastCleanup = 0;
  async function cleanup() {
    if (Date.now() - lastCleanup < 60000) return;
    lastCleanup = Date.now();
    for (const [file, attemptedAt] of attempts) {
      if (!pending.has(file) && Date.now() - attemptedAt >= 60000) attempts.delete(file);
    }
    const names = await fs.promises.readdir(directory).catch(() => []);
    const rows = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.(?:png|jpe?g|webp|gif)$/.test(name)).map(async name => {
      const file = path.join(directory, name);
      const stat = await fs.promises.stat(file).catch(() => null);
      return stat && { file, size: stat.size, at: stat.atimeMs };
    }));
    const files = rows.filter(Boolean).sort((a, b) => a.at - b.at);
    let total = files.reduce((sum, row) => sum + row.size, 0);
    for (const row of files) {
      if (total <= capacity) break;
      if (pending.has(row.file)) continue;
      await fs.promises.unlink(row.file).catch(() => {});
      total -= row.size;
    }
  }
  async function refresh(url, file, extension) {
    if (pending.has(file)) return pending.get(file);
    if (Date.now() - (attempts.get(file) || 0) < 60000) throw new Error('news image retry deferred');
    attempts.set(file, Date.now());
    const task = (async () => {
      await acquire();
      try {
      const download = source => new Promise((resolve, reject) => {
        let timer;
        const request = https.get(source, { family: 4, headers: { 'User-Agent': 'UmaLiveWiki/1.0', Accept: 'image/*' } }, (response) => {
          if (response.statusCode !== 200 || !/^image\/(?:png|jpeg|webp|gif)(?:;|$)/i.test(response.headers['content-type'] || '')) {
            response.resume();
            const error = new Error('news image HTTP ' + response.statusCode);
            error.statusCode = response.statusCode;
            reject(error); return;
          }
          const chunks = []; let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) request.destroy(new Error('news image too large'));
            else chunks.push(chunk);
          });
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
          response.on('aborted', () => reject(new Error('news image response aborted')));
        });
        // A progressing image download can exceed 15 seconds on agency hosts.
        // Stop stalled sockets promptly and keep a separate total deadline.
        request.setTimeout(15000, () => request.destroy(new Error('news image stalled')));
        timer = setTimeout(() => request.destroy(new Error('news image timeout')), 90000);
        request.on('error', reject);
        request.on('close', () => clearTimeout(timer));
      });
      const bytes = await download(url).catch(error => {
        if ([404, 410].includes(error.statusCode) && url.hostname === 'i.ytimg.com' && /\/maxresdefault\.jpg$/.test(url.pathname)) {
          const fallback = new URL(url.href);
          fallback.pathname = fallback.pathname.replace(/maxresdefault\.jpg$/, 'hqdefault.jpg');
          return download(fallback);
        }
        throw error;
      });
      await fs.promises.mkdir(directory, { recursive: true });
      const temporary = file + '.' + process.pid + '.tmp';
      try {
        await fs.promises.writeFile(temporary, bytes);
        await fs.promises.rename(temporary, file);
      } finally { await fs.promises.unlink(temporary).catch(() => {}); }
      return { bytes, extension, identity: crypto.createHash('sha256').update(bytes).digest('hex') };
      } finally { release(); }
    })();
    pending.set(file, task);
    try { return await task; } finally { pending.delete(file); await cleanup(); }
  }
  return async function load(value, { deferBytes = false } = {}) {
    const url = validateUrl(value);
    if (!url) throw new Error('unsupported news image');
    const extension = path.extname(url.pathname).toLowerCase();
    const file = path.join(directory, crypto.createHash('sha256').update(url.href).digest('hex') + extension);
    try {
      const stat = await fs.promises.stat(file);
      if (Date.now() - stat.mtimeMs >= 86400000 && Date.now() - (attempts.get(file) || 0) >= 60000) {
        refresh(url, file, extension).catch(() => {});
      }
      cleanup().catch(() => {});
      const read = () => fs.promises.readFile(file);
      const identity = file + ':' + stat.mtimeMs + ':' + stat.size;
      return { ...(deferBytes ? { read } : { bytes: await read() }), extension, identity };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return refresh(url, file, extension);
  };
}

module.exports = { officialImage, imageStore };
