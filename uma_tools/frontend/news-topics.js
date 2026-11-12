function useTopicRequest(params) {
  const { ref, watch, onBeforeUnmount } = Vue;
  const result = ref(null);
  const pending = ref(false);
  let controller;
  watch(params, async value => {
    controller?.abort();
    result.value = null;
    pending.value = false;
    if (!value?.id) return;
    const current = new AbortController();
    controller = current;
    pending.value = true;
    try {
      const api = window.UmaApi;
      const data = await api.request('/api/news-topics' + api.query(value), { signal: current.signal });
      if (!current.signal.aborted) result.value = data;
    } catch (_) {
      // Topics are independent of the primary page.
    } finally {
      if (current === controller) pending.value = false;
    }
  }, { immediate: true });
  onBeforeUnmount(() => controller?.abort());
  return { result, pending };
}

function topicNavigation() {
  const root = Vue.getCurrentInstance().proxy.$root;
  return (event, href) => root.internalLink(event, () => root.navNavigate(href));
}

export const NewsTopics = {
  props: { articleId: String },
  setup(props) {
    const { ref, computed, watch, nextTick, onBeforeUnmount } = Vue;
    const { result } = useTopicRequest(() => ({ id: props.articleId }));
    const topics = computed(() => result.value?.topics || []);
    const list = ref(null);
    const expanded = ref(false);
    const overflow = ref(false);
    const failedImages = ref({});
    const navigate = topicNavigation();
    const measure = () => {
      if (!expanded.value && list.value) overflow.value = list.value.scrollHeight > list.value.clientHeight + 1;
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    watch(list, (node, previous) => {
      if (previous) observer?.unobserve(previous);
      if (node) observer?.observe(node);
      measure();
    });
    watch(topics, () => {
      expanded.value = false;
      overflow.value = false;
      failedImages.value = {};
      nextTick(measure);
    });
    function revealFocused(event) {
      if (list.value && event.target.getBoundingClientRect().bottom > list.value.getBoundingClientRect().bottom) expanded.value = true;
    }
    onBeforeUnmount(() => observer?.disconnect());
    return { topics, list, expanded, overflow, failedImages, revealFocused, navigate };
  },
  template: `
    <section v-if="topics.length" class="news-topics" aria-label="本文话题">
      <h3>本文话题</h3>
      <div ref="list" class="news-topic-list" :class="{'is-expanded':expanded}" @focusin="revealFocused">
        <a v-for="item in topics" :key="item.type+':'+item.id" class="performer-chip news-topic-chip" :class="item.type+'-chip'" :style="{'--chip-color':item.color}" :href="item.href" :title="item.title" @click="navigate($event,item.href)">
          <img v-if="item.image && !failedImages[item.type+':'+item.id]" v-media-src="item.image" alt="" loading="lazy" @error="failedImages[item.type+':'+item.id]=true">
          <span v-else class="performer-chip-fallback" aria-hidden="true">{{ item.type==='event' ? '演' : item.title.slice(0,1) }}</span>
          <span>{{ item.title }}</span>
        </a>
      </div>
      <button v-if="overflow || expanded" type="button" class="text-link news-topic-toggle" :aria-expanded="expanded" @click="expanded=!expanded">{{ expanded ? '收起话题' : '展开全部话题' }}</button>
    </section>`,
};

export const RelatedNews = {
  props: { type: String, entityId: String },
  setup(props) {
    const page = Vue.ref(1);
    Vue.watch(() => [props.type, props.entityId], () => { page.value = 1; }, { flush: 'sync' });
    const { result, pending } = useTopicRequest(() => ({ type: props.type, id: props.entityId, page: page.value }));
    const shown = Vue.ref(null);
    Vue.watch(() => [props.type, props.entityId], () => { shown.value = null; }, { flush: 'sync' });
    Vue.watch(result, value => { if (value) shown.value = value; });
    function go(next) {
      if (!pending.value && next >= 1 && next <= shown.value?.page_count) page.value = next;
    }
    return { shown, pending, go, navigate: topicNavigation() };
  },
  template: `
    <section v-if="shown?.items.length" class="entity-section related-news" aria-label="相关新闻" :aria-busy="pending">
      <div class="section-toolbar"><h2 class="credit-role-tag">相关新闻</h2></div>
      <div class="history-list">
        <a v-for="item in shown.items" :key="item.id" :href="item.href" @click="navigate($event,item.href)">
          <time :datetime="item.date">{{ item.date }}</time><strong>{{ item.title }}</strong>
        </a>
      </div>
      <div v-if="shown.page_count>1" class="ui-pager">
        <span>第 {{ shown.page }} / {{ shown.page_count }} 页</span>
        <div><button type="button" :disabled="pending || shown.page===1" @click="go(shown.page-1)">上一页</button><button type="button" :disabled="pending || shown.page===shown.page_count" @click="go(shown.page+1)">下一页</button></div>
      </div>
    </section>`,
};
