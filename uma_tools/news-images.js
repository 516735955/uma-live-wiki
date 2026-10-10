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

function imageStore(directory) {
  const pending = new Map();
  return async function load(value) {
    const url = officialImage(value);
    if (!url) throw new Error('unsupported news image');
    const extension = path.extname(url.pathname).toLowerCase();
    const file = path.join(directory, crypto.createHash('sha256').update(url.href).digest('hex') + extension);
    if (pending.has(file)) return pending.get(file);
    const task = (async () => {
      try {
        const stat = await fs.promises.stat(file);
        if (Date.now() - stat.mtimeMs < 86400000) return { bytes: await fs.promises.readFile(file), extension };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const bytes = await new Promise((resolve, reject) => {
        const request = https.get(url, { family: 4 }, (response) => {
          if (response.statusCode !== 200 || !/^image\/(?:png|jpeg|webp|gif)(?:;|$)/i.test(response.headers['content-type'] || '')) {
            response.resume(); reject(new Error('news image HTTP ' + response.statusCode)); return;
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
        request.setTimeout(15000, () => request.destroy(new Error('news image timeout')));
        request.on('error', reject);
      });
      await fs.promises.mkdir(directory, { recursive: true });
      const temporary = file + '.' + process.pid + '.tmp';
      await fs.promises.writeFile(temporary, bytes);
      await fs.promises.rename(temporary, file);
      return { bytes, extension };
    })();
    pending.set(file, task);
    try { return await task; } finally { pending.delete(file); }
  };
}

module.exports = { officialImage, imageStore };
