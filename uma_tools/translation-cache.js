'use strict';

const fs = require('fs');

class TranslationCache {
  constructor(file) {
    // Resolve the release symlink so atomic replacement updates the shared cache.
    this.file = fs.existsSync(file) ? fs.realpathSync(file) : file;
    this.values = {};
    this.mtime = 0;
    this.reload();
  }
  reload() {
    if (!fs.existsSync(this.file)) return;
    const mtime = fs.statSync(this.file).mtimeMs;
    if (mtime === this.mtime) return;
    this.values = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.mtime = mtime;
  }
  get(key) {
    this.reload();
    return this.values[key];
  }
  set(key, value) {
    // Merge one completed translation into the latest disk contents, never a
    // stale in-memory copy of the whole cache. The service is its sole writer.
    this.reload();
    const next = { ...this.values, [key]: value };
    const temporary = this.file + '.' + process.pid + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 1), { mode: 0o644 });
      fs.renameSync(temporary, this.file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    this.values = next;
    this.mtime = fs.statSync(this.file).mtimeMs;
  }
}

module.exports = { TranslationCache };
