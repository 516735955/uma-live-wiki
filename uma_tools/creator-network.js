(function () {
  'use strict';

  const CreatorNetwork = {
    props: {
      creator: { type: Object, required: true },
      catalog: { type: Array, default: function () { return []; } }
    },
    emits: ['open-creator', 'open-song'],
    data: function () {
      return {
        width: 960,
        selectedId: '',
        selectedDetail: null,
        selectionRequest: 0,
        loading: false,
        loadError: '',
        hoverId: '',
        observer: null
      };
    },
    computed: {
      compact: function () { return this.width < 720; },
      collaborators: function () {
        const byId = new Map(this.catalog.map(function (item) { return [item.id, item]; }));
        return (this.creator.collaborators || []).map(function (relation) {
          return Object.assign({}, byId.get(relation.creator_id) || {}, relation);
        }).sort(function (a, b) {
          return (b.shared_work_count - a.shared_work_count) || String(a.name).localeCompare(String(b.name), 'ja');
        });
      },
      layout: function () {
        const nodeWidth = this.compact ? Math.max(250, this.width - 32) : 190;
        const nodeHeight = 66;
        if (this.compact) {
          const top = 108;
          return {
            width: this.width,
            height: Math.max(300, top + this.collaborators.length * 80 + 16),
            root: { x: 16, y: 18, width: nodeWidth, height: 72 },
            nodes: this.collaborators.map(function (person, index) {
              return Object.assign({}, person, { x: 16, y: top + index * 80, width: nodeWidth, height: nodeHeight });
            })
          };
        }
        const rootWidth = 188;
        const startX = 260;
        const horizontalGap = 210;
        const columns = Math.max(2, Math.min(4, Math.floor((this.width - startX + 20) / horizontalGap)));
        const rows = Math.max(1, Math.ceil(this.collaborators.length / columns));
        const verticalGap = 86;
        const height = Math.max(350, rows * verticalGap + 34);
        return {
          width: this.width,
          height: height,
          root: { x: 24, y: Math.round((height - 74) / 2), width: rootWidth, height: 74 },
          nodes: this.collaborators.map(function (person, index) {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const occupiedHeight = rows * verticalGap;
            const offsetY = Math.round((height - occupiedHeight) / 2 + 10);
            return Object.assign({}, person, {
              x: startX + column * horizontalGap,
              y: offsetY + row * verticalGap,
              width: nodeWidth,
              height: nodeHeight
            });
          })
        };
      },
      selected: function () {
        return this.collaborators.find(function (person) { return person.creator_id === this.selectedId; }, this) || null;
      },
      sharedWorks: function () {
        const selected = this.selected;
        if (!selected) return [];
        const ids = new Set(selected.shared_song_ids || []);
        const otherWorks = new Map(((this.selectedDetail && this.selectedDetail.works) || []).map(function (work) { return [work.song_id, work]; }));
        return (this.creator.works || []).filter(function (work) { return ids.has(work.song_id); }).map(function (work) {
          const counterpart = otherWorks.get(work.song_id);
          return {
            song_id: work.song_id,
            title: work.title,
            cover: work.cover,
            release_date: work.release_date,
            roles: Array.from(new Set([].concat(work.roles || [], (counterpart && counterpart.roles) || []))),
            album: work.album_name || (counterpart && counterpart.album_name) || ''
          };
        }).sort(function (a, b) { return String(a.release_date || '').localeCompare(String(b.release_date || '')); });
      }
    },
    mounted: function () {
      this.measure();
      if (window.ResizeObserver) {
        this.observer = new ResizeObserver(this.measure);
        this.observer.observe(this.$el);
      }
    },
    beforeUnmount: function () { this.selectionRequest += 1; if (this.observer) this.observer.disconnect(); },
    methods: {
      measure: function () { this.width = Math.max(320, Math.round(this.$el.clientWidth || 960)); },
      portrait: function (person) { return person.image || person.photo || '/uma_tools/img/creator-placeholder.svg'; },
      roleText: function (person) {
        return ((person.roles || []).slice(0, 2).map(function (role) { return role.label || role.role; }).join(' · ')) || '创作者';
      },
      nodeStyle: function (node) {
        return { left: node.x + 'px', top: node.y + 'px', width: node.width + 'px', minHeight: node.height + 'px' };
      },
      edgePath: function (node) {
        const root = this.layout.root;
        const startX = root.x + root.width;
        const startY = root.y + root.height / 2;
        const endX = node.x;
        const endY = node.y + node.height / 2;
        if (this.compact) return 'M ' + (root.x + root.width / 2) + ' ' + (root.y + root.height) + ' L ' + (node.x + node.width / 2) + ' ' + endY;
        const bend = startX + Math.max(30, (endX - startX) * 0.42);
        return 'M ' + startX + ' ' + startY + ' C ' + bend + ' ' + startY + ', ' + bend + ' ' + endY + ', ' + endX + ' ' + endY;
      },
      edgeClass: function (person) {
        return {
          selected: this.selectedId === person.creator_id,
          muted: !!(this.hoverId || this.selectedId) && this.hoverId !== person.creator_id && this.selectedId !== person.creator_id
        };
      },
      nodeClass: function (person) {
        return {
          selected: this.selectedId === person.creator_id,
          muted: !!this.hoverId && this.hoverId !== person.creator_id
        };
      },
      roleLabel: function (role) {
        return { lyricist: '作词', composer: '作曲', arranger: '编曲', remixer: '混音改编', producer: '制作', orchestrator: '配器' }[role] || role;
      },
      choose: function (person) {
        const selection = ++this.selectionRequest;
        this.selectedId = person.creator_id;
        this.selectedDetail = null;
        this.loading = true;
        this.loadError = '';
        return window.UmaApi.request('/api/catalog/creator' + window.UmaApi.query({ id: person.creator_id }))
          .then((data) => { if (this.selectionRequest === selection) this.selectedDetail = data && data.creator; })
          .catch(() => { if (this.selectionRequest === selection) this.loadError = '共同作品暂时无法载入，请重试。'; })
          .finally(() => { if (this.selectionRequest === selection) this.loading = false; });
      },
      close: function () { this.selectionRequest += 1; this.selectedId = ''; this.selectedDetail = null; this.loading = false; this.loadError = ''; },
      onNodeKey: function (event, person) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.choose(person); }
      }
    },
    template: `
      <div class="creator-network" :class="{'has-selection':selected}">
        <div class="creator-graph-viewport" :style="{height:layout.height+'px'}">
          <div class="creator-graph-stage" :style="{width:layout.width+'px',height:layout.height+'px'}">
            <svg class="creator-graph-edges" :viewBox="'0 0 '+layout.width+' '+layout.height" aria-hidden="true">
              <path v-for="person in layout.nodes" :key="'edge-'+person.creator_id" :d="edgePath(person)" :class="edgeClass(person)"/>
            </svg>
            <button class="creator-graph-node is-root" type="button" :style="nodeStyle(layout.root)" aria-current="true">
              <img :src="portrait(creator)" alt="">
              <span><b>{{ creator.name }}</b><small>{{ roleText(creator) }}</small></span>
            </button>
            <button v-for="person in layout.nodes" :key="person.creator_id" class="creator-graph-node" :class="nodeClass(person)" type="button" :style="nodeStyle(person)" :aria-label="'查看与 '+person.name+' 的合作'" :aria-pressed="selectedId===person.creator_id" @mouseenter="hoverId=person.creator_id" @mouseleave="hoverId=''" @focus="hoverId=person.creator_id" @blur="hoverId=''" @click="choose(person)" @keydown="onNodeKey($event,person)">
              <img :src="portrait(person)" alt="">
              <span><b>{{ person.name }}</b><small>{{ person.shared_work_count }} 首共同作品</small></span>
              <em>{{ person.shared_version_count || person.shared_work_count }}</em>
            </button>
          </div>
          <aside v-if="selected" class="creator-network-inspector" aria-live="polite">
            <button class="creator-inspector-close" type="button" aria-label="关闭合作详情" @click="close"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
            <header>
              <img :src="portrait(selected)" alt="">
              <span><b>{{ selected.name }}</b><small>{{ roleText(selected) }}</small></span>
            </header>
            <button class="creator-profile-link" type="button" @click="$emit('open-creator',selected.creator_id)">查看创作者资料 <span aria-hidden="true">→</span></button>
            <div v-if="loading" class="ui-state compact">共同作品加载中</div>
            <div v-else-if="loadError" class="ui-state compact">{{ loadError }}<button class="creator-profile-link" type="button" @click="choose(selected)">重新加载</button></div>
            <ol v-else-if="sharedWorks.length" class="collaboration-timeline">
              <li v-for="work in sharedWorks" :key="work.song_id">
                <time>{{ work.release_date || '日期待补' }}</time>
                <button type="button" @click="$emit('open-song',work.song_id)"><img :src="work.cover || '/uma_tools/img/album-placeholder.svg'" alt=""><span><b>{{ work.title }}</b><small v-if="work.album">{{ work.album }}</small><em><i v-for="role in work.roles" :key="role">{{ roleLabel(role) }}</i></em></span></button>
              </li>
            </ol>
            <div v-else class="ui-state compact">暂无可确认的共同作品</div>
          </aside>
        </div>
      </div>`
  };

  window.UmaCreatorNetwork = Object.freeze({ CreatorNetwork: CreatorNetwork });
})();
