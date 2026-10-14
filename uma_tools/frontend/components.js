export function registerComponents(umaApp, routes) {
  umaApp.component("ui-select", window.UmaUi.UiSelect);
  umaApp.component("ui-disclosure", window.UmaUi.UiDisclosure);
  umaApp.component("entity-actions", window.UmaUi.EntityActions);
  umaApp.component("creator-network", window.UmaCreatorNetwork.CreatorNetwork);
  umaApp.component("audio-dock", window.UmaUi.AudioDock);
  umaApp.component("platform-mark", {
    props: { platform: String },
    // Brand paths: Simple Icons (CC0), icons/bilibili.svg and icons/youtube.svg.
    data() {
      return {
        paths: {
          youtube:
            "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
          bilibili:
            "M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z",
        },
      };
    },
    template:
      '<svg class="platform-mark" viewBox="0 0 24 24" aria-hidden="true"><path v-if="paths[platform]" :d="paths[platform]" fill="currentColor"/><g v-else fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><template v-if="platform===\'official\' || platform===\'official_site\'"><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></template><path v-else d="m10 8 6 4-6 4Z"/></g></svg>',
  });
  umaApp.component("anime-participation", {
    inject: ["animeArtwork"],
    props: {
      works: { type: Array, default: () => [] },
      section: { type: String, default: "characters" },
      selfCharacterId: { type: String, default: "" },
      hideSingleRole: { type: Boolean, default: false },
    },
    methods: {
      href(work, unit, group) {
        const units = group ? group.roles.flatMap((role) => role.units) : [];
        const film =
          group && group.roles.some((role) => role.editions.includes("film"));
        const web = unit
          ? unit.unit_type !== "movie"
          : !film &&
            (units.length ||
              (group &&
                group.roles.some((role) => role.editions.includes("web"))));
        const edition = work.id === "anime-rttt" ? (web ? "web" : "film") : "";
        return routes.query(
          routes.anime(
            work.id,
            unit && !["movie", "special"].includes(unit.unit_type) && unit.id,
          ),
          { section: this.section, edition },
        );
      },
      editionHref(work, edition) {
        return routes.query(routes.anime(work.id), {
          section: this.section,
          edition,
        });
      },
      scopeHref(work, unit, edition) {
        return routes.query(
          routes.anime(
            work.id,
            unit && !["movie", "special"].includes(work.format)
              ? unit.id
              : null,
          ),
          {
            section: this.section,
            edition: work.id === "anime-rttt" ? (unit ? "web" : edition) : "",
          },
        );
      },
      roleLabel(role, group) {
        return this.selfCharacterId ||
          (this.hideSingleRole && group.roles.length === 1)
          ? ""
          : role.label;
      },
      hasScopeContent(role) {
        return role.scopes.some(
          (scope) => scope.units.length || scope.institutions.length,
        );
      },
      creditRoles(editionGroup, group) {
        return editionGroup.roles.filter(
          (role) => this.roleLabel(role, group) || this.hasScopeContent(role),
        );
      },
      editionGroups(group) {
        const editions = [
          ...new Set(
            group.roles.flatMap((role) =>
              role.scopes.map((scope) => scope.edition),
            ),
          ),
        ];
        return editions
          .sort(
            (a, b) =>
              (a === "film" ? 0 : a === "web" ? 1 : 2) -
              (b === "film" ? 0 : b === "web" ? 1 : 2),
          )
          .map((edition) => ({
            edition,
            roles: group.roles
              .map((role) => ({
                ...role,
                scopes: role.scopes.filter(
                  (scope) => scope.edition === edition,
                ),
              }))
              .filter((role) => role.scopes.length),
          }));
      },
      artwork(group) {
        return this.animeArtwork(
          group.work,
          group.work.id === "anime-rttt" &&
            group.roles.some((role) => role.editions.includes("film")),
        );
      },
      follow(event, path) {
        if (
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        window.umaNavigate(path);
      },
    },
    template: `<div class="anime-participation">
    <article v-for="group in works" :key="group.work.id" class="anime-participation-work">
      <a class="anime-participation-title" :href="href(group.work,null,group)" @click="follow($event,href(group.work,null,group))">
        <img :src="artwork(group)" alt="" loading="lazy"><b>{{group.work.title_zh}}</b>
        <svg class="anime-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
      </a>
      <div class="participation-editions">
        <div v-for="editionGroup in editionGroups(group)" :key="editionGroup.edition" class="participation-edition-group">
          <a v-if="editionGroup.edition" class="participation-edition" :href="editionHref(group.work,editionGroup.edition)" @click="follow($event,editionHref(group.work,editionGroup.edition))">{{editionGroup.edition==='film'?'剧场版':'网络版'}}</a>
          <dl v-if="creditRoles(editionGroup,group).length" class="credit-ledger">
            <div v-for="role in creditRoles(editionGroup,group)" :key="role.key" :class="{'participation-unlabelled':!roleLabel(role,group),'participation-role-only':!hasScopeContent(role)}">
              <dt v-if="roleLabel(role,group)">{{roleLabel(role,group)}}</dt>
              <dd v-if="hasScopeContent(role)" class="participation-scopes">
                <div v-for="scope in role.scopes.filter(scope=>scope.units.length || scope.institutions.length)" :key="scope.key" class="participation-scope">
                  <span v-if="scope.institutions.length" class="participation-institution">机构：{{scope.institutions.join('、')}}</span>
                  <div v-if="scope.units.length" class="role-tag-row participation-episodes"><a v-for="unit in scope.units" :key="unit.id" class="credit-role-tag episode-tag" :href="scopeHref(group.work,unit,scope.edition)" @click="follow($event,scopeHref(group.work,unit,scope.edition))">{{unit.label}}</a></div>
                </div>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </article>
  </div>`,
  });
  umaApp.component("anime-event-links", {
    props: {
      groups: { type: Array, default: () => [] },
      workTitle: { type: String, default: "" },
    },
    data() {
      return { expanded: false };
    },
    computed: {
      visibleGroups() {
        if (this.expanded) return this.groups;
        let remaining = 3;
        return this.groups
          .map((group) => {
            const rows = group.rows.slice(0, remaining);
            remaining -= rows.length;
            return { ...group, rows };
          })
          .filter((group) => group.rows.length);
      },
      hasMore() {
        return this.groups.reduce((n, group) => n + group.rows.length, 0) > 3;
      },
    },
    methods: {
      href(row) {
        return routes.events(row.relation.target_id, row.relation.session_id);
      },
      title(row) {
        const title = row.event.title;
        if (!this.workTitle) return title;
        const prefixes = ["劇場版", "TVアニメ", "アニメ", ""].flatMap((type) =>
          [
            "『" + this.workTitle + "』",
            "「" + this.workTitle + "」",
            this.workTitle,
          ].map((work) => type + work),
        );
        const prefix = prefixes.find((prefix) => title.startsWith(prefix));
        return prefix ? title.slice(prefix.length).trim() || title : title;
      },
      follow(event, path) {
        if (
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        window.umaNavigate(path);
      },
    },
    template: `<nav class="anime-event-links" aria-label="相关活动">
    <div v-for="group in visibleGroups" :key="group.kind" class="anime-event-group">
      <b v-if="visibleGroups.length>1" class="anime-event-category">{{group.label}}</b>
      <a v-for="row in group.rows" :key="row.relation.id" :href="href(row)" :aria-label="row.event.title+' '+row.event.date" @click="follow($event,href(row))">
        <span class="anime-event-kind">{{row.relation.label}}</span>
        <span class="anime-event-copy"><span>{{title(row)}}</span><time>{{row.event.date}}</time></span>
        <svg class="anime-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
      </a>
    </div>
    <button v-if="hasMore" type="button" class="anime-event-toggle" :aria-expanded="expanded" @click="expanded=!expanded">{{expanded?'收起相关活动':'展开相关活动'}}<svg class="anime-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="expanded?'m6 14 6-6 6 6':'m6 10 6 6 6-6'"/></svg></button>
  </nav>`,
  });
  umaApp.component("staff-credit-list", {
    inject: ["animePeople"],
    props: {
      credits: { type: Array, default: () => [] },
      participation: { type: Boolean, default: false },
    },
    computed: {
      peopleById() {
        return new Map(this.animePeople().map((person) => [person.id, person]));
      },
      groups() {
        const groups = window.UmaAnimeStaff.groupInstitutions(
          this.credits,
          (row) => this.entry(row),
        );
        if (this.participation) return groups;
        const compact = [];
        groups.forEach((group) => {
          const previous = compact[compact.length - 1];
          if (previous && !previous.rows.length && !group.rows.length) {
            previous.institutions.push(...group.institutions);
          } else
            compact.push({ ...group, institutions: [...group.institutions] });
        });
        return compact;
      },
    },
    methods: {
      entry(row) {
        return this.participation ? row.entry : row;
      },
      name(entry) {
        return (this.peopleById.get(entry.person_id) || {}).name || entry.name;
      },
      href(entry) {
        const p = this.peopleById.get(entry.person_id);
        return p
          ? p.creator_id
            ? routes.creators(p.creator_id)
            : routes.staff(p.id)
          : "";
      },
      unitHref(unit) {
        return routes.query(routes.anime(unit.work_id, unit.id), {
          section: "staff",
          edition: unit.work_id === "anime-rttt" ? "web" : "",
        });
      },
      follow(event, path) {
        if (
          event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        window.umaNavigate(path);
      },
    },
    template: `<div class="anime-staff-teams">
    <div v-for="group in groups" :key="group.key" class="anime-staff-team" :class="{'anime-staff-team-labelled':!participation && group.institutions.length && group.rows.length}">
      <div v-if="group.institutions.length" class="role-tag-row anime-staff-institutions"><span v-if="group.rows.length" class="anime-institution-label">机构：</span><em v-for="institution in group.institutions" :key="institution" class="credit-role-tag">{{institution}}</em></div>
      <div v-if="group.rows.length" :class="participation?'anime-staff-participation':'anime-credit-people'">
        <div v-for="(row,index) in group.rows" :key="index" class="anime-credit">
          <a v-if="href(entry(row))" class="text-link" :href="href(entry(row))" @click="follow($event,href(entry(row)))">{{name(entry(row))}}</a><span v-else>{{name(entry(row))}}</span>
          <div v-if="participation" class="role-tag-row"><a v-for="unit in row.units" :key="unit.id" class="credit-role-tag episode-tag" :href="unitHref(unit)" @click="follow($event,unitHref(unit))">{{unit.label}}</a></div>
        </div>
      </div>
      <div v-if="participation && group.organizationUnits.length" class="role-tag-row"><a v-for="unit in group.organizationUnits" :key="unit.id" class="credit-role-tag episode-tag" :href="unitHref(unit)" @click="follow($event,unitHref(unit))">{{unit.label}}</a></div>
    </div>
  </div>`,
  });
}
