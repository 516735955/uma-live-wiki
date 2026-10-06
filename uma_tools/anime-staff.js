(function (root) {
  function groupInstitutions(rows, entryOf = row => row) {
    const groups = new Map();
    function ensure(institutions) {
      const key = JSON.stringify(institutions);
      if (!groups.has(key)) groups.set(key, {key, institutions, rows: [], organizationRows: []});
      return groups.get(key);
    }
    const affiliations = rows.filter(row => !entryOf(row).organization)
      .map(row => [...new Set(entryOf(row).institutions || [])]);
    rows.forEach(row => {
      const entry = entryOf(row);
      if (entry.organization) {
        const institutions = affiliations.find(list => list.includes(entry.organization)) || [entry.organization];
        ensure(institutions).organizationRows.push(row);
      } else {
        ensure([...new Set(entry.institutions || [])]).rows.push(row);
      }
    });
    return Array.from(groups.values()).map(group => {
      const coveredUnits = new Set(group.rows.flatMap(row => row.units || []).map(unit => unit.id));
      const organizationUnits = new Map();
      group.organizationRows.forEach(row => (row.units || []).forEach(unit => {
        if (!coveredUnits.has(unit.id)) organizationUnits.set(unit.id, unit);
      }));
      return {...group, organizationUnits: Array.from(organizationUnits.values()).sort((a, b) => a.number - b.number)};
    });
  }
  function countLabel(rows, entryOf = row => row) {
    const people = new Set(rows.filter(row => !entryOf(row).organization)
      .map(row => entryOf(row).person_id || entryOf(row).name)).size;
    const institutions = new Set(rows.flatMap(row => {
      const entry = entryOf(row);
      return entry.organization ? [entry.organization] : entry.institutions || [];
    })).size;
    return [people ? `${people} 位` : '', institutions ? `${institutions} 家` : ''].filter(Boolean).join(' · ');
  }
  const staff = {groupInstitutions, countLabel};
  if (typeof module !== 'undefined' && module.exports) module.exports = staff;
  else root.UmaAnimeStaff = staff;
})(typeof window !== 'undefined' ? window : globalThis);
