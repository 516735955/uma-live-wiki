'use strict';

function numericFacts(value) {
  const normalized = String(value || '').normalize('NFKC')
    .replace(/[−﹣]/g, '-')
    .replace(/(?<=\d)[,，](?=\d{3}(?:\D|$))/g, '')
    .replace(/(\d{1,2}\/\d{1,2})\s*(\d{1,2}:\d{2})/g, '$1 | $2');
  // Normalize a date immediately followed by a time; preserve every other
  // numeric boundary as well as meaningful decimal/time separators.
  return (normalized.match(/(?<!\d)[+-]\d+(?:[/:.]\d+)*|\d+(?:[/:.]\d+)*/g) || []).join('|');
}

function translationFactsMatch(source, translated) {
  return numericFacts(source) === numericFacts(translated);
}

function starFactsMatch(source, translated) {
  const groups = value => (String(value || '').match(/★+/g) || []).map(group => group.length);
  const expected = groups(source);
  const actual = groups(translated);
  return expected.length === actual.length && expected.every((count, index) => count === actual[index]);
}

function untranslatedJapanese(source, translated) {
  return (source === translated && /[\u3040-\u30ff]/.test(source)) ||
    /ございます|いたします|ください|されます|しました|となります|のとおり/.test(translated);
}

module.exports = { translationFactsMatch, starFactsMatch, untranslatedJapanese };
