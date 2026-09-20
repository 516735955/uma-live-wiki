(function () {
  'use strict';

  let sequence = 0;
  const UiSelect = {
    props: {
      modelValue: { type: [String, Number], default: '' },
      options: { type: Array, default: function () { return []; } },
      label: { type: String, default: '' },
      ariaLabel: { type: String, default: '' }
    },
    emits: ['update:modelValue', 'change'],
    data: function () {
      sequence += 1;
      return { open: false, activeIndex: -1, listId: 'ui-select-' + sequence };
    },
    computed: {
      selectedOption: function () {
        const value = String(this.modelValue);
        return this.options.find(function (option) {
          return String(option.value) === value;
        }) || this.options[0] || { label: '' };
      }
    },
    mounted: function () { document.addEventListener('pointerdown', this.onOutside); },
    beforeUnmount: function () { document.removeEventListener('pointerdown', this.onOutside); },
    methods: {
      onOutside: function (event) {
        if (this.open && !this.$el.contains(event.target)) this.close();
      },
      close: function () { this.open = false; this.activeIndex = -1; },
      toggle: function () {
        this.open = !this.open;
        this.activeIndex = this.open
          ? Math.max(0, this.options.findIndex(function (option) {
              return String(option.value) === String(this.modelValue);
            }, this))
          : -1;
      },
      choose: function (option) {
        if (!option || option.disabled) return;
        this.$emit('update:modelValue', option.value);
        this.$emit('change', option.value);
        this.close();
        this.$nextTick(() => {
          if (this.$refs.trigger) this.$refs.trigger.focus();
        });
      },
      onKeydown: function (event) {
        if (event.key === 'Escape' || event.key === 'Tab') { this.close(); return; }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (!this.open) this.toggle();
          else this.choose(this.options[this.activeIndex]);
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        if (!this.open) this.open = true;
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const total = this.options.length;
        if (!total) return;
        let next = this.activeIndex < 0 ? 0 : this.activeIndex;
        do { next = (next + direction + total) % total; } while (this.options[next] && this.options[next].disabled);
        this.activeIndex = next;
      }
    },
    template: `
      <div class="ui-select-control" :class="{open:open}">
        <span v-if="label" class="ui-select-label">{{ label }}</span>
        <button ref="trigger" class="ui-select-trigger" type="button" :aria-label="ariaLabel || label" :aria-expanded="open" :aria-controls="listId" @click="toggle" @keydown="onKeydown">
          <span>{{ selectedOption.label }}</span>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>
        </button>
        <div v-show="open" :id="listId" class="ui-select-menu" role="listbox">
          <button v-for="(option,index) in options" :key="String(option.value)" type="button" role="option" :disabled="option.disabled" :aria-selected="String(option.value)===String(modelValue)" :class="{selected:String(option.value)===String(modelValue),active:index===activeIndex}" @pointerenter="activeIndex=index" @click="choose(option)">
            <span>{{ option.label }}</span>
            <svg v-if="String(option.value)===String(modelValue)" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>
          </button>
        </div>
      </div>`
  };

  const AudioDock = {
    props: {
      player: { type: Object, required: true }
    },
    emits: ['toggle-play', 'previous', 'next', 'seek', 'play-at', 'toggle-panel', 'close-panel', 'retry', 'remove-item', 'move-item', 'open-voice'],
    computed: {
      current: function () { return this.player.current || null; },
      playing: function () { return this.player.status === 'playing' || this.player.status === 'buffering'; },
      loading: function () { return this.player.status === 'loading' || this.player.status === 'buffering'; },
      canPrevious: function () { return this.player.queueIndex > 0 || this.player.currentTime > 0; },
      canNext: function () { return this.player.queueIndex >= 0 && this.player.queueIndex < this.player.queue.length - 1; },
      playedPercent: function () {
        return this.player.duration ? Math.min(100, Math.max(0, this.player.currentTime / this.player.duration * 100)) : 0;
      },
      bufferedPercent: function () {
        return this.player.duration ? Math.min(100, Math.max(this.playedPercent, this.player.buffered / this.player.duration * 100)) : 0;
      },
      progressStyle: function () {
        return { '--audio-played': this.playedPercent + '%', '--audio-buffered': this.bufferedPercent + '%' };
      },
      statusText: function () {
        return ({
          idle: '', loading: '正在载入试听', ready: '可以播放', playing: '正在播放', paused: '已暂停',
          buffering: '网络缓冲中', ended: '播放结束', error: this.player.error || '试听暂时无法播放'
        })[this.player.status] || '';
      }
    },
    watch: {
      'player.panelOpen': function (open) {
        document.body.classList.toggle('audio-panel-open', !!open);
        if (!open) return;
        this.$nextTick(() => {
          if (this.$refs.closePanel) this.$refs.closePanel.focus({ preventScroll: true });
          this.scrollCurrentIntoView();
        });
      },
      'player.queueIndex': function () {
        if (this.player.panelOpen) this.$nextTick(this.scrollCurrentIntoView);
      }
    },
    mounted: function () { document.addEventListener('keydown', this.onDocumentKeydown); },
    beforeUnmount: function () {
      document.removeEventListener('keydown', this.onDocumentKeydown);
      document.body.classList.remove('audio-panel-open');
    },
    methods: {
      formatTime: function (seconds) {
        const value = Math.max(0, Number(seconds) || 0);
        const minutes = Math.floor(value / 60);
        return minutes + ':' + String(Math.floor(value % 60)).padStart(2, '0');
      },
      onSeek: function (event) { this.$emit('seek', Number(event.target.value)); },
      onDocumentKeydown: function (event) {
        if (event.key === 'Escape' && this.player.panelOpen) this.$emit('close-panel');
      },
      onImageError: function (event) {
        event.currentTarget.classList.add('is-missing');
        event.currentTarget.removeAttribute('src');
      },
      scrollCurrentIntoView: function () {
        const list = this.$refs.queueList;
        if (!list) return;
        const row = list.querySelector('[aria-current="true"]');
        if (row) row.scrollIntoView({ block: 'nearest' });
      },
      openVoice: function (vocalist) {
        if (!vocalist || !vocalist.id) return;
        this.$emit('close-panel');
        this.$emit('open-voice', vocalist.id);
      }
    },
    template: `
      <template v-if="current">
        <div v-if="player.panelOpen" class="audio-panel-backdrop" aria-hidden="true" @click="$emit('close-panel')"></div>
        <section v-if="player.panelOpen" class="audio-panel" role="dialog" aria-modal="false" aria-labelledby="audio-panel-title">
          <header class="audio-panel-head">
            <div>
              <span class="audio-kicker">NEXT UP</span>
              <h2 id="audio-panel-title">播放列表 <em>{{ player.queue.length }}</em></h2>
              <p>{{ player.contextLabel || '当前试听' }}</p>
            </div>
            <button ref="closePanel" class="audio-icon-btn audio-panel-close" type="button" aria-label="关闭播放列表" title="关闭" @click="$emit('close-panel')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          </header>

          <div class="audio-now">
            <div class="audio-now-cover-wrap">
              <img v-if="current.cover" class="audio-now-cover" :src="current.cover" alt="" @error="onImageError">
              <span class="audio-now-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4M8 16l-2 4M16 16l2 4"/></svg></span>
            </div>
            <div class="audio-now-copy">
              <span class="audio-status" :class="'is-'+player.status"><i aria-hidden="true"></i>{{ statusText }}</span>
              <h3>{{ current.name }}</h3>
              <p v-if="current.album" class="audio-album">{{ current.album }}</p>
              <div v-if="current.vocalists.length" class="audio-vocalists" aria-label="演唱声优">
                <template v-for="vocalist in current.vocalists" :key="vocalist.id || vocalist.name">
                  <button v-if="vocalist.id" type="button" :style="{'--voice-color':vocalist.color}" @click="openVoice(vocalist)">
                    <img v-if="vocalist.image" :src="vocalist.image" alt="" @error="onImageError"><span>{{ vocalist.name }}</span>
                  </button>
                  <span v-else class="audio-vocalist-text">{{ vocalist.name }}</span>
                </template>
              </div>
              <p v-else class="audio-artist-fallback">{{ current.artist }}</p>
            </div>
          </div>

          <div class="audio-panel-controls">
            <button class="audio-control" type="button" aria-label="上一首" title="上一首" :disabled="!canPrevious" @click="$emit('previous')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 6 9 12l9 6z"/></svg>
            </button>
            <button class="audio-control audio-control-primary" type="button" :aria-label="playing?'暂停':'播放'" :title="playing?'暂停':'播放'" @click="$emit('toggle-play')">
              <span v-if="loading" class="audio-hoof-loader" aria-hidden="true"><i></i><i></i><i></i></span>
              <svg v-else-if="playing" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM14 5h4v14h-4z"/></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>
            </button>
            <button class="audio-control" type="button" aria-label="下一首" title="下一首" :disabled="!canNext" @click="$emit('next')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 6l9 6-9 6z"/></svg>
            </button>
          </div>

          <div class="audio-panel-progress" :style="progressStyle">
            <span>{{ formatTime(player.currentTime) }}</span>
            <input type="range" min="0" :max="player.duration || 0" step="0.1" :value="player.currentTime" :disabled="!player.duration" aria-label="播放进度" :aria-valuetext="formatTime(player.currentTime)+' / '+formatTime(player.duration)" @input="onSeek">
            <span>{{ formatTime(player.duration) }}</span>
          </div>

          <div v-if="player.status==='error'" class="audio-error" role="alert">
            <span>{{ player.error }}</span><button type="button" @click="$emit('retry')">重新载入</button>
          </div>

          <div ref="queueList" class="audio-queue" role="list" aria-label="播放列表">
            <div v-for="(track,index) in player.queue" :key="track.id+'-'+index" class="audio-queue-row" :class="{active:index===player.queueIndex}" role="listitem" :aria-current="index===player.queueIndex?'true':undefined">
              <button class="audio-queue-select" type="button" @click="$emit('play-at',index)">
                <span class="audio-queue-number">{{ String(index+1).padStart(2,'0') }}</span>
                <img v-if="track.cover" :src="track.cover" alt="" loading="lazy" @error="onImageError"><span v-else class="audio-cover-placeholder" aria-hidden="true"></span>
                <span class="audio-queue-copy"><b>{{ track.name }}</b><small>{{ track.album || track.artist }}</small></span>
                <span v-if="index===player.queueIndex" class="audio-playing-bars" aria-label="当前曲目"><i></i><i></i><i></i></span>
              </button>
              <div v-if="track.vocalists.length" class="audio-queue-vocalists">
                <template v-for="vocalist in track.vocalists" :key="vocalist.id || vocalist.name">
                  <button v-if="vocalist.id" type="button" @click="openVoice(vocalist)">{{ vocalist.name }}</button>
                  <span v-else>{{ vocalist.name }}</span>
                </template>
              </div>
              <div class="audio-queue-actions">
                <button type="button" aria-label="上移" title="上移" :disabled="index===0" @click="$emit('move-item',index,-1)"><svg viewBox="0 0 20 20"><path d="m5 12 5-5 5 5"/></svg></button>
                <button type="button" aria-label="下移" title="下移" :disabled="index===player.queue.length-1" @click="$emit('move-item',index,1)"><svg viewBox="0 0 20 20"><path d="m5 8 5 5 5-5"/></svg></button>
                <button type="button" aria-label="从播放列表移除" title="移除" @click="$emit('remove-item',index)"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg></button>
              </div>
            </div>
          </div>
        </section>

        <section class="audio-dock" :class="['is-'+player.status,{expanded:player.panelOpen}]" role="region" aria-label="音频播放器" :style="progressStyle">
          <div class="audio-rail" aria-hidden="true"><span></span><i><svg viewBox="0 0 24 24"><path d="M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4"/></svg></i></div>
          <div class="audio-dock-inner">
            <button class="audio-cover-button" type="button" title="查看正在播放" @click="$emit('toggle-panel')">
              <img v-if="current.cover" :src="current.cover" alt="" @error="onImageError">
              <span v-if="playing" class="audio-playing-bars" aria-hidden="true"><i></i><i></i><i></i></span>
            </button>
            <div class="audio-dock-copy">
              <button class="audio-title-button" type="button" @click="$emit('toggle-panel')"><b>{{ current.name }}</b><small v-if="current.album">{{ current.album }}</small></button>
              <div v-if="current.vocalists.length" class="audio-dock-vocalists" aria-label="演唱声优">
                <template v-for="vocalist in current.vocalists" :key="vocalist.id || vocalist.name">
                  <button v-if="vocalist.id" type="button" @click="openVoice(vocalist)">{{ vocalist.name }}</button>
                  <span v-else>{{ vocalist.name }}</span>
                </template>
              </div>
              <span v-else class="audio-dock-artist">{{ current.artist }}</span>
            </div>
            <div class="audio-dock-controls">
              <button class="audio-control" type="button" aria-label="上一首" title="上一首" :disabled="!canPrevious" @click="$emit('previous')"><svg viewBox="0 0 24 24"><path d="M6 5v14M18 6 9 12l9 6z"/></svg></button>
              <button class="audio-control audio-control-primary" type="button" :aria-label="playing?'暂停':'播放'" :title="playing?'暂停':'播放'" @click="$emit('toggle-play')">
                <span v-if="loading" class="audio-hoof-loader" aria-hidden="true"><i></i><i></i><i></i></span>
                <svg v-else-if="playing" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM14 5h4v14h-4z"/></svg>
                <svg v-else viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>
              </button>
              <button class="audio-control" type="button" aria-label="下一首" title="下一首" :disabled="!canNext" @click="$emit('next')"><svg viewBox="0 0 24 24"><path d="M18 5v14M6 6l9 6-9 6z"/></svg></button>
            </div>
            <div class="audio-dock-progress">
              <span>{{ formatTime(player.currentTime) }}</span>
              <input type="range" min="0" :max="player.duration || 0" step="0.1" :value="player.currentTime" :disabled="!player.duration" aria-label="播放进度" :aria-valuetext="formatTime(player.currentTime)+' / '+formatTime(player.duration)" @input="onSeek">
              <span>{{ formatTime(player.duration) }}</span>
            </div>
            <button class="audio-queue-toggle" type="button" :class="{active:player.panelOpen}" :aria-expanded="player.panelOpen" @click="$emit('toggle-panel')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
              <span>播放列表</span><em>{{ player.queue.length }}</em>
            </button>
          </div>
          <div class="audio-live-status" aria-live="polite">{{ statusText }}</div>
        </section>
      </template>`
  };

  window.UmaUi = Object.freeze({ UiSelect: UiSelect, AudioDock: AudioDock });
})();
