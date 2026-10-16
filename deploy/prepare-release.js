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
  const rewrite = (text) => text.replace(pattern, (url) => build(url.split('?')[0])).replace(
    /\/uma_tools\/img\/[\w./-]+\.(?:png|jpe?g|webp|gif|svg|ico)(?:\?v=[\w.-]+)?/g,
    url => url.split('?')[0] + '?v=' + commit,
  );
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
  let html = rewrite(fs.readFileSync(entry, 'utf8'));
  const styles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(\/assets\/[^" ]+\.css)"\s*>/g)];
  if (styles.length > 1) {
    const css = styles.map(match => fs.readFileSync(path.join(root, match[1]), 'utf8')).join('\n');
    const digest = crypto.createHash('sha256').update(css).digest('hex').slice(0, 16);
    const bundle = '/assets/' + digest + '.css';
    assets['/uma_tools/bundle.css'] = bundle;
    fs.writeFileSync(path.join(root, bundle), css);
    let first = true;
    html = html.replace(/<link\s+rel="stylesheet"\s+href="\/assets\/[^" ]+\.css"\s*>/g, () => {
      if (!first) return '';
      first = false;
      return '<link rel="stylesheet" href="' + bundle + '">';
    });
  }
  const critical = ['/uma_tools/app.js', '/uma_tools/frontend/components.js', '/uma_tools/frontend/view-model.js', '/uma_tools/frontend/pages.js', '/uma_tools/frontend/domains.js'];
  const preloads = critical.filter(url => assets[url]).map(url => '<link rel="modulepreload" href="' + assets[url] + '">').join('\n');
  html = html.replace('</head>', preloads + '\n<meta name="uma-release" content="' + commit + '">\n</head>');
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
