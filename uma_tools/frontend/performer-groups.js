// Identity comes from existing character associations and voice-actor records.
export function castGroups(cast) {
  return [0, 1, 2].map(kind => (cast || []).filter(row =>
    (row.character_id ? 0 : row.voice_actor_id ? 1 : 2) === kind)).filter(rows => rows.length);
}

export function performanceGroups(performance, profiles) {
  const characters = performance.character_ids || [];
  const voices = [], others = [], seen = new Set();
  const known = new Map((profiles || []).map(profile => [profile.id, profile]));
  const normalize = name => String(name || '').replace(/[\s　]/g, '').replace(/髙/g, '高');
  const byName = new Map();
  known.forEach(profile => [profile.identity?.zh, profile.identity?.ja, ...(profile.identity?.aliases || [])]
    .filter(Boolean).forEach(name => byName.set(normalize(name), profile)));
  function addVoice(id) {
    if (seen.has(id)) return;
    seen.add(id);
    const profile = known.get(id);
    if (profile?.roles?.some(role => characters.includes(role.character_id))) return;
    voices.push({kind:'voice', id});
  }
  (performance.voice_actor_ids || []).forEach(addVoice);
  (performance.guest_performers || []).forEach(name => {
    const profile = byName.get(normalize(name));
    if (profile) addVoice(profile.id);
    else others.push({kind:'other', name});
  });
  return [characters.map(id => ({kind:'character', id})), voices, others].filter(rows => rows.length);
}

// Project curated HTML into rows without rewriting its source or dropping notes.
export function groupSetlistPerformers(html) {
  if (!/class=["']setlist-perf["']/.test(html) || !/(?:guest-performer|setlist-voice-link)/.test(html)) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const selector = '.perf-item,.setlist-performer-link,.setlist-voice-link,.guest-performer';
  const kind = node => node.matches('.setlist-voice-link') ? 1 : node.matches('.guest-performer') ? 2 : 0;
  const firstKind = node => {
    if (node.nodeType !== 1) return null;
    const chip = node.matches(selector) ? node : node.querySelector(selector);
    return chip ? kind(chip) : null;
  };
  function project(node, target, fallback) {
    if (node.nodeType !== 1) return fallback === target ? node.cloneNode(true) : null;
    if (node.matches(selector)) return kind(node) === target ? node.cloneNode(true) : null;
    if (!node.querySelector(selector)) return fallback === target ? node.cloneNode(true) : null;
    const clone = node.cloneNode(false), children = [...node.childNodes];
    children.forEach((child, index) => {
      const next = children.slice(index).map(firstKind).find(value => value !== null);
      const previous = children.slice(0, index).reverse().map(firstKind).find(value => value !== null);
      const item = project(child, target, firstKind(child) ?? next ?? previous ?? fallback);
      if (item) clone.append(item);
    });
    return clone.childNodes.length ? clone : null;
  }
  template.content.querySelectorAll('.setlist-perf').forEach(cell => {
    const seen = new Set();
    cell.querySelectorAll('.setlist-voice-link').forEach(chip => {
      const key = chip.dataset.voiceId + '|' + chip.textContent;
      if (seen.has(key)) chip.remove();
      else seen.add(key);
    });
    const kinds = new Set([...cell.querySelectorAll(selector)].map(kind));
    if (kinds.size < 2) return;
    const groups = [0,1,2].filter(value => kinds.has(value)).map(value => {
      const row = document.createElement('div');
      row.className = 'performer-group'; row.dataset.performerGroup = String(value);
      const projected = project(cell, value, 0);
      while (projected.firstChild) row.append(projected.firstChild);
      return row;
    });
    cell.replaceChildren(...groups);
  });
  return template.innerHTML;
}

export const PerformanceCast = {
  props: { performance: {type:Object, required:true} },
  setup(props) {
    const view = Vue.getCurrentInstance().proxy.$root;
    return {view, groups: Vue.computed(() => performanceGroups(props.performance, view.voiceProfiles))};
  },
  template: `<div class="performance-groups"><div v-for="(group,index) in groups" :key="index" class="performer-chip-list compact performer-group" :data-performer-group="group[0].kind"><template v-for="(item,i) in group" :key="item.id || item.name+'-'+i"><a v-if="item.kind==='character'" class="performer-chip character-chip" :style="{'--chip-color':view.characterColor(item.id)}" :href="view.routes.characters(item.id)" @click="view.internalLink($event,()=>view.openCharacter(item.id))"><img v-if="view.characterPerformanceImage(item.id)" v-media-src="view.characterPerformanceImage(item.id)" alt=""><span>{{ view.characterName(item.id) }}</span></a><a v-else-if="item.kind==='voice'" class="performer-chip voice-chip" :href="view.routes.voiceActors(item.id)" @click="view.internalLink($event,()=>view.openVoice(item.id))"><img v-if="view.voicePhoto(item.id)" v-media-src="view.voicePhoto(item.id)" alt=""><span>{{ view.voiceName(item.id) }}</span></a><span v-else class="guest-performer">{{ item.name }}</span></template></div></div>`,
};
