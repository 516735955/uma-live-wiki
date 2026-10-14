(function (root, factory) {
  const loader = factory();
  if (typeof module === 'object' && module.exports) module.exports = loader;
  if (root) root.UmaAnimeLoader = loader;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const fields = ['works', 'units', 'people', 'staff', 'relations', 'watch_resources'];

  function create(request) {
    const responses = new Map(), pending = new Map(), loadedAt = new Map();
    let buildId = '', revision = 0;
    function assemble() {
      const result = { build_id: buildId };
      const lists = Object.fromEntries(fields.map(key => [key, new Map()]));
      // Summaries are applied before detail responses, so a late index never erases detail fields.
      const ordered = Array.from(responses.values()).sort((a, b) =>
        Number(['work', 'person', 'unit', 'entity'].includes(a.scope)) - Number(['work', 'person', 'unit', 'entity'].includes(b.scope)));
      ordered.forEach(data => {
        result.coverage = data.coverage;
        result.generated_at = data.generated_at;
        fields.forEach(field => data[field].forEach(row => {
          const key = field === 'staff' ? row._row : row.id;
          lists[field].set(key, { ...(lists[field].get(key) || {}), ...row });
        }));
      });
      fields.forEach(field => { result[field] = Array.from(lists[field].values()); });
      return result;
    }
    async function load(scope, id, retry) {
      scope = scope || 'index';
      const key = scope + ':' + (id || '');
      if (retry) { responses.delete(key); pending.delete(key); }
      if (responses.has(key) && Date.now() - (loadedAt.get(key) || 0) < 5 * 60 * 1000) return assemble();
      if (pending.has(key)) return pending.get(key);
      const started = revision;
      const params = new URLSearchParams({ scope });
      if (id) params.set('id', id);
      const promise = Promise.resolve().then(() => request('/api/catalog/anime?' + params, { fresh: !!retry }))
        .then(async data => {
          if (!data || !data.build_id || data.scope !== scope ||
            !fields.every(field => Array.isArray(data[field])) ||
            !data.staff.every(row => Number.isInteger(row._row) && Array.isArray(row.roles) &&
              row.roles.length && row.roles.every(role => typeof role === 'string' && role.length))) throw new Error('Invalid anime response');
          if (started !== revision && data.build_id !== buildId) {
            if (retry) throw new Error('Anime data changed during loading');
            if (pending.get(key) === promise) pending.delete(key);
            return load(scope, id, true);
          }
          if (buildId !== data.build_id) {
            revision += 1;
            responses.clear();
            loadedAt.clear();
            pending.clear();
          }
          buildId = data.build_id;
          responses.set(key, data);
          loadedAt.set(key, Date.now());
          return assemble();
        }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
      pending.set(key, promise);
      return promise;
    }
    return Object.freeze({ load });
  }
  return Object.freeze({ create });
});
