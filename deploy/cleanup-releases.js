'use strict';
const fs = require('fs');
const path = require('path');
const [root, current, previous] = process.argv.slice(2);
if (root !== '/var/www/umamusume') throw new Error('Unexpected deployment directory');
const keep = new Set([current, path.basename(previous || '')]);
const assets = new Set();
for (const release of keep) {
  if (!/^[a-f0-9]{40}$/.test(release)) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'releases', release, 'release.json'), 'utf8'));
  Object.values(manifest.assets).forEach((url) => assets.add(path.basename(url)));
}
for (const release of fs.readdirSync(path.join(root, 'releases'))) {
  if (/^[a-f0-9]{40}$/.test(release) && !keep.has(release)) fs.rmSync(path.join(root, 'releases', release), { recursive: true });
}
for (const asset of fs.readdirSync(path.join(root, 'shared/assets'))) {
  const file = path.join(root, 'shared/assets', asset);
  if (/^[a-f0-9]{16}\.(js|css)$/.test(asset) && !assets.has(asset) && Date.now() - fs.statSync(file).mtimeMs > 30 * 86400000) fs.unlinkSync(file);
}
