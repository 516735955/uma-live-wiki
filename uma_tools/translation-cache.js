'use strict';

const fs = require('fs');
const path = require('path');

class TranslationCache {
  constructor(file, seedFile) {
    // Resolve the release symlink so atomic replacement updates the shared cache.
    this.file = fs.existsSync(file) ? fs.realpathSync(file) : file;
    this.seed = {};
    if (seedFile && fs.existsSync(seedFile)) {
      try { this.seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')); }
      catch (_) { console.warn('Translation seed is unreadable; using runtime cache.'); }
    }
    this.values = { ...this.seed };
    this.mtime = 0;
    this.checkedAt = 0;
    this.reload();
  }
  reload(force = false) {
    if (!force && Date.now() - this.checkedAt < 1000) return;
    this.checkedAt = Date.now();
    if (!fs.existsSync(this.file)) return;
    const mtime = fs.statSync(this.file).mtimeMs;
    if (mtime === this.mtime) return;
    try {
      const values = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid translation cache');
      this.values = { ...this.seed, ...values };
    } catch (_) {
      console.warn('Translation cache is unreadable; keeping the last usable translations.');
    }
    this.mtime = mtime;
  }
  get(key) {
    this.reload();
    return this.values[key];
  }
  set(key, value) {
    this.setMany({ [key]: value });
  }
  setMany(entries) {
    // Serialize the read/merge/rename sequence across blue/green processes.
    // Atomic rename prevents torn files, while this lock prevents lost keys.
    const lock = this.file + '.lock';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const started = Date.now();
    while (true) {
      try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock);
        } catch (_) {}
        if (Date.now() - started > 30000) throw new Error('translation cache lock timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    const temporary = this.file + '.' + process.pid + '.tmp';
    try {
      this.reload(true);
      const next = { ...this.values, ...entries };
      fs.writeFileSync(temporary, JSON.stringify(next, null, 1), { mode: 0o644 });
      fs.renameSync(temporary, this.file);
      this.values = next;
      this.mtime = fs.statSync(this.file).mtimeMs;
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (fs.existsSync(lock)) fs.unlinkSync(lock);
    }
  }
}

module.exports = { TranslationCache };
