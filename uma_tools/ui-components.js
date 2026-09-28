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
    emits: ['toggle-play', 'previous', 'next', 'seek', 'skip', 'volume', 'toggle-mute', 'play-at', 'toggle-panel', 'close-panel', 'cycle-mode', 'dismiss', 'retry', 'remove-item', 'move-item', 'clear', 'open-voice'],
    data: function () { return { draggingIndex: -1, pointerId: null }; },
    computed: {
      current: function () { return this.player.current || null; },
      playing: function () { return this.player.status === 'playing' || this.player.status === 'buffering'; },
      loading: function () { return this.player.status === 'loading' || this.player.status === 'buffering'; },
      playedPercent: function () {
        return this.player.duration ? Math.min(100, Math.max(0, this.player.currentTime / this.player.duration * 100)) : 0;
      },
      bufferedPercent: function () {
        return this.player.duration ? Math.min(100, Math.max(this.playedPercent, this.player.buffered / this.player.duration * 100)) : 0;
      },
      progressStyle: function () {
        return { '--audio-played': this.playedPercent + '%', '--audio-buffered': this.bufferedPercent + '%' };
      },
      modeLabel: function () {
        return ({ list: '列表循环', one: '单曲循环', shuffle: '随机播放' })[this.player.playbackMode] || '列表循环';
      },
      statusText: function () {
        return ({
          loading: '正在载入', playing: '播放中', paused: '已暂停', buffering: '正在缓冲',
          ended: '播放结束', error: this.player.error || '试听暂时无法播放'
        })[this.player.status] || '';
      },
      queuePosition: function () {
        return this.player.queueIndex >= 0 ? (this.player.queueIndex + 1) + ' / ' + this.player.queue.length : this.player.queue.length + ' 首';
      }
    },
    watch: {
      'player.panelOpen': function (open) {
        if (!open) return;
        this.$nextTick(this.scrollCurrentIntoView);
      },
      'player.queueIndex': function () {
        if (this.player.panelOpen) this.$nextTick(this.scrollCurrentIntoView);
      }
    },
    mounted: function () {
      document.addEventListener('keydown', this.onDocumentKeydown);
      document.addEventListener('pointerdown', this.onDocumentPointerdown);
    },
    beforeUnmount: function () {
      document.removeEventListener('keydown', this.onDocumentKeydown);
      document.removeEventListener('pointerdown', this.onDocumentPointerdown);
      document.removeEventListener('pointermove', this.onDragMove);
      document.removeEventListener('pointerup', this.onDragEnd);
      document.removeEventListener('pointercancel', this.onDragEnd);
    },
    methods: {
      formatTime: function (seconds) {
        const value = Math.max(0, Number(seconds) || 0);
        const minutes = Math.floor(value / 60);
        return minutes + ':' + String(Math.floor(value % 60)).padStart(2, '0');
      },
      onSeek: function (event) { this.$emit('seek', Number(event.target.value)); },
      onDocumentKeydown: function (event) {
        if (event.key === 'Escape' && this.player.panelOpen) { this.$emit('close-panel'); return; }
        if (!this.player.current || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const target = event.target;
        if (target && target.closest && target.closest('input,textarea,select,button,a,[contenteditable="true"],[role="option"],[role="listbox"],.ui-select-control')) return;
        if (event.key === ' ' || event.code === 'Space') { event.preventDefault(); if (!event.repeat) this.$emit('toggle-play'); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); this.$emit('skip', -15); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); this.$emit('skip', 15); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); this.$emit('volume', Math.min(1, this.player.volume + 0.05)); }
        else if (event.key === 'ArrowDown') { event.preventDefault(); this.$emit('volume', Math.max(0, this.player.volume - 0.05)); }
      },
      onDocumentPointerdown: function (event) {
        if (!this.player.panelOpen) return;
        const panel = this.$refs.queuePanel;
        const toggle = this.$refs.queueToggle;
        if (panel && !panel.contains(event.target) && toggle && !toggle.contains(event.target)) this.$emit('close-panel');
      },
      onImageError: function (event) {
        event.currentTarget.classList.add('is-missing');
        event.currentTarget.removeAttribute('src');
      },
      queueArtist: function (track) {
        if (track && track.vocalists && track.vocalists.length) {
          return track.vocalists.map(function (vocalist) { return vocalist.name; }).filter(Boolean).join(' / ');
        }
        return (track && track.artist) || '';
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
      },
      startDrag: function (event, index) {
        if (this.player.queue.length < 2) return;
        event.preventDefault();
        this.draggingIndex = index;
        this.pointerId = event.pointerId;
        document.addEventListener('pointermove', this.onDragMove);
        document.addEventListener('pointerup', this.onDragEnd);
        document.addEventListener('pointercancel', this.onDragEnd);
      },
      onDragMove: function (event) {
        if (this.draggingIndex < 0 || (this.pointerId != null && event.pointerId !== this.pointerId)) return;
        const target = document.elementFromPoint(event.clientX, event.clientY);
        const row = target && target.closest ? target.closest('.audio-queue-row') : null;
        if (!row) return;
        const nextIndex = Number(row.dataset.index);
        if (!Number.isInteger(nextIndex) || nextIndex === this.draggingIndex) return;
        this.$emit('move-item', this.draggingIndex, nextIndex);
        this.draggingIndex = nextIndex;
      },
      onDragEnd: function () {
        this.draggingIndex = -1;
        this.pointerId = null;
        document.removeEventListener('pointermove', this.onDragMove);
        document.removeEventListener('pointerup', this.onDragEnd);
        document.removeEventListener('pointercancel', this.onDragEnd);
      }
    },
    template: `
      <template v-if="player.visible && (current || player.queue.length)">
        <section v-if="player.panelOpen" ref="queuePanel" class="audio-panel" role="region" aria-labelledby="audio-panel-title">
          <header class="audio-panel-head">
            <h2 id="audio-panel-title">播放列表 <em>{{ queuePosition }}</em></h2>
            <button class="audio-panel-clear" type="button" :disabled="!player.queue.length" @click="$emit('clear')">清空</button>
            <button ref="closePanel" class="audio-icon-btn audio-panel-close" type="button" aria-label="关闭播放列表" title="关闭" @click="$emit('close-panel')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <div ref="queueList" class="audio-queue" role="list" aria-label="播放列表">
            <div v-for="(track,index) in player.queue" :key="track.id+'-'+index" class="audio-queue-row" :class="{active:index===player.queueIndex,dragging:index===draggingIndex}" role="listitem" :data-index="index" :aria-current="index===player.queueIndex?'true':undefined">
              <button class="audio-queue-drag" type="button" aria-label="拖动调整顺序" title="拖动调整顺序" @pointerdown="startDrag($event,index)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 5h8M6 10h8M6 15h8"/></svg></button>
              <button class="audio-queue-select" type="button" @click="$emit('play-at',index)">
                <span class="audio-queue-number">{{ index + 1 }}</span>
                <span class="audio-queue-copy"><b>{{ track.name }}</b><small>{{ queueArtist(track) }}</small></span>
                <span v-if="index===player.queueIndex && playing" class="audio-playing-bars" aria-label="当前曲目"><i></i><i></i><i></i></span>
              </button>
              <button class="audio-queue-remove" type="button" aria-label="从播放列表移除" title="移除" @click="$emit('remove-item',index)"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5 5 15"/></svg></button>
            </div>
          </div>
        </section>

        <section class="audio-dock" :class="['is-'+player.status,{expanded:player.panelOpen}]" role="region" aria-label="音频播放器" :style="progressStyle">
          <div class="audio-dock-inner">
            <div class="audio-cover">
              <img v-if="current && current.cover" :src="current.cover" alt="" @error="onImageError">
              <span v-if="current && playing" class="audio-playing-bars" aria-hidden="true"><i></i><i></i><i></i></span>
            </div>
            <div class="audio-dock-copy">
              <b class="audio-title">{{ current ? current.name : '播放列表' }}</b>
              <div v-if="current && current.vocalists.length" class="audio-dock-vocalists" aria-label="演唱声优">
                <template v-for="vocalist in current.vocalists" :key="vocalist.id || vocalist.name">
                  <button v-if="vocalist.id" type="button" @click="openVoice(vocalist)">{{ vocalist.name }}</button>
                  <span v-else>{{ vocalist.name }}</span>
                </template>
              </div>
              <span v-else class="audio-dock-artist">{{ current ? current.artist : '选择一首开始播放' }}</span>
            </div>
            <div class="audio-dock-controls">
              <button class="audio-control audio-mode" type="button" :aria-label="modeLabel" :title="modeLabel" @click="$emit('cycle-mode')">
                <svg v-if="player.playbackMode==='shuffle'" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3c4 0 5 10 9 10h4M17 14l3 3-3 3M4 17h3c1.5 0 2.6-1.4 3.6-3M15 7h5M17 4l3 3-3 3"/></svg>
                <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l3 3-3 3M4 6h16M7 21l-3-3 3-3M20 18H4"/><path v-if="player.playbackMode==='one'" d="M11 10h2v5"/></svg>
              </button>
              <button class="audio-control" type="button" :disabled="!current" aria-label="上一首" title="上一首" @click="$emit('previous')"><svg class="audio-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM18 6 9 12l9 6z"/></svg></button>
              <button class="audio-control audio-skip" type="button" :disabled="!current" aria-label="后退 15 秒" title="后退 15 秒" @click="$emit('skip',-15)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8H4V4M4.6 8.2A8 8 0 1 1 4 14"/><text x="8" y="16">15</text></svg></button>
              <button class="audio-control audio-control-primary" type="button" :disabled="!current" :aria-label="playing?'暂停':'播放'" :title="playing?'暂停':'播放'" @click="$emit('toggle-play')">
                <span v-if="loading" class="audio-hoof-loader" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 4v7a7 7 0 0 0 14 0V4h-4v7a3 3 0 0 1-6 0V4z"/><circle cx="7" cy="7" r=".8"/><circle cx="17" cy="7" r=".8"/></svg></span>
                <svg v-else-if="playing" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM14 5h4v14h-4z"/></svg>
                <svg v-else viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg>
              </button>
              <button class="audio-control audio-skip" type="button" :disabled="!current" aria-label="前进 15 秒" title="前进 15 秒" @click="$emit('skip',15)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 8h4V4m-.6 4.2A8 8 0 1 0 20 14"/><text x="7" y="16">15</text></svg></button>
              <button class="audio-control" type="button" :disabled="!current" aria-label="下一首" title="下一首" @click="$emit('next')"><svg class="audio-solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM6 6l9 6-9 6z"/></svg></button>
            </div>
            <div class="audio-dock-progress">
              <span>{{ formatTime(player.currentTime) }}</span>
              <input type="range" min="0" :max="player.duration || 0" step="0.1" :value="player.currentTime" :disabled="!current || !player.duration" aria-label="播放进度" :aria-valuetext="formatTime(player.currentTime)+' / '+formatTime(player.duration)" @input="onSeek">
              <span>{{ formatTime(player.duration) }}</span>
            </div>
            <div class="audio-volume">
              <button class="audio-control" type="button" :aria-label="player.muted?'取消静音':'静音'" :title="player.muted?'取消静音':'静音'" @click="$emit('toggle-mute')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9v6h4l5 4V5L9 9z"/><path v-if="!player.muted && player.volume>0" d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/><path v-else d="m17 9 5 6M22 9l-5 6"/></svg></button>
              <input type="range" min="0" max="1" step="0.05" :value="player.muted?0:player.volume" aria-label="音量" @input="$emit('volume',Number($event.target.value))">
            </div>
            <button ref="queueToggle" class="audio-queue-toggle" type="button" :class="{active:player.panelOpen}" aria-label="播放列表" title="播放列表" :aria-expanded="player.panelOpen" @click="$emit('toggle-panel')">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
              <em>{{ player.queue.length }}</em>
            </button>
            <button class="audio-dismiss" type="button" aria-label="关闭播放器" title="关闭播放器" @click="$emit('dismiss')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
          </div>
          <div v-if="player.status==='error'" class="audio-error" role="alert"><span>{{ player.error }}</span><button type="button" @click="$emit('retry')">重试</button></div>
          <div class="audio-live-status" aria-live="polite">{{ statusText }}</div>
        </section>
      </template>`
  };

  window.UmaUi = Object.freeze({ UiSelect: UiSelect, AudioDock: AudioDock });
})();
