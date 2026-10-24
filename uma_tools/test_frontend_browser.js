/* Exercise the shipped browser modules against a --no-crawl preview. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { CatalogStore } = require('./catalog-store');
const base = process.env.UMA_TEST_URL || 'http://localhost:18083';

async function main() {
  const catalog = await new CatalogStore(path.join(__dirname,'..','data')).get();
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  const errors = [];
  async function page(width) {
    const page = await browser.newPage({viewport:{width,height:900}});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{ if(message.type()==='error' && /(?:Type|Reference|Syntax)Error/.test(message.text())) errors.push(message.text()); });
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin ? route.continue() : route.abort());
    return page;
  }
  try {
    for (const width of [320,390,768,1024,1440]) {
      const current = await page(width);
      await current.goto(base+'/zh-Hans/music/albums',{waitUntil:'domcontentloaded'});
      await current.locator('.album-card').first().waitFor();
      assert.strictEqual(await current.locator('.ui-select-trigger').count(),5);
      for (const trigger of await current.locator('.ui-select-trigger').all()) {
        await trigger.click();
        const bounds = await current.locator('.ui-select-menu:visible').boundingBox();
        assert(bounds && bounds.x >= 7 && bounds.x + bounds.width <= width-7, 'dropdown fits the viewport at '+width);
        await current.keyboard.press('Escape');
      }
      await current.goto(base+'/zh-Hans/database/anime/anime-s1/episodes/anime-s1-e01?section=staff',{waitUntil:'domcontentloaded'});
      await current.waitForFunction(()=>document.querySelector('h1')?.textContent.includes('梦想之门'));
      assert((await current.locator('.anime-credit-ledger').innerText()).includes('Cygames'));
      const event = current.locator('.anime-event-links a').first();
      if (await event.count()) {
        await event.click();
        await current.waitForFunction(()=>window.__uma_app?.eventDetail);
        await current.evaluate(()=>history.back());
        await current.waitForFunction(()=>window.__uma_app?.animeUnitDetail?.id==='anime-s1-e01' && window.__uma_app.routeReady);
        assert((await current.title()).includes('梦想之门'));
      }
      await current.close();
    }
    const current = await page(390);
    await current.route('**/*/views/characters.js',async route=>{await new Promise(done=>setTimeout(done,1000));await route.continue();});
    await current.goto(base+'/zh-Hans/database/characters/specialweek/pedigree',{waitUntil:'domcontentloaded'});
    await current.locator('.c-pedigree-lens-frame').waitFor();
    await current.frameLocator('.c-pedigree-lens-frame').locator('.ped-node').first().waitFor();
    assert(await current.frameLocator('.c-pedigree-lens-frame').locator('.ped-node').count()>10, 'delayed templates retain the complete pedigree');
    await current.goto(base+'/zh-Hans/database/characters',{waitUntil:'domcontentloaded'});
    await current.waitForFunction(()=>document.querySelector('#cIntroGrid')?.children.length>100);
    const measures = await current.evaluate(async()=>{
      const input=document.querySelector('#cIntroSearch'), grid=document.querySelector('#cIntroGrid');
      const original=grid.querySelector('a');
      const total=grid.querySelectorAll('a').length;
      const samples=[], matching=[];
      for(const query of ['周','','帝王','','a','','黄金','','府中','','星','','特别','','King','','船','','周','']) {
        const start=performance.now();input.value=query;input.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        samples.push(performance.now()-start);
        const count=grid.querySelectorAll('a').length;
        if(query==='周') matching.push(count>0&&count<total);
        if(query==='') matching.push(count===total);
      }
      return {p95:samples.sort((a,b)=>a-b)[Math.ceil(samples.length*.95)-1],reused:grid.querySelector('a')===original,filtered:matching.every(Boolean)};
    });
    assert(measures.reused,'search retains the original card nodes');
    assert(measures.filtered,'search filters actual cards and clearing restores the full current dataset');
    const searchBudget=Number(process.env.UMA_SEARCH_P95_MS);
    if(Number.isFinite(searchBudget)&&searchBudget>0)
      assert(measures.p95<searchBudget,`character search p95 ${Math.round(measures.p95)}ms exceeds the configured ${searchBudget}ms budget`);
    await current.close();

    const atomic = await page(1440);
    const routes = [
      '/zh-Hans/database/staff/'+JSON.parse(fs.readFileSync(path.join(__dirname,'../data/anime/people.json'))).people[0].id,
      '/zh-Hans/database/voice-actors/va-0142/events',
      '/zh-Hans/music/songs/'+catalog.songsById.keys().next().value,
      '/zh-Hans/music/albums/'+catalog.albumsById.keys().next().value,
      '/zh-Hans/music/creators/'+catalog.creatorsById.keys().next().value,
      '/zh-Hans/events/'+catalog.eventsById.keys().next().value,
      '/zh-Hans/database/horses/specialweek',
    ];
    for(const route of routes) {
      await atomic.goto(base+route,{waitUntil:'domcontentloaded'});
      await atomic.waitForFunction(()=>window.__uma_app?.routeReady && document.querySelector('h1'));
      assert(!await atomic.locator('.not-found-page').count(),route+' remains available');
    }
    await atomic.close();
    assert.deepStrictEqual(errors,[]);
    console.log('responsive menus, atomic routes, history, deferred pedigree and search behavior passed; observed search p95:',Math.round(measures.p95)+'ms');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
