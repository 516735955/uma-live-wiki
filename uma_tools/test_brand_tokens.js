'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const files = ['app.css', 'music-components.css', 'app.js', '../赛马娘LIVE相关.html'];
const forbidden = ['#3558d8', '#315fc2', '#ff8c1a', '#f58220', '#ff7f18', '#ffad38'];
const failures = [];

files.forEach((file) => {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8').toLowerCase();
  forbidden.forEach((color) => {
    if (source.includes(color)) failures.push(file + ': ' + color);
  });
});

assert.deepStrictEqual(failures, [], 'near-brand colors remain outside the canonical token palette:\n' + failures.join('\n'));
console.log('brand palette ok');
