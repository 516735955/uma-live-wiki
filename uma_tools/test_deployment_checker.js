'use strict';
const assert = require('assert');
const http = require('http');
const zlib = require('zlib');
const {execFile} = require('child_process');
const path = require('path');

async function main() {
  const commit = 'a'.repeat(40), asset = '/assets/0123456789abcdef.js';
  const html = '<div id="app"></div><meta name="uma-release" content="' + commit + '"><script src="' + asset + '"></script>';
  let mode = '', sockets = new Set(), reused = false;
  const server = http.createServer((req, res) => {
    if (sockets.has(req.socket)) reused = true;
    sockets.add(req.socket);
    const url = req.url;
    res.setHeader('Cache-Control', url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (url === '/') { res.writeHead(302, {Location:'/zh-Hans/'}); return res.end(); }
    if (url === '/__deployment_missing__.js') { res.writeHead(404); return res.end(); }
    if (url === asset) { res.setHeader('Content-Type','text/javascript'); if (mode === 'missing') res.statusCode = 404; return res.end('window.ready=true;'); }
    let data;
    if (url === '/api/release') data = {commit: mode === 'version' ? 'b'.repeat(40) : commit};
    else if (url === '/release.json') data = {commit, assets:{'/uma_tools/bundle.css':asset, '/uma_tools/app.js':asset, '/uma_tools/vendor/vue.global.prod.js':asset}};
    else if (url === '/api/home-summary') data = {stats:{songs:1}};
    else if (url.startsWith('/api/catalog/')) data = {build_id:'one',items:[{}]};
    else if (url === '/api/news-index') {
      data = {generated_at:new Date().toISOString(), information_list:[{}]};
      res.setHeader('Cache-Control','public, max-age=60');
      res.setHeader('Content-Encoding','gzip');
      return res.end(zlib.gzipSync(JSON.stringify(data)));
    }
    res.end(data ? JSON.stringify(data) : html);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    for (mode of ['', 'version', 'missing']) {
      sockets = new Set(); reused = false;
      const result = await new Promise(resolve => execFile(process.execPath,
        [path.join(__dirname,'check_deployment.js'), 'http://127.0.0.1:' + server.address().port, commit],
        (error, stdout, stderr) => resolve({error,stdout,stderr})));
      assert.strictEqual(!!result.error, !!mode, result.stderr);
      assert(!reused, 'checks must use fresh connections across nginx reloads');
      assert(sockets.size > 10, 'full checker executed');
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('fresh deployment connections preserve version and asset failures');
}
main().catch(error => {console.error(error);process.exitCode=1;});
