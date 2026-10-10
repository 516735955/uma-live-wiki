'use strict';

const fs = require('fs');
const crypto = require('crypto');

function mergeNews(previous, incoming) {
  const rows = new Map(previous.map((item) => [String(item.announce_id), { ...item }]));
  incoming.forEach((item) => {
    const key = String(item.announce_id);
    const old = rows.get(key) || {};
    const merged = { ...old };
    Object.entries(item).forEach(([field, value]) => {
      if (value !== null && value !== undefined && value !== '') merged[field] = value;
    });
    if (old.image) merged.image = old.image;
    if (old.title && item.title && old.title !== item.title) merged.title_zh = item.title_zh || '';
    rows.set(key, merged);
  });
  return Array.from(rows.values());
}

class NewsContent {
  constructor(file, translation, previousTranslation = () => '') {
    this.file = file;
    this.translation = translation;
    this.previousTranslation = previousTranslation;
    this.mtime = 0;
    this.edits = { titles: {}, messages: {}, news: {} };
  }
  reload() {
    const stat = fs.statSync(this.file);
    if (stat.mtimeMs !== this.mtime) {
      this.edits = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.mtime = stat.mtimeMs;
    }
  }
  title(source, existing) {
    this.reload();
    const edited = existing && existing !== this.previousTranslation(source) ? existing : '';
    return this.edits.titles[source] || edited || this.translation(source) || existing || '';
  }
  apply(item) {
    this.reload();
    const edit = this.edits.news[String(item.announce_id)];
    const result = { ...item, title_zh: this.title(item.title, item.title_zh) };
    if (edit) {
      Object.entries(edit).forEach(([field, value]) => {
        if (field === 'source_title' || field === 'source_message') return;
        if (field === 'title_zh' && edit.source_title !== item.title) return;
        if (field === 'message_zh' && edit.source_message !== 'msg_' + crypto.createHash('md5').update(item.message || '').digest('hex')) return;
        result[field] = value;
      });
    }
    return result;
  }
  message(key) {
    this.reload();
    return this.edits.messages[key] || '';
  }
}

module.exports = { mergeNews, NewsContent };
