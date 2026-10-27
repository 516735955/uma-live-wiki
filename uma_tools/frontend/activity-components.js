/* Shared time and activity-record presentations. Register from components.js. */

export function normalizeActivityTime(date, value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return { date: date || '', time: raw };
  const hour = Number(match[1]);
  const minute = match[2];
  if (hour < 24) return { date: date || '', time: `${String(hour).padStart(2, '0')}:${minute}` };
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { date: date || '', time: `${String(hour - 24).padStart(2, '0')}:${minute}` };
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + Math.floor(hour / 24));
  return { date: next.toISOString().slice(0, 10), time: `${String(hour % 24).padStart(2, '0')}:${minute}` };
}

export function parseScheduleDisplay(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})(?::\d{2})?(?:([+-]\d{2}:?\d{2}|Z)|\s*(?:JST|日本時間))?(.*)$/i);
  if (!match) return { date: '', time: '', suffix: raw };
  const suffix = String(match[4] || '').trim();
  if (match[3]) {
    const instant = new Date(`${match[1]}T${match[2]}:00${match[3] === 'Z' ? 'Z' : match[3]}`);
    if (!Number.isNaN(instant.getTime())) {
      const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
      const get = (name) => parts.find((part) => part.type === name)?.value || '';
      return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, suffix };
    }
  }
  const normalized = normalizeActivityTime(match[1], match[2]);
  return { date: normalized.date, time: normalized.time, suffix };
}

function formatClock(value, date) {
  return normalizeActivityTime(date, value).time;
}

export const ActivityTime = {
  props: {
    date: { type: String, default: '' }, endDate: { type: String, default: '' },
    doorsTime: { type: String, default: '' }, startTime: { type: String, default: '' },
    endTime: { type: String, default: '' }, broadcastTime: { type: String, default: '' },
    broadcastDate: { type: String, default: '' },
    publishedTime: { type: String, default: '' }, publishedDate: { type: String, default: '' },
    endEstimated: { type: Boolean, default: false },
    startEstimated: { type: Boolean, default: false },
    note: { type: String, default: '' },
    label: { type: String, default: '时间' }, channels: { type: Array, default: () => [] },
  },
  computed: {
    dateText() {
      if (!this.date) return '日期待补';
      const first = normalizeActivityTime(this.date, this.startTime || this.broadcastTime || this.doorsTime);
      const from = first.date || this.date;
      return this.endDate && this.endDate !== this.date ? `${from} — ${this.endDate}` : from;
    },
    rows() {
      const rows = [
        ['开场', this.doorsTime, this.date],
        [this.startEstimated ? '预计开演' : '开演', this.startTime, this.date],
        [this.endEstimated ? '预计结束' : '结束', this.endTime, this.endDate || this.date],
        ['播出', this.broadcastTime, this.broadcastDate || this.date],
        ['公开', this.publishedTime, this.publishedDate || this.date],
        ['安排', this.note, ''],
      ].filter((row) => row[1]).map(([label, value, date]) => {
        const normalized = normalizeActivityTime(date, value);
        return { label, value: normalized.time || value, date: normalized.date || date };
      });
      const broadcast = rows.find((row) => row.label === '播出');
      return rows.filter((row) => row.label !== '公开' || !broadcast
        || !row.date || !broadcast.date || row.date !== broadcast.date || row.value !== broadcast.value);
    },
    channelRows() {
      const seen = new Set();
      return this.channels.map((channel) => {
        const parsed = parseScheduleDisplay(channel.display || channel.value || '');
        // A display string can carry the authoritative cross-day clock (24:00+).
        // Prefer its normalized date so a source date of 2018-04-01 with
        // “2018-04-01 24:00” is rendered as the actual 2018-04-02 00:00.
        const rawDate = parsed.date || channel.date || '';
        // When display already supplied a parsed date/time (including an
        // offset or 24:00), do not feed the original clock through a second
        // midnight normalization pass.
        const rawTime = parsed.time || channel.time || channel.start_time || channel.broadcast_time || '';
        const normalized = normalizeActivityTime(rawDate, rawTime);
        return {
          label: channel.label || '公开', value: normalized.date || rawDate || parsed.suffix,
          time: normalized.time || rawTime, suffix: channel.note || parsed.suffix,
          hasDate: Boolean(normalized.date || rawDate),
          sortDate: `${normalized.date || rawDate} ${normalized.time || rawTime}`,
        };
      }).filter((row) => row.value || row.time)
        .sort((a, b) => (a.hasDate ? 0 : 1) - (b.hasDate ? 0 : 1) || a.sortDate.localeCompare(b.sortDate))
        .filter((row) => {
          const key = `${row.label}|${row.value}|${row.time}|${row.suffix}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    },
    primaryChannel() { return this.channelRows[0] || null; },
    otherChannels() { return this.channelRows.slice(1); },
  },
  methods: { formatClock, formatRowTime(row) { const time = row.value || ''; return row.date && row.date !== this.date ? `${row.date}　${time}` : time; } },
  template: `<dl class="entity-meta activity-time-info"><div v-if="!channelRows.length"><dt>{{ label }}</dt><dd>{{ dateText }}</dd></div><div v-if="primaryChannel"><dt>{{ primaryChannel.label }}</dt><dd>{{ primaryChannel.value }}<template v-if="primaryChannel.time">　{{ primaryChannel.time }}</template><small v-if="primaryChannel.suffix"> {{ primaryChannel.suffix }}</small></dd></div><details v-if="otherChannels.length" class="activity-time-more"><summary>其他播出时间（{{ otherChannels.length }}）</summary><div v-for="row in otherChannels" :key="row.label+'-'+row.value"><dt>{{ row.label }}</dt><dd>{{ row.value }}<template v-if="row.time">　{{ row.time }}</template><small v-if="row.suffix"> {{ row.suffix }}</small></dd></div></details><div v-for="row in rows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ formatRowTime(row) }}</dd></div></dl>`,
};

export const ActivityHistory = {
  props: { events: { type: Array, default: () => [] }, routes: { type: Object, required: true }, dateLabel: { type: Function, required: true }, kindLabel: { type: Function, required: true }, sessionLabel: { type: Function, required: true } },
  emits: ['open'],
  methods: {
    label(event) { return event.child_label || this.sessionLabel(event); },
    title(event) { return event.parent_title || event.title; },
    href(event) { return this.routes.events(event.event_id, event.session_id); },
    open(event, click) { if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return; click.preventDefault(); this.$emit('open', event); },
  },
  template: `<div class="history-list"><a v-for="(event,index) in events" :key="event.event_id+'-'+(event.session_id||'event')" :class="{'history-group-start':index>0 && event.participation_scope==='voice' && events[index-1].participation_scope!=='voice'}" :href="href(event)" @click="open(event,$event)"><time>{{ dateLabel(event) }}</time><span>{{ title(event) }}<em v-if="label(event)" class="credit-role-tag session-tag">{{ label(event) }}</em><em v-if="event.participation_label" class="credit-role-tag session-tag">{{ event.participation_label }}</em></span><em>{{ kindLabel(event.kind) }}</em></a></div>`,
};
