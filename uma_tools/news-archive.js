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
  }
  start() {
    if (this.child) return;
    const child = spawn(process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
      [path.join(__dirname, 'news_database.py'), this.file], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
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
    const failed = () => {
      if (this.child !== child) return;
      this.child = null;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('News archive unavailable')); }
      this.pending.clear();
    };
    child.on('error', failed);
    child.on('exit', failed);
    child.stdin.on('error', failed);
  }
  request(operation, args = {}) {
    this.start();
    if (this.pending.size >= 256) return Promise.reject(new Error('News archive busy'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('News archive deadline'));
      }, 35000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, operation, args }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  close() { if (this.child) this.child.stdin.end(); }
}

module.exports = { NewsArchive };
