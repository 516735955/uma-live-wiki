const assert = require('node:assert/strict');
const {groupInstitutions, countLabel} = require('./anime-staff');

const credits = [
  {organization:'Studio A'},
  {person_id:'one', name:'One', institutions:['Studio A']},
  {person_id:'two', name:'Two', institutions:['Studio A']},
  {person_id:'three', name:'Three'},
  {organization:'Studio B'},
  {person_id:'four', name:'Four', institutions:['Studio B']},
  {organization:'Studio C'}
];
const snapshot = JSON.stringify(credits);
const groups = groupInstitutions(credits);
assert.deepEqual(groups.map(group => [group.institutions,group.rows.map(row => row.person_id)]), [
  [['Studio A'],['one','two']], [[],['three']], [['Studio B'],['four']], [['Studio C'],[]]
]);
assert.equal(JSON.stringify(credits),snapshot);
assert.equal(countLabel(credits),'4 位 · 3 家');

const episode = number => ({id:`episode-${number}`,number});
const participation = [
  {entry:credits[0], units:[episode(1),episode(2)]},
  {entry:credits[1], units:[episode(1)]},
  {entry:{...credits[1],institutions:['Studio B']}, units:[episode(3)]},
  {entry:credits[3], units:[episode(2)]}
];
const participationGroups = groupInstitutions(participation,row => row.entry);
assert.deepEqual(participationGroups.map(group => [group.institutions,group.rows.map(row => row.units.map(unit => unit.number))]), [
  [['Studio A'],[[1]]], [['Studio B'],[[3]]], [[],[[2]]]
]);
assert.deepEqual(participationGroups[0].organizationUnits.map(unit => unit.number),[2]);
assert.equal(countLabel(participation,row => row.entry),'2 位 · 2 家');

const catalog = require('../data/anime_catalog.json');
const secondKey = catalog.staff.filter(row => row.unit_id === 'anime-s3-e13' && row.role === '第二原画');
const checked = groupInstitutions(secondKey);
assert.equal(checked.filter(group => group.institutions.includes('スタジオKAI')).length,1);
assert.equal(checked.find(group => group.institutions.includes('スタジオKAI')).rows.length,5);
assert.equal(checked.find(group => !group.institutions.length).rows.length,13);
assert.equal(checked.find(group => group.institutions.includes('ピー・アール・エー作画部')).rows[0].name,'桑原愛');
assert.ok(catalog.staff.every(row => !(row.person_id && row.organization)));
console.log('Staff institution boundaries and episode participation passed.');
