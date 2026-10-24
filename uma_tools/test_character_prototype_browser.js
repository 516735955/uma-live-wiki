/* Cold entry and delayed SPA prototype links must not depend on another page. */
const assert = require('assert');
const {chromium} = require('playwright');
const base = process.env.UMA_TEST_URL || 'http://localhost:18107';

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    for (const id of ['winmarilyn','azuma','grasswonder']) {
      const page = await browser.newPage();
      await page.goto(base + '/zh-Hans/database/characters/' + id);
      const link = page.locator('.horse-link-chip').filter({hasText: /^原型马/});
      await link.waitFor();
      assert((await link.getAttribute('href')).endsWith('/' + id));
      await page.close();
    }
    const page = await browser.newPage();
    await page.goto(base + '/zh-Hans/music/albums');
    await page.waitForFunction(() => !!window.__uma_app);
    let release;
    const delayed = new Promise(resolve => {release = resolve;});
    await page.route('**/api/catalog/horses?*', async route => {
      await delayed;
      await route.continue();
    });
    await page.evaluate(() => window.__uma_app.openCharacter('winmarilyn'));
    await page.waitForFunction(() => window.__uma_app.charDetail?.id === 'winmarilyn');
    assert.strictEqual(await page.locator('.horse-link-chip').count(), 0);
    release();
    await page.locator('.horse-link-chip').waitFor();
    assert((await page.locator('.horse-link-chip').getAttribute('href')).endsWith('/winmarilyn'));
    // A filtered/paged horse directory must not erase the complete lookup index.
    await page.evaluate(() => {window.__uma_app.horsesList = [{id:'unrelated'}];});
    await page.waitForTimeout(50);
    assert.strictEqual(await page.locator('.horse-link-chip').count(), 1);
    console.log('character prototype cold entry and delayed SPA checks passed');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
