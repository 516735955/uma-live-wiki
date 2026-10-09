'use strict';

const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { loadTerms, createTerms, readJson } = require('./translation-terms');
const root = path.resolve(__dirname, '..');
const config = readJson(path.join(__dirname, 'baidu.conf.json'));
const appid = process.env.BAIDU_APPID || config.appid;
const secret = process.env.BAIDU_SECRET || config.secret;
const terms = createTerms(loadTerms(root));
const samples = [
  'トウカイテイオーが登場！',
  'オグリキャップとスペシャルウィークが出演します。',
  '和氣あず未、高柳知葉が出演！',
  'ウマ娘 プリティーダービー「WINNING LIVE 36」店舗特典が決定！',
  'レジェンドレース開催！',
  '育成シナリオの新情報を公開！',
  'サイレンススズカの新衣装を公開。',
  '2026年10月21日（水）発売、全7曲を収録。'
];

function translate(text) {
  const salt = String(Date.now());
  const sign = crypto.createHash('md5').update(appid + text + salt + secret).digest('hex');
  const body = new URLSearchParams({ q: text, from: 'jp', to: 'zh', appid, salt, sign }).toString();
  return new Promise((resolve, reject) => {
    const request = https.request('https://fanyi-api.baidu.com/api/trans/vip/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (!result.trans_result) return reject(new Error('translation API code ' + result.error_code));
          resolve(result.trans_result.map((item) => item.dst).join('\n'));
        } catch (error) { reject(error); }
      });
      response.on('error', () => reject(new Error('translation response failed')));
    });
    request.setTimeout(20000, () => request.destroy());
    request.on('error', () => reject(new Error('translation connection failed')));
    request.end(body);
  });
}

(async () => {
  let failed = 0;
  for (const source of samples) {
    const normal = await translate(source).catch((error) => error.message);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const protectedText = terms.protect(source);
    const translated = await translate(protectedText.text);
    const restored = protectedText.restore(translated);
    if (!restored) failed += 1;
    console.log(JSON.stringify({ source, normal, restored, terms: protectedText.count }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  console.log('Smoke: ' + samples.length + ' samples, ' + failed + ' invalid marker results');
  if (failed) process.exitCode = 1;
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
