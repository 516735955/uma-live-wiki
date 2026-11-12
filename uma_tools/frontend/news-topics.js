function useTopicRequest(params) {
  const { ref, watch, onBeforeUnmount } = Vue;
  const result = ref(null);
  const pending = ref(false);
  const failed = ref(false);
  const attempt = ref(0);
  let controller;
  watch([params, attempt], async ([value]) => {
    controller?.abort();
    result.value = null;
    pending.value = false;
    failed.value = false;
    if (!value?.id) return;
    const current = new AbortController();
    controller = current;
    pending.value = true;
    try {
      const api = window.UmaApi;
      const data = await api.request('/api/news-topics' + api.query(value), { signal: current.signal });
      if (!current.signal.aborted) result.value = data;
    } catch (_) {
      if (!current.signal.aborted) failed.value = true;
    } finally {
      if (current === controller) pending.value = false;
    }
  }, { immediate: true });
  onBeforeUnmount(() => controller?.abort());
  return { result, pending, failed, retry: () => { attempt.value++; } };
}

function topicNavigation() {
  const root = Vue.getCurrentInstance().proxy.$root;
  return (event, href) => root.internalLink(event, () => root.navNavigate(href));
}

const NewsSection = {
  props: { label: String, pending: Boolean },
  template: `<section class="entity-section" :aria-label="label" :aria-busy="pending">
    <div class="section-toolbar"><h2 class="credit-role-tag">{{ label }}</h2></div>
    <slot></slot>
  </section>`,
};

export const NewsTopics = {
  components: { NewsSection },
  props: { articleId: String },
  setup(props) {
    const { result } = useTopicRequest(() => ({ id: props.articleId }));
    return { topics: Vue.computed(() => result.value?.topics || []) };
  },
  template: `
    <news-section v-if="topics.length" class="news-topics" label="本文话题">
      <div class="performer-chip-list">
        <cast-chip v-for="item in topics" :key="item.type+':'+item.id" :type="item.type"
          :color="item.color" :href="item.href" :image="item.image" :label="item.title"></cast-chip>
      </div>
    </news-section>`,
};

export const RelatedNews = {
  components: { NewsSection },
  props: { type: String, entityId: String, standalone: Boolean },
  setup(props) {
    const page = Vue.ref(1);
    Vue.watch(() => [props.type, props.entityId], () => { page.value = 1; }, { flush: 'sync' });
    const { result, pending, failed, retry } = useTopicRequest(() => ({ type: props.type, id: props.entityId, page: page.value }));
    const shown = Vue.ref(null);
    Vue.watch(() => [props.type, props.entityId], () => { shown.value = null; }, { flush: 'sync' });
    Vue.watch(result, value => { if (value) shown.value = value; });
    function go(next) {
      if (!pending.value && next >= 1 && next <= shown.value?.page_count) page.value = next;
    }
    return { shown, pending, failed, retry, go, navigate: topicNavigation() };
  },
  template: `
    <news-section v-if="standalone || shown?.items.length" class="related-news" label="相关新闻" :pending="pending">
      <content-state v-if="failed" state="error" subject="相关新闻" :retry="true" @retry="retry"></content-state>
      <content-state v-else-if="standalone && pending && !shown" state="loading" subject="相关新闻"></content-state>
      <content-state v-else-if="standalone && !shown?.items.length" state="uncollected" subject="相关新闻"></content-state>
      <div v-if="shown?.items.length" class="history-list">
        <a v-for="item in shown.items" :key="item.id" :href="item.href" @click="navigate($event,item.href)">
          <time :datetime="item.date">{{ item.date }}</time><strong>{{ item.title }}</strong>
        </a>
      </div>
      <div v-if="shown?.page_count>1" class="ui-pager">
        <span>第 {{ shown.page }} / {{ shown.page_count }} 页</span>
        <div><button type="button" :disabled="pending || shown.page===1" @click="go(shown.page-1)">上一页</button><button type="button" :disabled="pending || shown.page===shown.page_count" @click="go(shown.page+1)">下一页</button></div>
      </div>
    </news-section>`,
};
