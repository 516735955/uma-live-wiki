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
    if (old.image && (!item.image || old.image_source === 'manual')) merged.image = old.image;
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
    this.checkedAt = 0;
    this.edits = { titles: {}, messages: {}, news: {} };
  }
  reload() {
    if (Date.now() - this.checkedAt < 1000) return;
    this.checkedAt = Date.now();
    try {
      const stat = fs.statSync(this.file);
      if (stat.mtimeMs !== this.mtime) {
        const edits = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (!edits || typeof edits !== 'object' || Array.isArray(edits)) throw new Error('invalid news edits');
        for (const key of ['titles', 'messages', 'news']) {
          if (edits[key] && (typeof edits[key] !== 'object' || Array.isArray(edits[key]))) throw new Error('invalid news edits field');
        }
        if (edits.removed && !Array.isArray(edits.removed)) throw new Error('invalid removed news list');
        this.edits = { ...edits, titles: edits.titles || {}, messages: edits.messages || {}, news: edits.news || {} };
        this.mtime = stat.mtimeMs;
        this.reloadError = '';
      }
    } catch (error) {
      if (this.reloadError !== error.message) console.warn('[news] keeping last usable edits:', error.message);
      this.reloadError = error.message;
    }
  }
  title(source, existing) {
    this.reload();
    const edited = existing && existing !== this.previousTranslation(source) ? existing : '';
    return this.edits.titles[source] || edited || this.translation(source) || existing || '';
  }
  isRemoved(key) {
    this.reload();
    return (this.edits.removed || []).includes(key);
  }
  apply(item) {
    this.reload();
    const edit = this.edits.news[String(item.announce_id)];
    const result = { ...item, title_zh: this.title(item.title, item.title_zh) };
    if (edit) {
      if (edit.image) result.image_source = 'manual';
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

function absoluteArticleLinks(markup, base) {
  return String(markup || '').replace(/\b(href|src)\s*=\s*(["'])([^"']*)\2/gi, (whole, attr, quote, value) => {
    if (!value || value.startsWith('#')) return whole;
    try {
      const url = new URL(value.replace(/&amp;/g, '&'), base);
      if (!['http:', 'https:'].includes(url.protocol)) return whole;
      return attr + '=' + quote + url.href.replace(/&/g, '&amp;').replace(/'/g, '&#39;') + quote;
    } catch (_) { return whole; }
  });
}

module.exports = { mergeNews, NewsContent, absoluteArticleLinks };
