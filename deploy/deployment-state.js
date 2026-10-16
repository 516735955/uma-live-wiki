'use strict';
const fs = require('fs');
const path = require('path');
const localContent = path.join(__dirname, 'news-content.js');
const { mergeNews } = require(fs.existsSync(localContent) ? localContent : '../uma_tools/news-content');

function atomicFile(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
}
function link(target, file) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.' + process.pid + '.next';
  fs.symlinkSync(target, temporary, 'dir');
  fs.renameSync(temporary, file);
}
function read(root) {
  const file = path.join(root, 'shared/deployment.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const release = fs.realpathSync(path.join(root, 'current'));
  const commit = JSON.parse(fs.readFileSync(path.join(release, 'release.json'), 'utf8')).commit;
  return {active: {release, commit, port: 8080, service: 'umamusume.service'}, previous: null};
}
function initialize(root) {
  const state = read(root);
  const shared = path.join(root, 'shared');
  const data = path.join(shared, 'data');
  fs.mkdirSync(path.join(shared, 'datasets'), {recursive: true});
  if (!fs.lstatSync(data).isSymbolicLink()) {
    const legacy = path.join(shared, 'datasets', 'legacy-' + state.active.commit);
    fs.renameSync(data, legacy);
    link(legacy, data);
  }
  const generation = fs.realpathSync(data);
  // The old process retains its complete generation while the next is built.
  link(generation, path.join(state.active.release, 'data'));
  const runtime = path.join(shared, 'runtime');
  fs.mkdirSync(runtime, {recursive: true});
  for (const name of ['auto_update', 'horses_cache', 'news_image_cache']) {
    const source = path.join(generation, name), target = path.join(runtime, name);
    if (!fs.existsSync(target)) {
      if (fs.existsSync(source)) fs.renameSync(source, target);
      else fs.mkdirSync(target, {recursive: true});
    }
    if (!fs.existsSync(source) || !fs.lstatSync(source).isSymbolicLink()) {
      if (fs.existsSync(source)) throw new Error('Unmerged runtime directory: ' + name);
      link(target, source);
    }
  }
  for (const name of ['news_snapshot.json', 'lantis_news.json']) {
    const source = path.join(generation, name), target = path.join(runtime, name);
    if (!fs.existsSync(target) && fs.existsSync(source)) fs.copyFileSync(source, target);
  }
  atomicFile(path.join(shared, 'deployment.json'), JSON.stringify(state, null, 2) + '\n');
  return state;
}
function prepareData(root, generation) {
  const runtime = path.join(root, 'shared/runtime');
  for (const name of ['auto_update', 'horses_cache', 'news_image_cache', 'news_snapshot.json', 'lantis_news.json']) {
    const file = path.join(generation, name);
    fs.rmSync(file, {recursive: true, force: true});
    link(path.join(runtime, name), file);
  }
}
function apply(root, state) {
  const active = state.active;
  if (!/^[a-f0-9]{40}$/.test(active.commit) || ![8080,8081].includes(active.port) ||
      !/^umamusume(?:@808[01])?\.service$/.test(active.service) ||
      path.dirname(active.release) !== path.join(root, 'releases')) throw new Error('Invalid deployment state');
  link(fs.realpathSync(path.join(active.release, 'data')), path.join(root, 'shared/data'));
  link(active.release, path.join(root, 'current'));
  atomicFile(path.join(root, 'shared/active-release'), active.release + ':' + active.port + '\n');
  atomicFile(path.join(root, 'shared/deployment.json'), JSON.stringify(state, null, 2) + '\n');
}
function activate(root, release, port) {
  const old = read(root);
  const commit = JSON.parse(fs.readFileSync(path.join(release, 'release.json'), 'utf8')).commit;
  const state = {active: {release, commit, port: Number(port), service: 'umamusume@' + port + '.service'}, previous: old.active};
  apply(root, state);
  return state;
}
function mergeLegacyNews(root, release) {
  const runtime = path.join(root, 'shared/runtime');
  for (const name of ['news_snapshot.json', 'lantis_news.json']) {
    const source = path.join(release, 'data', name), target = path.join(runtime, name);
    if (!fs.existsSync(source) || !fs.existsSync(target) || fs.realpathSync(source) === fs.realpathSync(target)) continue;
    const older = JSON.parse(fs.readFileSync(source, 'utf8')), newer = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (name === 'lantis_news.json') {
      const rows = new Map(older.map(row => [row.id,row]));
      newer.forEach(row => rows.set(row.id, {...rows.get(row.id), ...row}));
      atomicFile(target, JSON.stringify([...rows.values()]));
    } else {
      const rows = mergeNews(older.information_list || [], newer.information_list || []);
      atomicFile(target, JSON.stringify({...newer, information_list: rows, generated_at: new Date().toISOString()}));
    }
  }
}
module.exports = {read, initialize, prepareData, apply, activate, mergeLegacyNews};
if (require.main === module) {
  const [operation, root, ...args] = process.argv.slice(2);
  let result;
  if (operation === 'read') result = read(root);
  else if (operation === 'initialize') result = initialize(root);
  else if (operation === 'prepare-data') prepareData(root, args[0]);
  else if (operation === 'activate') result = activate(root, ...args);
  else if (operation === 'restore') apply(root, JSON.parse(fs.readFileSync(args[0], 'utf8')));
  else if (operation === 'merge-legacy-news') mergeLegacyNews(root, args[0]);
  else throw new Error('Unknown deployment state operation');
  if (result) console.log(JSON.stringify(result));
}
