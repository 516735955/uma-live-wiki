'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const data = require('./data-sync');
const media = require('./media-sync');

const before = [{ id: 'old', title: 'typo', count: 1, accepted: 'original' }];
const incoming = [{ id: 'old', title: 'correct', count: 1, accepted: 'original' }, { id: 'new', title: 'new' }];
const live = [{ id: 'old', title: 'typo', count: 9, accepted: 'runtime correction', extra: 'live only' }, { id: 'automatic', title: 'live addition' }];
const merged = data.merge(before, incoming, live);
assert.deepStrictEqual(merged, [
  { id: 'old', title: 'correct', count: 9, accepted: 'runtime correction', extra: 'live only' },
  { id: 'new', title: 'new' }, { id: 'automatic', title: 'live addition' },
]);
assert.deepStrictEqual(data.merge(before, incoming, merged), merged, 'repeating publication is idempotent');
assert.deepStrictEqual(data.merge({ obsolete: 1, keep: 2 }, { keep: 2 }, { obsolete: 1, keep: 3, extra: 4 }), { keep: 3, extra: 4 });
assert.deepStrictEqual(data.merge([{id:'remove'}], [], [{id:'remove'},{id:'runtime'}]), [{id:'runtime'}]);
assert.deepStrictEqual(data.merge([{id:'restore',title:'old'}], [{id:'restore',title:'new'}], []),
  [{id:'restore',title:'new'}], 'Git-restored changed records retain their identity');
assert.deepStrictEqual(data.merge(['repeat','repeat','old'],['repeat','repeat','new'],['repeat','repeat','old','runtime']),['repeat','repeat','new','runtime']);
const staff = ['anime-s1','anime-s2'].map(work_id => ({work_id,role:'原作',name:'Cygames'}));
assert.deepStrictEqual(data.merge(staff, [...staff].reverse(), staff.map(row => ({...row,note:row.work_id}))).map(row => [row.work_id,row.note]),
  [['anime-s2','anime-s2'],['anime-s1','anime-s1']], 'staff corrections follow the work identity after reordering');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-data-publish-'));
try {
  const directories = ['previous', 'incoming', 'live', 'candidate', 'backup', 'media-backup'].map(name=>path.join(root,name));
  const [previousRoot,incomingRoot,liveRoot,candidateRoot,backupRoot,mediaBackup] = directories;
  for (const directory of directories) fs.mkdirSync(path.join(directory,'data'),{recursive:true});
  function write(directory, file, value) { const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value); }
  write(previousRoot,'data/albums.json','\uFEFF'+JSON.stringify(before));
  write(previousRoot,'data/obsolete.json','{"old":true}');
  write(liveRoot,'data/obsolete.json','{"old":true}');
  write(incomingRoot,'data/albums.json',JSON.stringify(incoming));
  write(liveRoot,'data/albums.json',JSON.stringify(live));
  write(liveRoot,'data/news_snapshot.json','{"live":true}');
  write(incomingRoot,'data/news_snapshot.json','{"old":true}');
  write(previousRoot,'uma_tools/img/a.jpg','old image');
  write(incomingRoot,'uma_tools/img/a.jpg','corrected image');
  write(liveRoot,'uma_tools/img/a.jpg','old image');
  write(liveRoot,'uma_tools/img/runtime.jpg','runtime image');
  data.stage(path.join(incomingRoot,'data'),path.join(previousRoot,'data'),path.join(liveRoot,'data'),path.join(candidateRoot,'data'));
  media.stage(incomingRoot,previousRoot,liveRoot,candidateRoot);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(candidateRoot,'data/albums.json'))),merged);
  assert.strictEqual(fs.readFileSync(path.join(candidateRoot,'data/news_snapshot.json'),'utf8'),'{"live":true}');
  assert.strictEqual(fs.readFileSync(path.join(candidateRoot,'uma_tools/img/a.jpg'),'utf8'),'corrected image');
  assert.strictEqual(fs.readFileSync(path.join(candidateRoot,'uma_tools/img/runtime.jpg'),'utf8'),'runtime image');
  assert.strictEqual(data.publish(path.join(candidateRoot,'data'),path.join(liveRoot,'data'),backupRoot),2);
  assert(!fs.existsSync(path.join(liveRoot,'data/obsolete.json')));
  assert.strictEqual(media.publish(candidateRoot,liveRoot,mediaBackup),2);
  assert.strictEqual(data.publish(path.join(candidateRoot,'data'),path.join(liveRoot,'data'),path.join(root,'repeat')),0);
  data.rollback(path.join(liveRoot,'data'),backupRoot);
  assert(fs.existsSync(path.join(liveRoot,'data/obsolete.json')));
  media.rollback(liveRoot,mediaBackup);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(liveRoot,'data/albums.json'))),live);
  assert.strictEqual(fs.readFileSync(path.join(liveRoot,'uma_tools/img/a.jpg'),'utf8'),'old image');
  write(previousRoot,'uma_tools/img/retired.jpg','retired');
  write(liveRoot,'uma_tools/img/retired.jpg','retired');
  media.stage(incomingRoot,previousRoot,liveRoot,candidateRoot);
  media.publish(candidateRoot,liveRoot,path.join(root,'retirement-start'));
  assert(fs.existsSync(path.join(liveRoot,'uma_tools/img/retired.jpg')), 'deleted Git media remains available during the retention period');
  const retiredFile = path.join(liveRoot,'.media-retired.json');
  const retired = JSON.parse(fs.readFileSync(retiredFile,'utf8'));
  retired['uma_tools/img/retired.jpg'].at -= 8 * 86400000;
  write(liveRoot,'.media-retired.json',JSON.stringify(retired));
  const referenceFile = 'data/retained-media.json';
  write(candidateRoot,referenceFile,JSON.stringify({cover:'/uma_tools/img/retired.jpg'}));
  media.stage(incomingRoot,previousRoot,liveRoot,candidateRoot);
  assert(fs.existsSync(path.join(candidateRoot,'uma_tools/img/retired.jpg')), 'current data references retain retired media after its deadline');
  fs.unlinkSync(path.join(candidateRoot,referenceFile));
  media.stage(incomingRoot,previousRoot,liveRoot,candidateRoot);
  const retiredBackup = path.join(root,'retirement-backup');
  media.publish(candidateRoot,liveRoot,retiredBackup);
  assert(!fs.existsSync(path.join(liveRoot,'uma_tools/img/retired.jpg')), 'unreferenced retired Git media is eventually reclaimed');
  media.rollback(liveRoot,retiredBackup);
  assert(fs.existsSync(path.join(liveRoot,'uma_tools/img/retired.jpg')), 'media reclamation is included in rollback');
  const sheet = 'events/赛马娘LIVE歌单导出.csv';
  const sheetTarget = path.join(root, 'sheet-candidate');
  for (const [directory, contents] of [[previousRoot, 'old,song\n'], [incomingRoot, 'Google,new song\n'], [liveRoot, 'old,song\n']])
    write(directory, 'data/' + sheet, contents);
  data.stage(path.join(incomingRoot,'data'),path.join(previousRoot,'data'),path.join(liveRoot,'data'),sheetTarget);
  assert.strictEqual(fs.readFileSync(path.join(sheetTarget,sheet),'utf8'), 'Google,new song\n', 'a changed Google source reaches the release');
  write(previousRoot, 'data/' + sheet, 'Google,new song\n');
  write(liveRoot, 'data/' + sheet, 'Google,newer runtime song\n');
  const runtimeSheet = path.join(root, 'sheet-runtime');
  data.stage(path.join(incomingRoot,'data'),path.join(previousRoot,'data'),path.join(liveRoot,'data'),runtimeSheet);
  assert.strictEqual(fs.readFileSync(path.join(runtimeSheet,sheet),'utf8'), 'Google,newer runtime song\n', 'an unchanged Git export retains the live Google refresh');
  console.log('field publication, independent runtime facts, media replacement, idempotency and rollback passed');
} finally {fs.rmSync(root,{recursive:true,force:true});}
