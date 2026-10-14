'use strict';

const fs = require('fs');
const path = require('path');

const PRIVATE_FIELDS = new Set(['source_refs', 'source_ref', 'evidence_refs', 'source_time',
  'asset_sources', 'photo_source_ref', 'profile_source_refs', 'role_raw', 'group_raw',
  'institutions_raw', 'organization_raw', 'transcribed_name', 'credited_name',
  'credited_institutions', 'staff_status', 'cast_status', 'cover_source_ref', 'note']);

function displayData(value) {
  if (Array.isArray(value)) return value.map(displayData);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_FIELDS.has(key))
    .map(([key, item]) => [key, displayData(item)]));
}

function select(row, keys) {
  return Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
}

function unitSummary(unit) {
  return select(unit, ['id', 'work_id', 'number', 'label', 'unit_type', 'title_zh', 'title_ja',
    'release_date', 'status', 'cover']);
}

function workSummary(work) {
  return select(work, ['id', 'title_zh', 'title_ja', 'aliases', 'format', 'series', 'status',
    'start_date', 'end_date', 'cover', 'film_cover', 'unit_count', 'released_count']);
}

class AnimeStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'anime_catalog.json');
    this.signature = '';
    this.pending = null;
    this.catalog = null;
    this.responses = new Map();
  }

  async load() {
    try { return await this.reload(); }
    catch (error) {
      this.lastError = error;
      if (this.catalog) return this.catalog;
      throw error;
    }
  }

  async reload() {
    const stat = await fs.promises.stat(this.file);
    const signature = stat.mtimeMs + ':' + stat.size;
    if (this.catalog && signature === this.signature) return this.catalog;
    if (this.pending) return this.pending;
    this.pending = fs.promises.readFile(this.file, 'utf8').then(text => {
      const data = JSON.parse(text);
      if (!data.build_id || !['works', 'units', 'people', 'staff', 'relations', 'watch_resources']
        .every(key => Array.isArray(data[key]))) throw new Error('Invalid anime catalog');
      this.catalog = data;
      this.signature = signature;
      this.lastError = null;
      this.responses.clear();
      this.staffByWork = new Map();
      this.staffByPerson = new Map();
      data.staff.forEach((entry, row) => {
        const record = { ...displayData(entry), _row: row };
        for (const [map, key] of [[this.staffByWork, entry.work_id], [this.staffByPerson, entry.person_id]]) {
          if (!key) continue;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(record);
        }
      });
      return data;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  async response(scope, id) {
    const data = await this.load();
    const key = scope + ':' + (id || '');
    if (this.responses.has(key)) return this.responses.get(key);
    const payload = { schema_version: 1, build_id: data.build_id, generated_at: data.generated_at,
      coverage: data.coverage, scope, works: [], units: [], people: [], staff: [], relations: [],
      watch_resources: [] };
    if (scope === 'index') {
      payload.works = data.works.map(workSummary);
      payload.units = data.units.map(unitSummary);
    } else if (scope === 'people') {
      payload.people = data.people.map(person => displayData(select(person,
        ['id', 'name', 'aliases', 'alias_ids', 'roles', 'work_count', 'unit_count', 'photo', 'creator_id'])));
    } else if (scope === 'graph') {
      payload.works = data.works.map(workSummary);
      payload.units = data.units.map(unit => ({ ...unitSummary(unit),
        ...(unit.music_cues && unit.music_cues.length ? { music_cues: displayData(unit.music_cues) } : {}) }));
      payload.relations = displayData(data.relations);
      payload.people = displayData(data.people.filter(person => person.creator_id));
      payload.staff = payload.people.flatMap(person => this.staffByPerson.get(person.id) || []);
    } else if (scope === 'unit') {
      const unit = data.units.find(row => row.id === id);
      if (!unit) return null;
      const work = data.works.find(row => row.id === unit.work_id);
      payload.works = [displayData(work)];
      payload.units = data.units.filter(row => row.work_id === unit.work_id).map(row => row.id === id ? displayData(row) : unitSummary(row));
      payload.relations = displayData(data.relations.filter(row => row.source_id === id ||
        (row.source_id === unit.work_id && row.relation_type === 'related_event')));
      payload.watch_resources = displayData(data.watch_resources.filter(row => row.scope.id === id || row.scope.id === unit.work_id));
      payload.staff = (this.staffByWork.get(unit.work_id) || []).filter(row => !row.unit_id || row.unit_id === id);
      const people = new Set(payload.staff.map(row => row.person_id).filter(Boolean));
      payload.people = displayData(data.people.filter(row => people.has(row.id)));
    } else if (scope === 'entity') {
      const separator = id.indexOf(':');
      const type = id.slice(0, separator), entityId = id.slice(separator + 1);
      const people = data.people.filter(row => type === 'creator' && row.creator_id === entityId);
      payload.people = displayData(people);
      payload.staff = people.flatMap(person => this.staffByPerson.get(person.id) || []);
      payload.relations = displayData(data.relations.filter(row => (row.target_type === type && row.target_id === entityId) ||
        (type === 'voice_actor' && row.voice_actor_id === entityId)));
      const unitIds = new Set(payload.relations.filter(row => row.source_type === 'anime_unit').map(row => row.source_id));
      const workIds = new Set(payload.staff.map(row => row.work_id));
      data.units.filter(row => unitIds.has(row.id)).forEach(row => workIds.add(row.work_id));
      payload.relations.filter(row => row.source_type === 'anime_work').forEach(row => workIds.add(row.source_id));
      payload.works = data.works.filter(row => workIds.has(row.id)).map(workSummary);
      payload.units = data.units.filter(row => workIds.has(row.work_id)).map(unitSummary);
    } else if (scope === 'work') {
      const work = data.works.find(row => row.id === id);
      if (!work) return null;
      payload.works = [displayData(work)];
      payload.units = displayData(data.units.filter(unit => unit.work_id === id));
      const unitIds = new Set(payload.units.map(unit => unit.id));
      payload.relations = displayData(data.relations.filter(row => row.source_type === 'anime_work'
        ? row.source_id === id : unitIds.has(row.source_id)));
      const relatedWorkIds = new Set(payload.relations.filter(row => row.target_type === 'anime_work').map(row => row.target_id));
      payload.works.push(...data.works.filter(row => row.id !== id && relatedWorkIds.has(row.id)).map(workSummary));
      payload.watch_resources = displayData(data.watch_resources.filter(row =>
        row.scope.type === 'work' ? row.scope.id === id : unitIds.has(row.scope.id)));
      payload.staff = this.staffByWork.get(id) || [];
      const people = new Set(payload.staff.map(row => row.person_id).filter(Boolean));
      payload.people = displayData(data.people.filter(row => people.has(row.id)));
    } else if (scope === 'person') {
      const person = data.people.find(row => row.id === id || (row.alias_ids || []).includes(id));
      if (!person) return null;
      payload.people = [displayData(person)];
      payload.staff = this.staffByPerson.get(person.id) || [];
      const workIds = new Set(payload.staff.map(row => row.work_id));
      payload.works = data.works.filter(row => workIds.has(row.id)).map(workSummary);
      payload.units = data.units.filter(row => workIds.has(row.work_id)).map(unitSummary);
    } else {
      throw new Error('Unknown anime scope');
    }
    this.responses.set(key, payload);
    return payload;
  }
}

module.exports = { AnimeStore };
