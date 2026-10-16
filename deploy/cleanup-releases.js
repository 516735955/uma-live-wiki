'use strict';
const fs = require('fs');
const path = require('path');
const [root, current, previous] = process.argv.slice(2);
if (root !== '/var/www/umamusume') throw new Error('Unexpected deployment directory');
const keep = new Set([current, path.basename(previous || '')]);
const slots = path.join(root, 'slots');
if (fs.existsSync(slots)) for (const slot of fs.readdirSync(slots)) {
  try { keep.add(path.basename(fs.realpathSync(path.join(slots, slot)))); } catch (_) {}
}
const assets = new Set();
const datasets = new Set();
for (const release of keep) {
  if (!/^[a-f0-9]{40}$/.test(release)) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'releases', release, 'release.json'), 'utf8'));
  Object.values(manifest.assets).forEach((url) => assets.add(path.basename(url)));
  datasets.add(fs.realpathSync(path.join(root, 'releases', release, 'data')));
}
const datasetRoot = path.join(root, 'shared/datasets');
if (fs.existsSync(datasetRoot)) for (const name of fs.readdirSync(datasetRoot)) {
  const file = path.join(datasetRoot, name);
  if (/^(?:[a-f0-9]{40}-\d+|legacy-[a-f0-9]{40})$/.test(name) && !datasets.has(file)) {
    fs.rmSync(file, {recursive:true, force:true});
    fs.rmSync(file + '.deleted.json', {force:true});
  }
}
const backups = path.join(root, 'shared/backups');
if (fs.existsSync(backups)) {
  const names = fs.readdirSync(backups).filter(name => /^news-\d{8}-\d{6}\.sqlite$/.test(name)).sort().reverse();
  for (const name of names.slice(7)) fs.unlinkSync(path.join(backups, name));
}
for (const release of fs.readdirSync(path.join(root, 'releases'))) {
  if (/^[a-f0-9]{40}$/.test(release) && !keep.has(release)) fs.rmSync(path.join(root, 'releases', release), { recursive: true });
}
for (const asset of fs.readdirSync(path.join(root, 'shared/assets'))) {
  const file = path.join(root, 'shared/assets', asset);
  if (/^[a-f0-9]{16}\.(js|css)$/.test(asset) && !assets.has(asset) && Date.now() - fs.statSync(file).mtimeMs > 30 * 86400000) fs.unlinkSync(file);
}
