const STATE_TEXT = {
  uncollected: subject => `尚未收录${subject}`,
  not_announced: subject => `官方尚未公布${subject}`,
  not_published: subject => `${subject}未公开`,
  not_applicable: subject => `${subject}不适用`,
  confirmed_none: subject => `已确认没有${subject}`,
  loading: subject => `正在加载${subject}…`,
  error: subject => `${subject}加载失败`,
  filtered: subject => `没有符合条件的${subject}`,
};
export const ContentState = {
  props: {
    state: { type: String, default: 'uncollected' },
    subject: { type: String, default: '内容' },
    reason: { type: String, default: '' },
    retry: { type: Boolean, default: false },
    clear: { type: Boolean, default: false },
  },
  emits: ['retry', 'clear'],
  computed: {
    message() {
      if (this.reason) return this.reason;
      const render = STATE_TEXT[this.state] || STATE_TEXT.uncollected;
      return render(this.subject);
    },
  },
  template: `<div class="ui-state compact content-state" :class="['content-state-'+state, {'ui-state-error':state==='error'}]" :role="state==='error'?'alert':'status'" :aria-busy="state==='loading' ? 'true' : undefined"><span>{{ message }}</span><button v-if="retry" type="button" class="ui-retry" @click="$emit('retry')">重试</button><button v-if="clear" type="button" class="ui-retry" @click="$emit('clear')">清除筛选</button></div>`,
};
