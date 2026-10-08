#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const zlib = require('zlib');

const base = new URL(process.argv[2] || 'http://127.0.0.1:8080');
const findings = [];

function request(pathname) {
  const url = new URL(pathname, base);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, {
      headers: {
        'Accept-Encoding': 'gzip',
        'User-Agent': 'uma-live-deployment-check/1.0'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let body = raw;
        if (res.headers['content-encoding'] === 'gzip') {
          try { body = zlib.gunzipSync(raw); } catch (error) { return reject(error); }
        }
        resolve({
          url: url.toString(),
          status: res.statusCode || 0,
          headers: res.headers,
          body: body.toString('utf8'),
          bytes: raw.length
        });
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
  });
}

function check(condition, label, detail) {
  if (!condition) findings.push(label + (detail ? ': ' + detail : ''));
}

function header(result, name) {
  return String(result.headers[name.toLowerCase()] || '');
}

async function checkJson(pathname, validate) {
  const result = await request(pathname);
  check(result.status === 200, '数据接口不可用', pathname + ' HTTP ' + result.status);
  try {
    const payload = JSON.parse(result.body);
    check(validate(payload), '数据接口内容不完整', pathname);
  } catch (error) {
    check(false, '数据接口响应不是 JSON', pathname);
  }
}

async function main() {
  const root = await request('/');
  const homeLocation = header(root, 'location');
  check([301, 302, 307, 308].includes(root.status) &&
    [ '/zh-Hans/', new URL('/zh-Hans/', base).href ].includes(homeLocation),
    '根地址未跳转到首页', 'HTTP ' + root.status + ' ' + header(root, 'location'));
  const home = await request('/zh-Hans/');
  check(home.status === 200 && /id=["']app["']/.test(home.body), '首页不可用', 'HTTP ' + home.status);

  const page = await request('/zh-Hans/news');
  check(page.status === 200, '新闻页不可用', 'HTTP ' + page.status);
  check(/no-cache|no-store/.test(header(page, 'cache-control')), 'HTML 缺少即时校验缓存策略', header(page, 'cache-control') || '无 Cache-Control');

  const assetMatches = Array.from(page.body.matchAll(/(?:href|src)=["']([^"']*\/uma_tools\/[^"']+\.(?:css|js)\?v=[^"']+)["']/g));
  const assets = Array.from(new Set(assetMatches.map((match) => match[1])));
  const required = ['app.css', 'app.js', 'vue.global.prod.js'];
  required.forEach((name) => check(assets.some((asset) => asset.includes('/' + name + '?v=')), '页面缺少版本化资源', name));

  for (const asset of assets) {
    const result = await request(asset);
    const cacheControl = header(result, 'cache-control');
    check(result.status === 200, '静态资源不可用', asset + ' HTTP ' + result.status);
    check(!/text\/html/.test(header(result, 'content-type')), '静态资源错误返回页面 HTML', asset);
    check(header(result, 'content-encoding') === 'gzip', '静态资源未 gzip', asset);
    check(/max-age=31536000/.test(cacheControl) && /immutable/.test(cacheControl), '版本化资源未长期缓存', asset + ' ' + (cacheControl || '无 Cache-Control'));
  }

  const missingAsset = await request('/uma_tools/__deployment_missing__.js');
  check(missingAsset.status === 404, '不存在的静态资源未返回 404', 'HTTP ' + missingAsset.status);
  for (const route of ['/zh-Hans/music/songs', '/zh-Hans/music/albums', '/zh-Hans/database/characters']) {
    const result = await request(route);
    check(result.status === 200 && result.body === page.body, '直链未返回当前页面入口', route + ' HTTP ' + result.status);
  }
  await checkJson('/api/home-summary', (payload) => payload.stats && payload.stats.songs > 0);
  for (const domain of ['events', 'songs', 'albums', 'creators']) {
    await checkJson('/api/catalog/' + domain + '?page_size=1',
      (payload) => payload.build_id && Array.isArray(payload.items) && payload.items.length > 0);
  }

  const news = await request('/api/news-index');
  check(news.status === 200, '新闻 API 不可用', 'HTTP ' + news.status);
  check(header(news, 'content-encoding') === 'gzip', '新闻 API 未 gzip', header(news, 'content-encoding') || '无 Content-Encoding');
  check(/max-age=\d+/.test(header(news, 'cache-control')), '新闻 API 缺少短缓存', header(news, 'cache-control') || '无 Cache-Control');
  const swr = /stale-while-revalidate=(\d+)/.exec(header(news, 'cache-control'));
  check(!swr || Number(swr[1]) <= 900, '新闻 API 陈旧窗过长（浏览器可缓存过期新闻）', (swr && swr[0]) || '');
  try {
    const payload = JSON.parse(news.body);
    const generatedAt = Date.parse(payload.generated_at || '');
    const ageMin = generatedAt ? Math.round((Date.now() - generatedAt) / 60000) : -1;
    check(ageMin >= 0 && ageMin <= 120, '新闻数据过期',
      (payload.generated_at || '无 generated_at') + '（' + (ageMin >= 0 ? ageMin + ' 分钟前' : '无法解析') + '）');
    check(Array.isArray(payload.information_list) && payload.information_list.length > 0, '新闻列表为空');
  } catch (error) {
    check(false, '新闻 API 响应不是 JSON', error.message);
  }

  if (findings.length) {
    console.error('部署检查失败：');
    findings.forEach((item) => console.error('- ' + item));
    process.exitCode = 1;
    return;
  }

  console.log('部署检查通过：根地址、页面直链、主页与目录 API 可用，' + assets.length + ' 个版本化资源已 gzip 并长期缓存，新闻数据新鲜。');
}

main().catch((error) => {
  console.error('部署检查失败：' + error.message);
  process.exitCode = 1;
});
