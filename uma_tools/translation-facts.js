'use strict';

function numericFacts(value) {
  const normalized = String(value || '').normalize('NFKC')
    .replace(/(?<=\d)[,，](?=\d{3}(?:\D|$))/g, '')
    .replace(/(?<=\d)\s+(?=\d)/g, '');
  // Joining preserves a date immediately followed by a time when translation
  // removes whitespace, while decimal/time separators remain meaningful.
  return (normalized.match(/\d+(?:[/:.]\d+)*/g) || []).join('');
}

function translationFactsMatch(source, translated) {
  return numericFacts(source) === numericFacts(translated);
}

function untranslatedJapanese(source, translated) {
  return source === translated && /[\u3040-\u30ff]/.test(source);
}

module.exports = { translationFactsMatch, untranslatedJapanese };
