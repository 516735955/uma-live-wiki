(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UmaSearch = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var KANA = {
    ア:'a',イ:'i',ウ:'u',エ:'e',オ:'o',ァ:'a',ィ:'i',ゥ:'u',ェ:'e',ォ:'o',カ:'ka',キ:'ki',ク:'ku',ケ:'ke',コ:'ko',サ:'sa',シ:'shi',ス:'su',セ:'se',ソ:'so',タ:'ta',チ:'chi',ツ:'tsu',テ:'te',ト:'to',ナ:'na',ニ:'ni',ヌ:'nu',ネ:'ne',ノ:'no',ハ:'ha',ヒ:'hi',フ:'fu',ヘ:'he',ホ:'ho',マ:'ma',ミ:'mi',ム:'mu',メ:'me',モ:'mo',ヤ:'ya',ユ:'yu',ヨ:'yo',ラ:'ra',リ:'ri',ル:'ru',レ:'re',ロ:'ro',ワ:'wa',ヲ:'o',ン:'n',ガ:'ga',ギ:'gi',グ:'gu',ゲ:'ge',ゴ:'go',ザ:'za',ジ:'ji',ズ:'zu',ゼ:'ze',ゾ:'zo',ダ:'da',ヂ:'ji',ヅ:'zu',デ:'de',ド:'do',バ:'ba',ビ:'bi',ブ:'bu',ベ:'be',ボ:'bo',パ:'pa',ピ:'pi',プ:'pu',ペ:'pe',ポ:'po',ヴ:'vu',ー:'',
  };
  // Small, dependency-free search normalization for the site's recurring
  // traditional-name variants. This is deliberately a search equivalence,
  // not a data rewrite; uncommon characters remain unchanged.
  var TRADITIONAL = {
    '馬':'马','黃':'黄','東':'东','風':'风','鈴':'铃','櫻':'樱','龍':'龙','麥':'麦','樂':'乐',
    '體':'体','國':'国','會':'会','進':'进','現':'现','場':'场','學':'学','校':'校','發':'发',
    '聲':'声','優':'优','藝':'艺','術':'术','賽':'赛','車':'车','驛':'驿','關':'关','聯':'联',
    '線':'线','頁':'页','錄':'录','過':'过','門':'门','開':'开','問':'问','題':'题','對':'对',
    '應':'应','廣':'广','島':'岛','濱':'滨','澤':'泽','邊':'边','莊':'庄','淺':'浅','慶':'庆'
  };
  // Small, offline terminology dictionary for the site's confirmed Chinese names.
  // Unknown Hanzi are deliberately left untouched instead of guessed.
  var PINYIN = {
    '北部玄驹':'beibuxuanju','特别周':'tebiezhou','无声铃鹿':'wushenglinglu','东海帝王':'donghaidiwang',
    '小栗帽':'xiaolimao','黄金船':'huangjinchuan','大和赤骥':'dahechiji','樱花千代王':'yinghuaqiandaiwang',
    '成田白仁':'chengtianbairen','鲁道夫象征':'ludaofuxiangzheng','北部玄驹':'beibuxuanju','真诚':'zhencheng'
  };
  var PINYIN_INITIALS = {'北部玄驹':'bbxj','特别周':'tbz','无声铃鹿':'wsll','东海帝王':'dhdiw','小栗帽':'xlm','黄金船':'hjc','大和赤骥':'dhcj','樱花千代王':'yhcdw','成田白仁':'ctbr','鲁道夫象征':'ldfxz','真诚':'zc'};
  var PRONUNCIATIONS = (typeof window !== 'undefined' && window.UmaSearchPronunciations) || {};
  if (typeof require === 'function') {
    try { PRONUNCIATIONS = require('./search-pronunciations.json').items || PRONUNCIATIONS; } catch (e) {}
  }
  function pronunciationEntry(value) {
    var entry = PRONUNCIATIONS[value];
    if (Array.isArray(entry)) return { pinyin: entry[0] || '', initials: entry[1] || '', romaji: entry[2] || '' };
    return entry || null;
  }
  function pinyin(value) {
    var text = normalize(value), entry = pronunciationEntry(text), phrase = entry && entry.pinyin || PINYIN[text];
    if (phrase) return phrase;
    // Build a safe substring pronunciation from the generated single-character
    // map. Complete phrases above still take precedence for polyphonic names.
    var chars = Array.from(text), out = '';
    for (var i = 0; i < chars.length; i++) {
      var item = pronunciationEntry(chars[i]), fallback = PINYIN[chars[i]];
      if (!(item && item.pinyin) && !fallback && /[\u3400-\u9fff]/.test(chars[i])) return '';
      out += item && item.pinyin || fallback || chars[i];
    }
    return out;
  }
  function initials(value) {
    var text = normalize(value), entry = pronunciationEntry(text);
    if (entry && entry.initials) return entry.initials;
    if (PINYIN_INITIALS[text]) return PINYIN_INITIALS[text];
    var chars = Array.from(text), out = '';
    for (var i = 0; i < chars.length; i++) {
      var item = pronunciationEntry(chars[i]), fallback = PINYIN_INITIALS[chars[i]];
      if (!(item && item.initials) && !fallback && /[\u3400-\u9fff]/.test(chars[i])) return '';
      out += item && item.initials || fallback || '';
    }
    return out;
  }
  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFKC').toLowerCase()
      .replace(/[馬黃東風鈴櫻龍麥樂體國會進現場學發聲優藝術賽車驛關聯線頁錄過門開問題對應廣島濱澤邊莊淺慶]/g, function (ch) { return TRADITIONAL[ch] || ch; })
      .replace(/[‘’`]/g, "'").replace(/[‐‑‒–—−－]/g, '-')
      .replace(/[・･]/g, '·').replace(/[\s　]+/g, ' ').trim();
  }
  function kanaToRomaji(value) {
    var text = normalize(value).replace(/[ぁ-ゖ]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) + 0x60); });
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var pair = text.slice(i, i + 2);
      var pairMap = { キャ:'kya',キュ:'kyu',キョ:'kyo',シャ:'sha',シュ:'shu',ショ:'sho',チャ:'cha',チュ:'chu',チョ:'cho',ニャ:'nya',ニュ:'nyu',ニョ:'nyo',ヒャ:'hya',ヒュ:'hyu',ヒョ:'hyo',ミャ:'mya',ミュ:'myu',ミョ:'myo',リャ:'rya',リュ:'ryu',リョ:'ryo',ギャ:'gya',ギュ:'gyu',ギョ:'gyo',ジャ:'ja',ジュ:'ju',ジョ:'jo',ビャ:'bya',ビュ:'byu',ビョ:'byo',ピャ:'pya',ピュ:'pyu',ピョ:'pyo',ウィ:'wi',ウェ:'we',ウォ:'wo',ティ:'ti',ディ:'di',トゥ:'tu',ドゥ:'du',シェ:'she',ジェ:'je',チェ:'che',ファ:'fa',フィ:'fi',フェ:'fe',フォ:'fo' };
      if (pairMap[pair]) { out += pairMap[pair]; i++; continue; }
      if (text[i] === 'ッ') { var next = KANA[text[i + 1]] || ''; out += next.charAt(0); continue; }
      if (Object.prototype.hasOwnProperty.call(KANA, text[i])) out += KANA[text[i]]; else if (text[i] !== '゛' && text[i] !== '゜') out += text[i];
    }
    return out;
  }
  function fields(values) {
    var list = [];
    function add(value) {
      if (Array.isArray(value)) { value.forEach(add); return; }
      if (value && typeof value === 'object') {
        ['zh','ja','en','kana','aliases','romanization','romaji','pinyin','initials'].forEach(function (key) {
          if (value[key] != null) add(value[key]);
        });
      } else list.push(value);
    }
    add(values);
    var out = [];
    list.forEach(function (value) {
      if (value == null || value === '') return;
      var text = normalize(value); out.push(text);
      var roman = kanaToRomaji(text), reading = pronunciationEntry(text); if (roman && roman !== text) out.push(roman); if (reading && reading.romaji) out.push(reading.romaji);
      var py = pinyin(text); if (py) { out.push(py); out.push(initials(text)); }
    });
    return out.join(' ');
  }
  function variants(value) {
    var text = normalize(value), roman = kanaToRomaji(text), reading = pronunciationEntry(text), out = text ? [text] : [];
    if (roman && roman !== text) out.push(roman);
    if (reading && reading.romaji && out.indexOf(reading.romaji) === -1) out.push(reading.romaji);
    return out;
  }
  function includes(values, query) {
    var target = fields(values);
    return variants(query).some(function (item) { return item && target.indexOf(item) !== -1; });
  }
  function matchesIndex(index, query) {
    return variants(query).some(function (item) { return item && index.indexOf(item) !== -1; });
  }
  return { normalize: normalize, kanaToRomaji: kanaToRomaji, fields: fields, includes: includes, matchesIndex: matchesIndex };
});
