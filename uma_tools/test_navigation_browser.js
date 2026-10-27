'use strict';
const assert = require('assert');
const {chromium} = require('playwright');
const base = process.env.UMA_TEST_URL || 'http://localhost:8080';
const eventId = 'live-other-2023-11-18-animax-musix-2023';

async function main() {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  const page = await browser.newPage({viewport:{width:1440,height:950}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  try {
    await page.goto(base+'/zh-Hans/');
    await page.waitForFunction(()=>window.__uma_app?.routeReady);
    let release, templateRequested = false;
    const hold = new Promise(resolve => { release = resolve; });
    await page.route('**/api/catalog/songs?*', async route => { await hold; await route.continue(); });
    page.on('request', request => { if (/\/views\/songs\.js/.test(request.url())) templateRequested = true; });
    const immediate = await page.evaluate(async () => {
      window.__originalAudio = window.__uma_app.audio;
      const start = performance.now();
      document.querySelector('a[href="/zh-Hans/music/songs"]').click();
      await Vue.nextTick();
      return {ms:performance.now()-start, skeleton:!!document.querySelector('.route-placeholder'), path:location.pathname};
    });
    assert(immediate.skeleton && immediate.path.endsWith('/music/songs'), 'click immediately updates the route and exposes a skeleton');
    await page.locator('.navigation-progress').waitFor();
    assert(templateRequested, 'template download starts before the delayed API response');
    release();
    await page.locator('.song-card').first().waitFor();
    await page.locator('.navigation-progress').waitFor({state:'detached'});
    await page.unroute('**/api/catalog/songs?*');
    const songLink = await page.locator('.song-card .music-card-main').first().getAttribute('href');

    let releaseDetail;
    const detailHold = new Promise(resolve => { releaseDetail = resolve; });
    await page.route('**/api/catalog/song?*', async route => { await detailHold; await route.continue(); });
    await page.evaluate(href=>document.querySelector('a[href="'+href+'"]').click(), songLink);
    await page.locator('.route-placeholder-detail').waitFor();
    await page.evaluate(id=>window.umaNavigate('/zh-Hans/events/'+id), eventId);
    await page.locator('.setlist-table').waitFor();
    releaseDetail();
    await page.unroute('**/api/catalog/song?*');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(()=>window.__uma_app.eventDetail.id), eventId, 'late detail never replaces the newer destination');
    assert(await page.evaluate(()=>window.__uma_app.audio===window.__originalAudio), 'navigation keeps the same audio controller');

    const cast = await page.locator('.performer-cast-groups > .performer-group').evaluateAll(groups=>groups.map(group=>group.querySelectorAll('.performer-chip').length));
    assert.deepStrictEqual(cast,[7,5]);
    const finale = await page.locator('.setlist-table tbody tr').last().locator('.setlist-perf').evaluate(cell=>({
      groups:[...cell.querySelectorAll(':scope > .performer-group')].map(row=>row.dataset.performerGroup),
      characters:cell.querySelectorAll('[data-character-id]').length,
      voices:cell.querySelectorAll('[data-voice-id]').length,
      notes:cell.textContent,
    }));
    assert.deepStrictEqual(finale.groups,['0','1','2']);
    assert.strictEqual(finale.characters,7);
    assert.strictEqual(finale.voices,5);
    assert(finale.notes.includes('他出演キャスト全員') && finale.notes.includes('MyGO!!!!!') && finale.notes.includes('YOU-TA(MADKID)'));

    const projection = await page.evaluate(async()=>{
      const {performanceGroups,groupSetlistPerformers}=await import('/uma_tools/frontend/performer-groups.js');
      const app=window.__uma_app, performance=app.selectedEventSession.performances.at(-1);
      const groups=performanceGroups(performance,app.voiceProfiles);
      const preserved=groupSetlistPerformers('<table><tbody><tr><td class="setlist-perf"><b>嘉宾：</b><a class="setlist-voice-link" data-voice-id="v">声优</a><span class="perf-item">角色</span><small>备注原文</small><span class="guest-performer">其他人</span></td></tr></tbody></table>');
      return {counts:groups.map(group=>group.length),preserved};
    });
    assert.deepStrictEqual(projection.counts,[7,5,44]);
    assert(projection.preserved.includes('嘉宾：') && projection.preserved.includes('备注原文'));
    const fallback = await page.evaluate(async()=>{
      const session=window.__uma_app.selectedEventSession, saved=session.setlist_html;
      session.setlist_html=''; await Vue.nextTick();
      const counts=[...document.querySelectorAll('.setlist-table tbody tr:last-child .performer-group')].map(row=>row.children.length);
      session.setlist_html=saved; await Vue.nextTick(); return counts;
    });
    assert.deepStrictEqual(fallback,[7,5,44],'the structured fallback uses the same identity grouping');
    await page.evaluate(()=>window.umaNavigate('/zh-Hans/database/voice-actors/va-0008/events'));
    await page.locator('.history-list > a.history-group-start').waitFor();
    const history = await page.evaluate(()=>window.__uma_app.voiceHistoryEvents.map(row=>({scope:row.participation_scope,date:row.date,id:row.event_id})));
    const boundary = history.findIndex(row=>row.scope==='voice');
    assert(boundary>0 && history.slice(boundary).every(row=>row.scope==='voice'));
    assert(history.slice(boundary).some(row=>row.id===eventId));
    for (const group of [history.slice(0,boundary),history.slice(boundary)])
      assert.deepStrictEqual(group.map(row=>row.date),group.map(row=>row.date).sort().reverse());

    await page.evaluate(()=>window.umaNavigate('/zh-Hans/'));
    await page.waitForFunction(()=>window.__uma_app.home && window.__uma_app.routeReady);
    let eventRequests = 0;
    page.on('request', request=>{if (new URL(request.url()).pathname==='/api/catalog/events') eventRequests++;});
    const response = page.waitForResponse(response=>new URL(response.url()).pathname==='/api/catalog/events');
    await page.locator('.site-nav-home .site-nav-item').filter({has:page.locator('a[href="/zh-Hans/events"]')}).locator('button.site-nav-trigger').click();
    await page.locator('a[href="/zh-Hans/events"]').first().focus();
    await response;
    await page.waitForTimeout(50);
    assert(await page.evaluate(()=>window.__uma_app.home), 'intent prefetch does not navigate');
    await page.evaluate(()=>document.querySelector('a[href="/zh-Hans/events"]').click());
    await page.locator('.event-catalog-row').first().waitFor();
    assert.strictEqual(eventRequests,1,'first click reuses the prefetched list response');

    let newsReply;
    const newsHold=new Promise(resolve=>{newsReply=resolve;});
    await page.route('**/api/news-detail?id=3377',async route=>{
      await newsHold;
      await route.fulfill({json:{detail:{announce_id:3377,title:'記事',title_zh:'新闻测试',message:'<p>原文</p>',message_zh:'<p>中文正文</p>',translation_state:'complete'}}});
    });
    await page.evaluate(()=>{window.umaNavigate('/zh-Hans/news/3377');});
    await page.locator('.news-body-skeleton').waitFor();
    assert.strictEqual(await page.evaluate(()=>scrollY),0,'navigation reaches the new page top without a competing smooth scroll');
    await page.locator('.navigation-progress').waitFor();
    newsReply();
    await page.locator('.news-detail-body').filter({hasText:'中文正文'}).waitFor();
    await page.locator('.navigation-progress').waitFor({state:'detached'});

    let fail=true;
    await page.route('**/api/catalog/song?id=retry-test',async route=>route.fulfill(fail
      ? {status:503,json:{error:'temporary failure'}}
      : {json:{song:{id:'retry-test',title:'恢复后的歌曲',versions:[]}}}));
    await page.evaluate(()=>window.umaNavigate('/zh-Hans/music/songs/retry-test'));
    await page.getByRole('button',{name:'重试',exact:true}).waitFor();
    assert.strictEqual(await page.locator('.route-placeholder').count(),0,'failure leaves the pending state');
    fail=false;
    await page.getByRole('button',{name:'重试',exact:true}).click();
    await page.waitForFunction(()=>window.__uma_app.songDetail?.id==='retry-test' && window.__uma_app.routeReady);

    let failTemplate=true, retriedTemplate=false;
    await page.route('**/views/creators.js*',async route=>{
      if (failTemplate) return route.abort();
      retriedTemplate ||= new URL(route.request().url()).searchParams.has('retry');
      return route.continue();
    });
    await page.evaluate(()=>window.umaNavigate('/zh-Hans/music/creators'));
    await page.getByRole('button',{name:'重试',exact:true}).waitFor();
    failTemplate=false;
    await page.getByRole('button',{name:'重试',exact:true}).click();
    await page.locator('.creator-catalog-row').first().waitFor();
    assert(retriedTemplate,'a failed module download retries with a fresh URL');

    await page.setViewportSize({width:390,height:950});
    await page.evaluate(()=>window.umaNavigate('/zh-Hans/music/songs/song-f53f0c98a1/performances'));
    await page.locator('.song-performance-cast').first().waitFor();
    assert.strictEqual(await page.locator('.song-performance-cast').first().evaluate(row=>getComputedStyle(row).display),'grid','song appearance groups retain their existing mobile grid');
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,null,{timeout:3000});

    await page.emulateMedia({reducedMotion:'reduce'});
    assert.strictEqual(await page.evaluate(()=>{
      const element=document.createElement('div');element.className='route-content-enter';document.body.append(element);
      const name=getComputedStyle(element).animationName;element.remove();return name;
    }),'none');
    assert.deepStrictEqual(errors,[]);
    console.log('navigation feedback, parallel downloads, cancellation, prefetch, identity rows and history passed; immediate feedback:',Math.round(immediate.ms)+'ms');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
