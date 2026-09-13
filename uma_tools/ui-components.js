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

  window.UmaUi = Object.freeze({ UiSelect: UiSelect });
})();
