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

function extractLantisArticle(body, url) {
  const titleMatch = body.match(/<h2[^>]*class="newsin_title"[^>]*>([\s\S]*?)<\/h2>/i) || body.match(/<title>([^<]*)<\/title>/i);
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', middot: '·',
    laquo: '«', raquo: '»', yen: '¥', times: '×', plusmn: '±' };
  const title = String(titleMatch?.[1] || '').replace(/<[^>]+>/g, '')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, value) => {
      const point = /^x/i.test(value) ? parseInt(value.slice(1), 16) : Number(value);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
    }).replace(/&([a-z][a-z0-9]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity).trim();
  const open = body.match(/<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\binnercon\b[^"']*\1[^>]*>/i);
  const start = open ? open.index + open[0].length : 0;
  const marker = open && body.slice(start).match(/<div\b[^>]*\bclass\s*=\s*(["'])[^"']*\bban_more\b[^"']*\1[^>]*>/i);
  const inner = marker ? body.slice(start, start + marker.index).replace(/<\/div>\s*$/, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').trim() : '';
  if (!title || !inner) throw new Error('unrecognized lantis article');
  // Preserve source markup so both fetchers produce the same archived version.
  return { title, message: absoluteArticleLinks(inner, url) };
}

module.exports = { mergeNews, NewsContent, absoluteArticleLinks, extractLantisArticle };

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const { html, url } = JSON.parse(input);
      process.stdout.write(JSON.stringify(extractLantisArticle(html, url)));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
}
