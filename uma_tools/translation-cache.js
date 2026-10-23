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
    this.pending = {};
    this.overlay = {};
    this.waiters = [];
    this.flushing = false;
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
    return Object.hasOwn(this.overlay, key) ? this.overlay[key] : this.values[key];
  }
  set(key, value) {
    return this.setMany({ [key]: value });
  }
  setMany(entries) {
    Object.assign(this.pending, entries);
    Object.assign(this.overlay, entries);
    const result = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    if (!this.flushing) {
      this.flushing = true;
      queueMicrotask(() => this.flush());
    }
    return result;
  }
  async flush() {
    try {
      while (this.waiters.length) {
        const entries = this.pending;
        const waiters = this.waiters.splice(0);
        this.pending = {};
        try {
          await this.persist(entries);
          for (const [key, value] of Object.entries(entries)) {
            if (this.overlay[key] === value) delete this.overlay[key];
          }
          waiters.forEach(waiter => waiter.resolve());
        } catch (error) { waiters.forEach(waiter => waiter.reject(error)); }
      }
    } finally { this.flushing = false; }
  }
  async persist(entries) {
    // Serialize the read/merge/rename sequence across blue/green processes.
    // Atomic rename prevents torn files, while this lock prevents lost keys.
    const lock = this.file + '.lock';
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const started = Date.now();
    const owner = process.pid + ':' + started + ':' + Math.random();
    while (true) {
      try { await fs.promises.writeFile(lock, owner, { flag: 'wx' }); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const previous = await fs.promises.stat(lock);
          if (Date.now() - previous.mtimeMs > 30000) await fs.promises.unlink(lock);
        } catch (_) {}
        if (Date.now() - started > 30000) throw new Error('translation cache lock timeout');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    const temporary = this.file + '.' + process.pid + '.tmp';
    try {
      let persisted = this.values;
      try {
        const loaded = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
        if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) persisted = loaded;
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      }
      const next = { ...this.seed, ...persisted, ...entries };
      await fs.promises.writeFile(temporary, JSON.stringify(next, null, 1), { mode: 0o644 });
      await fs.promises.rename(temporary, this.file);
      this.values = next;
      this.mtime = (await fs.promises.stat(this.file)).mtimeMs;
    } finally {
      await fs.promises.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (await fs.promises.readFile(lock, 'utf8').catch(() => '') === owner) await fs.promises.unlink(lock);
    }
  }
}

module.exports = { TranslationCache };
