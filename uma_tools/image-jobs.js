'use strict';

/** Shared image work stays queued only while it has a live consumer. */
class ImageJobs {
  constructor(concurrency, capacity = 64) {
    this.concurrency = concurrency;
    this.capacity = capacity;
    this.active = 0;
    this.waiting = [];
    this.jobs = new Map();
  }
  run(key, work, signal, timeout) {
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('image cancelled'));
    let job = this.jobs.get(key);
    if (job?.controller.signal.aborted) job = null;
    if (!job) {
      if (this.waiting.length >= this.capacity) return Promise.reject(new Error('image queue full'));
      const controller = new AbortController();
      job = { key, work, controller, listeners: [], started: false, expires: Date.now() + timeout };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      job.finish = (error, result) => {
        if (job.finished) return;
        job.finished = true;
        clearTimeout(job.timer);
        for (const row of job.listeners) row.signal?.removeEventListener('abort', row.abort);
        if (this.jobs.get(key) === job) this.jobs.delete(key);
        if (error) job.reject(error); else job.resolve(result);
      };
      controller.signal.addEventListener('abort', () => {
        if (!job.started) {
          this.waiting = this.waiting.filter(row => row !== job);
          job.finish(controller.signal.reason || new Error('image cancelled'));
        }
      }, { once: true });
      job.timer = setTimeout(() => controller.abort(new Error('image queue deadline exceeded')), timeout);
      this.jobs.set(key, job);
      this.waiting.push(job);
    }
    const abort = () => {
      if (job.listeners.every(row => row.signal?.aborted)) job.controller.abort(new Error('image cancelled'));
    };
    job.listeners.push({ signal, abort });
    signal?.addEventListener('abort', abort, { once: true });
    this.pump();
    return job.promise;
  }
  pump() {
    while (this.active < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift();
      if (job.finished) continue;
      job.started = true;
      this.active++;
      Promise.resolve().then(() => {
        if (job.controller.signal.aborted) throw job.controller.signal.reason;
        return job.work(job.controller.signal, job.expires);
      }).then(result => job.finish(null, result), error => job.finish(error))
        .finally(() => { this.active--; this.pump(); });
    }
  }
}

module.exports = { ImageJobs };
