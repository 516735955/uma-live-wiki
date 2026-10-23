'use strict';

const path = require('path');
const { execFile } = require('child_process');

function splitHtmlText(source, signal) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
      [path.join(__dirname, 'html_text.py')],
      { signal, timeout: 15000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8',
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } },
      (error, output) => {
        if (error) return reject(new Error('article text parsing failed'));
        try { resolve(JSON.parse(output)); } catch (_) { reject(new Error('article text parsing failed')); }
      });
    child.stdin.on('error', () => {});
    child.stdin.end(source);
  });
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = { splitHtmlText, escapeText };
