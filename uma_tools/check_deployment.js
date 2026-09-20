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

async function main() {
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
    check(header(result, 'content-encoding') === 'gzip', '静态资源未 gzip', asset);
    check(/max-age=31536000/.test(cacheControl) && /immutable/.test(cacheControl), '版本化资源未长期缓存', asset + ' ' + (cacheControl || '无 Cache-Control'));
  }

  const news = await request('/api/news-index');
  check(news.status === 200, '新闻 API 不可用', 'HTTP ' + news.status);
  check(header(news, 'content-encoding') === 'gzip', '新闻 API 未 gzip', header(news, 'content-encoding') || '无 Content-Encoding');
  check(/max-age=\d+/.test(header(news, 'cache-control')), '新闻 API 缺少短缓存', header(news, 'cache-control') || '无 Cache-Control');

  if (findings.length) {
    console.error('部署检查失败：');
    findings.forEach((item) => console.error('- ' + item));
    process.exitCode = 1;
    return;
  }

  console.log('部署检查通过：HTML 可即时更新，' + assets.length + ' 个版本化资源已 gzip 并长期缓存，新闻 API 可用。');
}

main().catch((error) => {
  console.error('部署检查失败：' + error.message);
  process.exitCode = 1;
});
