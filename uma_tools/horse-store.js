'use strict';
const fs = require('fs');
const path = require('path');

class HorseStore {
  constructor(directory) { this.directory = directory; this.snapshots = new Map(); this.pending = new Map(); }
  async read(file) {
    if (this.pending.has(file)) return this.pending.get(file);
    const pending = this.load(file).finally(() => this.pending.delete(file));
    this.pending.set(file, pending);
    return pending;
  }
  async load(file) {
    const cached = this.snapshots.get(file);
    try {
      const location = path.join(this.directory, file);
      const stat = await fs.promises.stat(location);
      const signature = stat.mtimeMs + ':' + stat.size;
      if (cached?.signature === signature) return cached;
      const text = await fs.promises.readFile(location, 'utf8');
      const value = JSON.parse(text.slice(text.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
      if (!value || typeof value !== 'object') throw new Error('Invalid horse data');
      if (file === 'horses_list.js' ? !Array.isArray(value) || !value.every(row => typeof row.id === 'string') : Array.isArray(value) || !Object.entries(value).every(([id, row]) => row?.id === id)) throw new Error('Invalid horse records');
      const snapshot = {signature, value};
      this.snapshots.set(file, snapshot);
      return snapshot;
    } catch (error) { this.lastError = error; if (cached) return cached; throw error; }
  }
  async index(params) {
    const snapshot = await this.read('horses_list.js');
    const query = String(params.get('q') || '').normalize('NFKC').toLowerCase().trim();
    const sex = ['male','female','gelding'].includes(params.get('sex')) ? params.get('sex') : '';
    const sort = ['oldest','name'].includes(params.get('sort')) ? params.get('sort') : 'newest';
    const all = snapshot.value;
    if (!Array.isArray(all)) throw new Error('Invalid horse index');
    let rows = all.filter(row => !query || [row.zh,row.ja,row.en,row.born,row.birthdate].some(value => String(value || '').normalize('NFKC').toLowerCase().includes(query)));
    if (sex) rows = rows.filter(row => row.sex === sex);
    const birthValue = row => {
      const raw = String(row.birthdate || row.born || '');
      const y = raw.match(/(\d{4})/);
      if (!y) return null;
      const md = raw.slice(y.index + 4).match(/[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
      return Number(y[1]) * 10000 + (md ? Number(md[1]) * 100 + Number(md[2]) : 0);
    };
    const nameKey = row => String(row.zh || row.ja || row.en || '');
    rows = rows.slice().sort((a, b) => {
      if (sort === 'name') return nameKey(a).localeCompare(nameKey(b), 'zh');
      const va = birthValue(a), vb = birthValue(b);
      if (va == null && vb != null) return 1;
      if (va != null && vb == null) return -1;
      if (va === vb) return nameKey(a).localeCompare(nameKey(b), 'zh');
      return sort === 'oldest' ? va - vb : vb - va;
    });
    const size = params.get('scope') === 'index' ? Math.max(1, rows.length) : Math.min(100, Math.max(1, parseInt(params.get('page_size'), 10) || 30));
    const page = Math.min(Math.max(1, Math.ceil(rows.length / size)), Math.max(1, parseInt(params.get('page'),10) || 1));
    return {build_id:snapshot.signature,items:rows.slice((page-1)*size,page*size),total:rows.length,page,page_size:size};
  }
  async detail(id) {
    const snapshot = await this.read('horses_details.js');
    const horse = Object.hasOwn(snapshot.value, id) ? snapshot.value[id] : null;
    return horse ? {build_id:snapshot.signature,horse} : null;
  }
}
module.exports = {HorseStore};
