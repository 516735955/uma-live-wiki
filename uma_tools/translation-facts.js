'use strict';

function numericFacts(value) {
  const normalized = String(value || '').normalize('NFKC')
    .replace(/[−﹣]/g, '-')
    .replace(/(?<=\d)[,，](?=\d{3}(?:\D|$))/g, '')
    .replace(/(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2}:\d{2})/g, '$1/$2 $3')
    .replace(/(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})/g, '$1 | $2');
  // Normalize a date immediately followed by a time; preserve every other
  // numeric boundary as well as meaningful decimal/time separators.
  return (normalized.match(/(?<!\d)[+-]\d+(?:[/:.]\d+)*|\d+(?:[/:.]\d+)*/g) || []).join('|');
}

function translationFactsMatch(source, translated) {
  let candidate = String(translated || '').normalize('NFKC');
  // Restore only a date/time boundary explicitly present in the source.
  // Baidu can join "11/6 12:00" as "11/612:00"; guessing the split
  // from the translated digits alone can instead read it as "11/61 2:00".
  for (const match of String(source || '').normalize('NFKC').matchAll(/\b(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\b/g)) {
    const joined = match[1] + match[2];
    candidate = candidate.replace(new RegExp('(?<![\\d/])' + joined.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\d)', 'g'), match[1] + ' ' + match[2]);
  }
  return numericFacts(source) === numericFacts(candidate);
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
