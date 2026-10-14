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
      else if (entry.isFile() && /\.(?:png|jpe?g|webp|gif|svg|ico)$/i.test(entry.name)) result.push(relative);
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
function stage(incoming, previous, live, candidate) {
  for (const name of images(live)) copy(path.join(live, name), path.join(candidate, name));
  for (const name of images(incoming)) {
    if (different(path.join(incoming, name), path.join(previous, name)) || !fs.existsSync(path.join(candidate, name))) {
      copy(path.join(incoming, name), path.join(candidate, name));
    }
  }
}
function publish(candidate, live, backup) {
  const changes = [];
  fs.mkdirSync(backup, { recursive: true });
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
