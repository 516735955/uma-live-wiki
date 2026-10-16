'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { isDeepStrictEqual: equal } = require('util');

const GENERATED = new Set([
  'events_catalog.json', 'song_catalog.json', 'creator_catalog.json',
  'appearance_index.json', 'voice_actor_profiles.json', 'catalog_manifest.json',
  'anime_catalog.json', 'anime_relation_index.json', 'pedigree_data.js',
  'character_pedigree_meta.js',
]);
const RUNTIME = new Set(['news_snapshot.json', 'lantis_news.json', 'music/source_status.json']);

function files(root) {
  const result = [];
  function visit(directory, prefix = '') {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory() && !/^(?:auto_update|horses_cache|news_image_cache|anime\/source_snapshots)(?:\/|$)/.test(name)) {
        visit(path.join(directory, entry.name), name + '/');
      } else if (entry.isFile() && /\.(?:json|js)$/.test(name)) result.push(name);
    }
  }
  visit(root);
  return result.sort();
}

function read(file) {
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (file.endsWith('.js')) {
    const match = text.match(/^\s*window\.(\w+)\s*=\s*([\s\S]*?)\s*;?\s*$/);
    if (!match) throw new Error('Unrecognized data assignment: ' + path.basename(file));
    let value;
    try { value = JSON.parse(match[2]); }
    catch (error) {
      // Historical committed character files use single-quoted object keys.
      const context = { window: {} };
      vm.runInNewContext(text, context, { timeout: 1000 });
      value = JSON.parse(JSON.stringify(context.window[match[1]]));
    }
    return { value, global: match[1] };
  }
  return { value: JSON.parse(text) };
}

function identity(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return JSON.stringify(row);
  for (const key of ['id', 'cid', 'announce_id', 'output', 'version_id', 'catalog', 'link']) {
    if (row[key] !== undefined && row[key] !== '') return key + ':' + row[key];
  }
  if (row.work_id && row.number !== undefined) return 'episode:' + row.work_id + ':' + row.number;
  if (row.unit_id && row.role && row.name) return JSON.stringify([row.unit_id, row.role, row.name, row.group || '']);
  if (row.role && (row.creator_id || row.name)) return JSON.stringify([row.role, row.creator_id || row.name]);
  if (row.work_id) return 'work:' + row.work_id;
  if (row.url) return 'url:' + row.url;
  return JSON.stringify(row);
}

// Only Git-changed fields replace live values. Unchanged source fields and
// records that the running updater added remain exactly as they were.
function merge(previous, incoming, live) {
  if (equal(previous, incoming)) return live;
  if (incoming === undefined) return undefined;
  // A changed record restored from Git needs its complete identity, not a
  // field-only patch applied to an absent live object.
  if (live === undefined) return structuredClone(incoming);
  if (Array.isArray(incoming) && Array.isArray(previous) && Array.isArray(live)) {
    function keyed(rows) {
      const occurrences = new Map();
      return new Map(rows.map(row => {
        const key = identity(row), ordinal = occurrences.get(key) || 0;
        occurrences.set(key, ordinal + 1);
        return [key + '#' + ordinal, row];
      }));
    }
    const before = keyed(previous), after = keyed(incoming), current = keyed(live);
    const result = [];
    for (const [key, row] of after) {
      const next = merge(before.get(key), row, current.get(key));
      if (next !== undefined) result.push(next);
    }
    for (const [key,row] of current) if (!before.has(key) && !after.has(key)) result.push(row);
    return result;
  }
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    const old = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
    const result = live && typeof live === 'object' && !Array.isArray(live) ? { ...live } : {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(incoming)])) {
      if (equal(old[key], incoming[key])) continue;
      const value = merge(old[key], incoming[key], result[key]);
      if (value === undefined) delete result[key]; else result[key] = value;
    }
    return result;
  }
  return incoming;
}

function write(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.deploy.tmp';
  const payload = JSON.stringify(document.value, null, 2);
  try {
    fs.writeFileSync(temporary, (document.global ? 'window.' + document.global + ' = ' + payload + ';' : payload) + '\n');
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function stage(incomingRoot, previousRoot, liveRoot, candidateRoot) {
  fs.cpSync(fs.realpathSync(liveRoot), candidateRoot, { recursive: true });
  const removed = [];
  for (const name of new Set([...files(previousRoot), ...files(incomingRoot)])) {
    if (GENERATED.has(name) || RUNTIME.has(name) || name.startsWith('anime/source_snapshots/')) continue;
    const incoming = read(path.join(incomingRoot, name));
    const previous = read(path.join(previousRoot, name));
    const live = read(path.join(liveRoot, name));
    if (!incoming) {
      if (previous && fs.existsSync(path.join(candidateRoot, name))) {
        fs.unlinkSync(path.join(candidateRoot, name));
        removed.push(name);
      }
      continue;
    }
    const value = live ? merge(previous?.value, incoming.value, live.value) : incoming.value;
    if (value !== undefined && (!live || !equal(value, live.value))) write(path.join(candidateRoot, name), { ...incoming, value });
  }
  fs.writeFileSync(candidateRoot + '.deleted.json', JSON.stringify(removed));
}

function publish(candidateRoot, liveRoot, backupRoot) {
  fs.mkdirSync(backupRoot, { recursive: true });
  const changes = [];
  const deletedFile = candidateRoot + '.deleted.json';
  const deleted = fs.existsSync(deletedFile) ? JSON.parse(fs.readFileSync(deletedFile, 'utf8')) : [];
  for (const name of deleted) {
    const live = path.join(liveRoot, name), backup = path.join(backupRoot, name);
    if (!fs.existsSync(live)) continue;
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(live, backup);
    changes.push({ name, existed: true });
    fs.writeFileSync(path.join(backupRoot, 'changes.json'), JSON.stringify(changes));
    fs.unlinkSync(live);
  }
  for (const name of files(candidateRoot)) {
    if (RUNTIME.has(name) || name.startsWith('auto_update/') || name.startsWith('anime/source_snapshots/')) continue;
    const candidate = path.join(candidateRoot, name), live = path.join(liveRoot, name);
    if (fs.existsSync(live) && fs.readFileSync(candidate).equals(fs.readFileSync(live))) continue;
    const backup = path.join(backupRoot, name);
    if (fs.existsSync(live)) { fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(live, backup); }
    changes.push({ name, existed: fs.existsSync(live) });
    fs.writeFileSync(path.join(backupRoot, 'changes.json'), JSON.stringify(changes));
    fs.mkdirSync(path.dirname(live), { recursive: true });
    fs.copyFileSync(candidate, live + '.deploy.tmp');
    fs.renameSync(live + '.deploy.tmp', live);
  }
  return changes.length;
}

function rollback(liveRoot, backupRoot) {
  const changes = JSON.parse(fs.readFileSync(path.join(backupRoot, 'changes.json'), 'utf8'));
  for (const row of changes.reverse()) {
    const file = path.join(liveRoot, row.name);
    if (row.existed) { fs.copyFileSync(path.join(backupRoot, row.name), file + '.deploy.tmp'); fs.renameSync(file + '.deploy.tmp', file); }
    else if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

module.exports = { merge, stage, publish, rollback, files, GENERATED };
if (require.main === module) {
  const [operation, ...arguments_] = process.argv.slice(2);
  if (operation === 'stage') stage(...arguments_);
  else if (operation === 'publish') console.log('Published structured files:', publish(...arguments_));
  else if (operation === 'rollback') rollback(...arguments_);
  else throw new Error('Expected stage, publish or rollback');
}
