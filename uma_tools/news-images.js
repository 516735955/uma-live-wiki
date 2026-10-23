'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { ImageJobs } = require('./image-jobs');
const { execFile } = require('child_process');
const identities = new Map(), accesses = new Map();
function touchImage(file) {
  accesses.delete(file);
  accesses.set(file, Date.now());
  if (accesses.size > 8192) accesses.delete(accesses.keys().next().value);
}
function imageAccess(file, stat) { return accesses.get(file) || stat.mtimeMs; }
function validImageBytes(bytes, contentType) {
  const type = String(contentType || '').split(';', 1)[0].toLowerCase();
  if (type === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'binary'));
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (type === 'image/gif') return bytes.length >= 6 && (bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a');
  return false;
}
async function verifyImageBytes(bytes) {
  const python = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
  const script = "import io,sys,warnings; from PIL import Image; Image.MAX_IMAGE_PIXELS=40000000; warnings.simplefilter('error', Image.DecompressionBombWarning); raw=sys.stdin.buffer.read(); Image.open(io.BytesIO(raw)).verify(); im=Image.open(io.BytesIO(raw)); im.seek(0); im.convert('RGBA').load()";
  await new Promise((resolve, reject) => {
    const child = execFile(python, ['-c', script], {
      encoding: 'buffer', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
    }, error => error ? reject(error) : resolve());
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}
async function fileIdentity(file, stat, read) {
  const key = file + ':' + stat.ino + ':' + stat.mtimeMs + ':' + stat.size;
  if (!identities.has(key)) {
    const task = Promise.resolve().then(read).then(bytes => crypto.createHash('sha256').update(bytes).digest('hex'));
    identities.set(key, task);
    task.catch(() => identities.delete(key));
    if (identities.size > 2048) identities.delete(identities.keys().next().value);
  }
  return identities.get(key);
}

async function readSnapshot(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (!result.bytesRead) throw new Error('image changed while reading');
    offset += result.bytesRead;
  }
  return bytes;
}

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
  const pending = new Map(), attempts = new Map(), invalidated = new Map();
  const jobs = new ImageJobs(4);
  const capacity = Number(options.capacity || process.env.NEWS_IMAGE_CACHE_BYTES) || 256 * 1024 * 1024;
  let lastCleanup = 0;
  async function cleanup() {
    if (Date.now() - lastCleanup < 60000) return;
    lastCleanup = Date.now();
    for (const [file, attemptedAt] of attempts) {
      if (!pending.has(file) && Date.now() - attemptedAt >= 60000) attempts.delete(file);
    }
    for (const [file, at] of invalidated) if (!pending.has(file) && Date.now() - at >= 60000) invalidated.delete(file);
    const names = await fs.promises.readdir(directory).catch(() => []);
    const rows = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.(?:png|jpe?g|webp|gif)$/.test(name)).map(async name => {
      const file = path.join(directory, name);
      const stat = await fs.promises.stat(file).catch(() => null);
      return stat && { file, size: stat.size, at: imageAccess(file, stat) };
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
  async function refresh(url, file, extension, signal) {
    if (!jobs.jobs.has(file) && Date.now() - (attempts.get(file) || 0) < 60000) throw new Error('news image retry deferred');
    const task = jobs.run(file, async (workSignal, deadline) => {
      attempts.set(file, Date.now());
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
          response.on('end', () => {
            const bytes = Buffer.concat(chunks);
            if (!validImageBytes(bytes, response.headers['content-type'])) {
              const error = new Error('news image content is not a valid image');
              error.code = 'INVALID_IMAGE';
              reject(error);
              return;
            }
            verifyImageBytes(bytes).then(() => resolve(bytes), error => {
              error.code = 'INVALID_IMAGE';
              reject(error);
            });
          });
          response.on('error', reject);
          response.on('aborted', () => reject(new Error('news image response aborted')));
        });
        // A progressing image download can exceed 15 seconds on agency hosts.
        // Stop stalled sockets promptly and keep a separate total deadline.
        request.setTimeout(15000, () => request.destroy(new Error('news image stalled')));
        const abort = () => request.destroy(workSignal.reason || new Error('image cancelled'));
        workSignal.addEventListener('abort', abort, { once: true });
        if (workSignal.aborted) abort();
        timer = setTimeout(() => request.destroy(new Error('news image timeout')), Math.max(1, deadline - Date.now()));
        request.on('error', reject);
        request.on('close', () => { clearTimeout(timer); workSignal.removeEventListener('abort', abort); });
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
      const stat = await fs.promises.stat(file);
      touchImage(file);
      return { bytes, extension, identity: crypto.createHash('sha256').update(bytes).digest('hex'), invalidate: () => invalidate(file, stat) };
    }, signal, 90000);
    pending.set(file, task);
    try { return await task; }
    catch (error) { if (/image cancelled/.test(error.message)) attempts.delete(file); throw error; }
    finally { if (pending.get(file) === task) pending.delete(file); await cleanup(); }
  }
  async function invalidate(file, snapshot) {
    const current = await fs.promises.stat(file).catch(() => null);
    if (current && current.ino === snapshot.ino && current.mtimeMs === snapshot.mtimeMs && current.size === snapshot.size) await fs.promises.unlink(file).catch(() => {});
    if (Date.now() - (invalidated.get(file) || 0) >= 60000) {
      invalidated.set(file, Date.now());
      attempts.delete(file);
    }
  }
  return async function load(value, { deferBytes = false, signal } = {}) {
    const url = validateUrl(value);
    if (!url) throw new Error('unsupported news image');
    const extension = path.extname(url.pathname).toLowerCase();
    const file = path.join(directory, crypto.createHash('sha256').update(url.href).digest('hex') + extension);
    try {
      const handle = await fs.promises.open(file, 'r');
      let returned = false;
      try {
      const stat = await handle.stat();
      if (stat.size > 8 * 1024 * 1024) throw new Error('news image too large');
      touchImage(file);
      if (Date.now() - stat.mtimeMs >= 86400000 && Date.now() - (attempts.get(file) || 0) >= 60000) {
        refresh(url, file, extension).catch(() => {});
      }
      cleanup().catch(() => {});
      let closed = false;
      const dispose = async () => { if (!closed) { closed = true; await handle.close(); } };
      const snapshot = () => readSnapshot(handle, stat.size);
      const identity = await fileIdentity(file, stat, snapshot);
      const read = async () => { try { return await snapshot(); } finally { await dispose(); } };
      const result = { ...(deferBytes ? { read, dispose } : { bytes: await read() }), extension, identity, invalidate: () => invalidate(file, stat) };
      returned = true;
      return result;
      } finally { if (!returned) await handle.close(); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return refresh(url, file, extension, signal);
  };
}

module.exports = { officialImage, imageStore, fileIdentity, readSnapshot, touchImage, imageAccess };
