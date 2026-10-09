'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function loadTerms(root) {
  const names = new Map([
    ['ウマ娘 プリティーダービー', '赛马娘 Pretty Derby'],
    ['ウマ娘', '赛马娘'],
    ['レジェンドレース', '传奇赛事'],
    ['育成シナリオ', '育成剧本']
  ]);
  const add = (ja, zh) => {
    if (ja && zh && ja !== zh && ja.length >= 2) names.set(ja, zh);
  };
  const index = fs.readFileSync(path.join(root, 'data/character_index_data.js'), 'utf8');
  JSON.parse(index.slice(index.indexOf('['), index.lastIndexOf(']') + 1)).forEach((item) => add(item.ja, item.zh));
  const voices = readJson(path.join(root, 'data/voice_actor_profiles.json'));
  voices.voice_actors.forEach((item) => add(item.identity.ja, item.identity.zh));
  return Array.from(names, ([ja, zh]) => ({ ja, zh })).sort((a, b) => b.ja.length - a.ja.length || a.ja.localeCompare(b.ja));
}

function createTerms(terms) {
  const byName = new Map(terms.map((term) => [term.ja, term.zh]));
  const pattern = new RegExp(terms.map((term) => term.ja.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const revision = crypto.createHash('sha256').update(JSON.stringify(terms)).digest('hex').slice(0, 12);
  return {
    revision,
    protect(source, namespace = '') {
      const replacements = [];
      const text = String(source).replace(pattern, (name) => {
        const token = 'ZXQNAME' + namespace + String(replacements.length).padStart(4, '0') + 'QXZ';
        replacements.push({ token, value: byName.get(name) });
        return token;
      });
      return {
        text, count: replacements.length,
        restore(translated) {
          let value = String(translated || '');
          for (const replacement of replacements) {
            if (value.split(replacement.token).length !== 2) return null;
            value = value.replace(replacement.token, replacement.value);
          }
          return /ZXQNAME\d+QXZ/.test(value) ? null : value;
        }
      };
    }
  };
}

module.exports = { loadTerms, createTerms, readJson };
