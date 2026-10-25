/* staff state and behavior; external dependencies are explicit live ports. */
export function createStaff(deps) {
  const staffQuery = deps.ref("");

  const staffPage = deps.ref(1);

  const staffDetail = deps.ref(null);

  const animeStaffQuery = deps.ref("");
  const peopleById = deps.computed(() => new Map((deps.animeCatalog.value.people || []).map(person => [person.id, person])));

  const animeDisplayStaff = deps.computed(() =>
    (deps.animeCatalog.value.staff || []).flatMap((entry) =>
      entry.roles.map((role) => ({ ...entry, role })),
    ),
  );

  const animeCurrentStaff = deps.computed(function () {
    const workId = deps.animeDetail.value && deps.animeDetail.value.id;
    const unitId =
      deps.animeContentUnit.value && deps.animeContentUnit.value.id;
    const seen = new Set();
    return animeDisplayStaff.value
      .filter(function (entry) {
        if (
          entry.work_id !== workId ||
          (workId === "anime-rttt" &&
            !deps.animeRowMatchesEdition(entry, deps.animeEdition.value))
        )
          return false;
        if (!(
          (entry.unit_id || null) === (unitId || null) ||
          (deps.animeSingle.value && !entry.unit_id)
        ))
          return false;
        const key = [
          entry.role,
          entry.group || "",
          entry.person_id || entry.organization || entry.name,
          animeStaffInstitutionKey(entry),
        ].join(":");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
  });

  function staffName(entry) {
    return (
      (
        peopleById.value.get(entry.person_id) || {}
      ).name ||
      entry.name ||
      ""
    );
  }

  function staffHref(entry) {
    const person = entry.id
      ? entry
      : peopleById.value.get(entry.person_id);
    return person
      ? person.creator_id
        ? deps.routes.creators(person.creator_id)
        : deps.routes.staff(person.id)
      : "";
  }

  function animeStaffIdentity(entry) {
    return entry.person_id || entry.organization || entry.name || "";
  }

  function animeStaffInstitutionKey(entry) {
    return [entry.organization || "", ...(entry.institutions || [])]
      .sort()
      .join("|");
  }

  function animeStaffSamePersonAndInstitution(a, b) {
    return (
      animeStaffIdentity(a) === animeStaffIdentity(b) &&
      animeStaffInstitutionKey(a) === animeStaffInstitutionKey(b)
    );
  }

  function animeStaffDisplayEntry(entry) {
    const copy = { ...entry, institutions: [...(entry.institutions || [])] };
    return copy;
  }

  function animeStaffSectionRank(group) {
    if (!group) return 0;
    if (group === "片头动画") return 1;
    if (group === "片尾动画") return 2;
    return 3;
  }

  function animeStaffMatches(entry, query) {
    return (
      !query ||
      [
        entry.role,
        entry.group,
        staffName(entry),
        entry.organization,
        ...(entry.institutions || []),
      ].some((value) =>
        window.UmaUi.searchText(value)
          .includes(query),
      )
    );
  }

  const animeStaffGroups = deps.computed(() => {
    const q = window.UmaUi.searchText(animeStaffQuery.value),
      groups = [];
    animeCurrentStaff.value.forEach((entry) => {
      const displayEntry = animeStaffDisplayEntry(entry);
      if (!animeStaffMatches(displayEntry, q)) return;
      let group = groups.find(
        (row) =>
          row.group === (displayEntry.group || "") &&
          row.role === displayEntry.role,
      );
      if (!group) {
        group = {
          key: (displayEntry.group || "") + ":" + displayEntry.role,
          role: displayEntry.role,
          group: displayEntry.group || "",
          credits: [],
        };
        groups.push(group);
      }
      if (
        !group.credits.some((credit) =>
          animeStaffSamePersonAndInstitution(credit, displayEntry),
        )
      )
        group.credits.push(displayEntry);
    });
    return groups
      .sort(
        (a, b) =>
          animeStaffSectionRank(a.group) - animeStaffSectionRank(b.group) ||
          window.UmaAnimeStaff.compareRoles(a.role, b.role),
      )
      .map((group) => ({
        ...group,
        count: window.UmaAnimeStaff.countLabel(group.credits),
      }));
  });

  const animeStaffAggregate = deps.computed(() => {
    if (
      !deps.animeDetail.value ||
      deps.animeUnitDetail.value ||
      deps.animeSingle.value
    )
      return [];
    const rows = [],
      q = window.UmaUi.searchText(animeStaffQuery.value);
    animeDisplayStaff.value
      .filter(
        (entry) =>
          entry.work_id === deps.animeDetail.value.id &&
          entry.unit_id &&
          (entry.person_id || entry.organization),
      )
      .forEach((entry) => {
        const key = [
          entry.person_id || entry.organization,
          entry.group || "",
          entry.role,
          animeStaffInstitutionKey(entry),
        ].join(":");
        let row = rows.find((item) => item.key === key);
        if (!row) {
          row = { key, entry, units: [] };
          rows.push(row);
        }
        const unit = deps.findAnimeUnit(entry.unit_id);
        if (unit && !row.units.some((item) => item.id === unit.id))
          row.units.push(unit);
      });
    return rows
      .filter((row) => animeStaffMatches(animeStaffDisplayEntry(row.entry), q))
      .map((row) => ({
        ...row,
        units: row.units.sort((a, b) => a.number - b.number),
      }));
  });

  const animeStaffAggregateGroups = deps.computed(() => {
    const groups = new Map();
    animeStaffAggregate.value.forEach((row) => {
      const entry = animeStaffDisplayEntry(row.entry);
      let group = Array.from(groups.values()).find(
        (candidate) =>
          candidate.group === (entry.group || "") &&
          candidate.rawRole === entry.role,
      );
      if (!group) {
        const role = [entry.group, entry.role].filter(Boolean).join(" ");
        group = {
          key: role,
          role,
          rawRole: entry.role,
          group: entry.group || "",
          rows: [],
        };
        groups.set(role, group);
      }
      if (
        !group.rows.some((item) =>
          animeStaffSamePersonAndInstitution(item.entry, entry),
        )
      )
        group.rows.push({ ...row, entry, units: [...row.units] });
    });
    return Array.from(groups.values())
      .sort(
        (a, b) =>
          animeStaffSectionRank(a.group) - animeStaffSectionRank(b.group) ||
          window.UmaAnimeStaff.compareRoles(
            a.rows[0].entry.role,
            b.rows[0].entry.role,
          ),
      )
      .map((group) => ({
        ...group,
        count: window.UmaAnimeStaff.countLabel(group.rows, (row) => row.entry),
      }));
  });

  function staffPortrait(person) {
    if (person.photo) return person.photo;
    return window.UmaUi.identityPortrait(person);
  }

  const staffFiltered = deps.computed(() => {
    const q = staffQuery.value.trim();
    const values = (person) => [person.name, ...(person.aliases || []), ...(person.roles || [])];
    return (deps.animeCatalog.value.people || [])
      .filter(
        (person) =>
          !q ||
          (window.UmaSearch?.includes
            ? window.UmaSearch.includes(values(person), q)
            : values(person).some(value => window.UmaUi.searchText(value).includes(window.UmaUi.searchText(q)))),
      )
      .slice()
      .sort((a, b) =>
        (q && window.UmaSearch?.rank ? window.UmaSearch.rank(values(a), q) - window.UmaSearch.rank(values(b), q) : 0) ||
        (Number(b.work_count) || 0) - (Number(a.work_count) || 0) ||
            String(a.name || "").localeCompare(String(b.name || ""), "zh"),
      );
  });

  function staffVisibleRoles(person) {
    const roles = (Array.isArray(person.roles) ? person.roles : [])
      .slice()
      .sort(window.UmaAnimeStaff.compareRoles);
    const q = window.UmaUi.searchText(staffQuery.value);
    if (!q) return roles.slice(0, 2);
    return roles
      .filter((role) =>
        window.UmaUi.searchText(role)
          .includes(q),
      )
      .concat(
        roles.filter(
          (role) =>
            !window.UmaUi.searchText(role)
              .includes(q),
        ),
      )
      .slice(0, 2)
      .sort(window.UmaAnimeStaff.compareRoles);
  }

  const staffPageCount = deps.computed(() =>
    Math.max(1, Math.ceil(staffFiltered.value.length / deps.creatorsPerPage)),
  );

  const staffPaged = deps.computed(() =>
    staffFiltered.value.slice(
      (staffPage.value - 1) * deps.creatorsPerPage,
      staffPage.value * deps.creatorsPerPage,
    ),
  );

  const staffPageList = deps.computed(() =>
    deps.pagerList(staffPage.value, staffPageCount.value),
  );

  function setStaffPage(page) {
    if (page === "…" || page < 1 || page > staffPageCount.value) return;
    staffPage.value = page;
    deps.pushUrl();
    const top = document.getElementById("staffArchiveTop");
    if (top) top.scrollIntoView({ behavior: window.UmaUi.scrollBehavior(), block: "start" });
  }

  const creatorAnimeStaff = deps.computed(() => {
    if (!deps.creatorDetail.value) return [];
    const ids = new Set(
      (deps.animeCatalog.value.people || [])
        .filter((p) => p.creator_id === deps.creatorDetail.value.id)
        .map((p) => p.id),
    );
    return animeDisplayStaff.value
      .filter((entry) => ids.has(entry.person_id))
      .map((entry) => ({
        entry,
        work: deps.findAnimeWork(entry.work_id),
        unit: deps.findAnimeUnit(entry.unit_id),
      }));
  });

  const staffCredits = deps.computed(() =>
    deps.groupAnimeParticipation(
      staffDetail.value
        ? animeDisplayStaff.value
            .filter((entry) => entry.person_id === staffDetail.value.id)
            .map((entry) => ({
              entry,
              work: deps.findAnimeWork(entry.work_id),
              unit: deps.findAnimeUnit(entry.unit_id),
            }))
        : [],
    ),
  );

  const staffDisplayAliases = deps.computed(() => {
    const person = staffDetail.value;
    if (!person) return [];
    const compact = (value) =>
      value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    const redundant = new Set([compact(person.name)]);
    const words = person.name.trim().split(/\s+/);
    if (
      words.length === 2 &&
      words.every((word) => /^[A-Za-zÀ-ž-]+$/.test(word))
    )
      redundant.add(compact(words.reverse().join("")));
    return (person.aliases || []).filter(
      (alias) => !redundant.has(compact(alias)),
    );
  });
  function start() {
    deps.watch(
      staffQuery,
      () => {
        if (deps.restoringRoute) return;
        staffPage.value = 1;
        if (
          deps.routeReady.value &&
          deps.activeTab.value === "database" &&
          deps.dbView.value === "staff" &&
          !staffDetail.value
        )
          deps.pushUrl(true);
      },
      { flush: "sync" },
    );
  }
  return {
    start,
    animeCurrentStaff,
    animeStaffAggregate,
    animeStaffAggregateGroups,
    animeStaffGroups,
    animeStaffQuery,
    creatorAnimeStaff,
    setStaffPage,
    staffCredits,
    staffDetail,
    staffDisplayAliases,
    staffFiltered,
    staffHref,
    staffName,
    staffPage,
    staffPageCount,
    staffPageList,
    staffPaged,
    staffPortrait,
    staffQuery,
    staffVisibleRoles,
  };
}
