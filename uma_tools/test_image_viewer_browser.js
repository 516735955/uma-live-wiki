/* Run against a --no-crawl preview with Playwright available in NODE_PATH. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let originalAvailable = false;
      const image = fs.readFileSync(path.join(__dirname, 'img/anime/episodes/anime-umayuru-e01.webp'));
      await page.route('**/__viewer-regression', route => route.fulfill({ contentType: 'text/html', body:
        '<head><link rel="stylesheet" href="/uma_tools/vendor/photoswipe/photoswipe.css">' +
        '<link rel="stylesheet" href="/uma_tools/image-viewer.css">' +
        '<script type="module" src="/uma_tools/image-viewer.js"></script></head>' +
        '<body><div id="app"><div class="anime-stills">' + [1, 2, 3].map(index =>
          '<button class="image-view-trigger"><img width="120" src="/viewer-preview-' + index +
          '.webp" data-original="/viewer-original-' + index + '.webp" alt="Image ' + index + '"></button>'
        ).join('') + '</div></div></body>' }));
      await page.route('**/viewer-*.webp', route =>
        route.request().url().includes('original-1') && !originalAvailable ? route.abort() :
          route.fulfill({ contentType: 'image/webp', body: image }));
      await page.goto((process.env.UMA_TEST_URL || 'http://localhost:18082') + '/__viewer-regression');
      await page.locator('img.original-image').first().click();
      await page.locator('.viewer-failure button').waitFor();
      await page.locator('.viewer-failure button').click();
      await page.waitForTimeout(250);
      assert(await page.locator('.pswp__item[aria-hidden="false"] .viewer-failure img').evaluate(image => image.naturalWidth > 0), 'failed retry retains its usable preview');
      for (let index = 0; index < 18; index++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(350);
        const visible = page.locator('.pswp__item[aria-hidden="false"]');
        assert(await visible.locator('img').evaluateAll(images => images.some(image => image.naturalWidth > 0)), 'every switched slide contains an image');
        assert.strictEqual(await page.locator('.viewer-failure').count(), 1, 'switching never accumulates stale failure panels');
      }
      for (let index = 0; index < 4 && !(await page.locator('.viewer-title').innerText()).startsWith('Image 1'); index++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(500);
      }
      assert.strictEqual(await page.locator('.pswp__item[aria-hidden="false"] .viewer-failure').count(), 1, 'returning to the failed slide shows its preview and retry');
      originalAvailable = true;
      await page.locator('.pswp__item[aria-hidden="false"] .viewer-failure button').click();
      await page.waitForTimeout(500);
      assert.strictEqual(await page.locator('.viewer-failure').count(), 0, 'a successful retry removes its own failure panel');
      assert(await page.locator('.pswp__item[aria-hidden="false"] img.pswp__img').evaluate(image => image.naturalWidth > 0));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      assert.strictEqual(await page.locator('.pswp').count(), 0);
      assert.deepStrictEqual(errors, []);
      await page.close();
    }
    console.log('viewer preview, retry, repeated gallery navigation and recovery passed at 390/1440px');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
