'use strict';
const fs = require('fs');
const path = require('path');

class HorseStore {
  constructor(directory) { this.directory = directory; this.snapshots = new Map(); }
  async read(file) {
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
    const all = snapshot.value;
    if (!Array.isArray(all)) throw new Error('Invalid horse index');
    const rows = all.filter(row => !query || [row.zh,row.ja,row.en,row.born,row.birthdate].some(value => String(value || '').normalize('NFKC').toLowerCase().includes(query)));
    const size = params.get('scope') === 'index' ? Math.max(1, rows.length) : Math.min(100, Math.max(1, parseInt(params.get('page_size'), 10) || 30));
    const page = Math.min(Math.max(1, Math.ceil(rows.length / size)), Math.max(1, parseInt(params.get('page'),10) || 1));
    return {build_id:snapshot.signature,items:rows.slice((page-1)*size,page*size),total:rows.length,page,page_size:size};
  }
  async detail(id) {
    const snapshot = await this.read('horses_details.js');
    const horse = snapshot.value[id];
    return horse ? {build_id:snapshot.signature,horse} : null;
  }
}
module.exports = {HorseStore};
