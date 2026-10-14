'use strict';

class TranslationQueue {
  constructor() { this.queue = []; this.running = false; }
  run(work, callerSignal, priority = 1) {
    return new Promise(resolve => {
      const controller = new AbortController();
      const entry = { work, priority, controller, resolve };
      const cancel = () => controller.abort();
      const timer = setTimeout(cancel, 45000);
      entry.finish = value => {
        clearTimeout(timer);
        if (callerSignal) callerSignal.removeEventListener('abort', cancel);
        resolve(value);
      };
      controller.signal.addEventListener('abort', () => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) { this.queue.splice(index, 1); entry.finish(null); }
      }, { once: true });
      this.queue.push(entry);
      if (callerSignal) {
        callerSignal.addEventListener('abort', cancel, {once:true});
        if (callerSignal.aborted) cancel();
      }
      this.queue.sort((a, b) => a.priority - b.priority);
      this.pump();
    });
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const entry = this.queue.shift();
        try { entry.finish(entry.controller.signal.aborted ? null : await entry.work(entry.controller.signal)); }
        catch (_) { entry.finish(null); }
      }
    } finally { this.running = false; }
  }
}

module.exports = { TranslationQueue };
