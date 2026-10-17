'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { createInterface } = require('readline');

/** One bounded asynchronous bridge to the standard-library SQLite archive. */
class NewsArchive {
  constructor(directory) {
    this.file = process.env.NEWS_ARCHIVE_FILE || path.join(directory, 'auto_update', 'news.sqlite');
    this.pending = new Map();
    this.sequence = 0;
    this.blocked = false;
  }
  start() {
    if (this.child) return;
    const child = spawn(process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
      [path.join(__dirname, 'news_database.py'), this.file], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      });
    this.child = child;
    this.blocked = false;
    createInterface({ input: child.stdout }).on('line', line => {
      let response;
      try { response = JSON.parse(line); } catch (_) { return; }
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.error) entry.reject(new Error(response.error));
      else entry.resolve(response.result);
    });
    child.stderr.on('data', () => {});
    const failed = (reason = new Error('News archive unavailable')) => {
      if (this.child !== child) return;
      this.child = null;
      this.blocked = false;
      child.stdin.destroy();
      child.kill();
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(reason instanceof Error ? reason : new Error('News archive unavailable')); }
      this.pending.clear();
    };
    child.on('error', failed);
    child.on('exit', failed);
    child.stdin.on('error', failed);
    child.stdin.on('drain', () => { if (this.child === child) this.blocked = false; });
    this.fail = failed;
  }
  request(operation, args = {}) {
    this.start();
    if (this.pending.size >= 256 || this.blocked) return Promise.reject(new Error('News archive busy'));
    const id = ++this.sequence;
    const child = this.child;
    const message = JSON.stringify({ id, operation, args }) + '\n';
    if (Buffer.byteLength(message) > 8 * 1024 * 1024) return Promise.reject(new Error('News archive request too large'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.child === child) this.fail(new Error('News archive deadline'));
      }, 35000);
      this.pending.set(id, { resolve, reject, timer });
      const ready = child.stdin.write(message, error => {
        if (error && this.child === child) this.fail(error);
      });
      if (!ready) this.blocked = true;
    });
  }
  close() { if (this.child) this.child.stdin.end(); }
}

module.exports = { NewsArchive };
