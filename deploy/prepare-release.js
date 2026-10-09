'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function prepareRelease(root, commit, ancestors = []) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('A full Git commit is required');
  const entry = path.join(root, '赛马娘LIVE相关.html');
  const assets = {};
  const visiting = new Set();
  const pattern = /\/uma_tools\/[\w./-]+\.(?:js|css)(?:\?v=[\w.-]+)?/g;
  const output = path.join(root, 'assets');
  fs.mkdirSync(output, { recursive: true });
  const rewrite = (text) => text.replace(pattern, (url) => build(url.split('?')[0]));
  function build(url) {
    if (assets[url]) return assets[url];
    if (visiting.has(url)) throw new Error('Circular asset dependency: ' + url);
    visiting.add(url);
    const file = path.join(root, url.slice(1));
    const source = fs.readFileSync(file, 'utf8');
    const transformed = rewrite(source).replace(/(\/data\/[\w./-]+\.js)\?v=[\w.-]+/g, '$1');
    const digest = crypto.createHash('sha256').update(transformed).digest('hex').slice(0, 16);
    const target = digest + path.extname(file);
    fs.writeFileSync(path.join(output, target), transformed);
    assets[url] = '/assets/' + target;
    visiting.delete(url);
    return assets[url];
  }
  const html = rewrite(fs.readFileSync(entry, 'utf8')).replace('</head>', '<meta name="uma-release" content="' + commit + '">\n</head>');
  fs.writeFileSync(entry, html);
  fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify({ commit, ancestors, assets }, null, 2) + '\n');
  return { commit, assets };
}

module.exports = { prepareRelease };
if (require.main === module) {
  const [root, commit, history] = process.argv.slice(2);
  const ancestors = history ? fs.readFileSync(history, 'utf8').trim().split('\n') : [];
  const release = prepareRelease(path.resolve(root), commit, ancestors);
  console.log('Prepared ' + release.commit + ', ' + Object.keys(release.assets).length + ' immutable assets');
}
