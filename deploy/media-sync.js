'use strict';
const fs = require('fs');
const path = require('path');
const MEDIA = ['album_covers', 'uma_avatars', 'uma_moe', 'uma_official', 'uma_va', 'video_thumbs', 'uma_tools/img', 'data/anime/credit_evidence'];

function images(root) {
  const result = [];
  function visit(directory, name) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = name + '/' + entry.name;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), relative);
      else if (entry.isFile() && /\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/i.test(entry.name)) result.push(relative);
    }
  }
  for (const name of MEDIA) visit(path.join(root, name), name);
  return result;
}
function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target + '.deploy.tmp');
  fs.renameSync(target + '.deploy.tmp', target);
}
function different(first, second) {
  return !fs.existsSync(second) || !fs.readFileSync(first).equals(fs.readFileSync(second));
}
const RETIRED = '.media-retired.json';
function references(root, names) {
  const referenced = new Set();
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'vendor', 'auto_update', 'source_snapshots', RETIRED].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isSymbolicLink() && entry.name === 'data' && directory === root) visit(file);
      else if (entry.isFile() && /\.(?:json|js|html|css)$/.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const name of names) if (text.includes(name) || text.includes(encodeURI(name))) referenced.add(name);
      }
    }
  }
  visit(root);
  return referenced;
}
function stage(incoming, previous, live, candidate) {
  const incomingImages = new Set(images(incoming));
  const previousImages = new Set(images(previous));
  const retiredFile = path.join(live, RETIRED);
  const retired = fs.existsSync(retiredFile) ? JSON.parse(fs.readFileSync(retiredFile, 'utf8')) : {};
  const removed = [];
  for (const name of images(live)) copy(path.join(live, name), path.join(candidate, name));
  for (const name of images(incoming)) {
    if (different(path.join(incoming, name), path.join(previous, name)) || !fs.existsSync(path.join(candidate, name))) {
      copy(path.join(incoming, name), path.join(candidate, name));
    }
  }
  // Keep retired media for seven days so draining browsers and the previous
  // release can still fetch it. Runtime replacements and live references survive.
  for (const name of previousImages) {
    if (incomingImages.has(name)) continue;
    const target = path.join(candidate, name);
    if (!fs.existsSync(target) || different(path.join(previous, name), target)) continue;
    retired[name] ||= { at: Date.now(), bytes: require('crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex') };
  }
  const used = references(candidate, Object.keys(retired));
  for (const [name, row] of Object.entries(retired)) {
    const target = path.join(candidate, name);
    if (incomingImages.has(name) || !fs.existsSync(target) ||
        require('crypto').createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== row.bytes) {
      delete retired[name];
      continue;
    }
    if (used.has(name)) continue;
    if (Date.now() - row.at >= 7 * 86400000) {
      fs.unlinkSync(target);
      removed.push(name);
      delete retired[name];
    }
  }
  fs.writeFileSync(path.join(candidate, RETIRED), JSON.stringify(retired));
  fs.writeFileSync(candidate + '.media-deleted.json', JSON.stringify(removed));
}
function publish(candidate, live, backup) {
  const changes = [];
  fs.mkdirSync(backup, { recursive: true });
  const manifest = path.join(candidate, RETIRED), targetManifest = path.join(live, RETIRED);
  if (fs.existsSync(manifest) && different(manifest, targetManifest)) {
    const existed = fs.existsSync(targetManifest);
    if (existed) copy(targetManifest, path.join(backup, RETIRED));
    changes.push({ name: RETIRED, existed });
    fs.writeFileSync(path.join(backup, 'changes.json'), JSON.stringify(changes));
    copy(manifest, targetManifest);
  }
  const deletedFile = candidate + '.media-deleted.json';
  const deleted = fs.existsSync(deletedFile) ? JSON.parse(fs.readFileSync(deletedFile, 'utf8')) : [];
  for (const name of deleted) {
    const target = path.join(live, name);
    if (!fs.existsSync(target)) continue;
    copy(target, path.join(backup, name));
    changes.push({ name, existed: true });
    fs.writeFileSync(path.join(backup, 'changes.json'), JSON.stringify(changes));
    fs.unlinkSync(target);
  }
  for (const name of images(candidate)) {
    const source = path.join(candidate, name), target = path.join(live, name);
    if (!different(source, target)) continue;
    const existed = fs.existsSync(target);
    if (existed) copy(target, path.join(backup, name));
    changes.push({ name, existed });
    fs.writeFileSync(path.join(backup, 'changes.json'), JSON.stringify(changes));
    copy(source, target);
  }
  return changes.length;
}
function rollback(live, backup) {
  for (const row of JSON.parse(fs.readFileSync(path.join(backup, 'changes.json'), 'utf8')).reverse()) {
    const target = path.join(live, row.name);
    if (row.existed) copy(path.join(backup, row.name), target);
    else if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}
module.exports = { stage, publish, rollback, MEDIA };
if (require.main === module) {
  const [operation, ...args] = process.argv.slice(2);
  if (operation === 'stage') stage(...args);
  else if (operation === 'publish') console.log('Published changed images:', publish(...args));
  else if (operation === 'rollback') rollback(...args);
  else throw new Error('Expected stage, publish or rollback');
}
