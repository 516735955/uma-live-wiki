'use strict';
const assert = require('assert');
const {chromium} = require('playwright');
const base = process.env.UMA_TEST_URL || 'http://localhost:18083';

async function main() {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  const errors = [];
  const page = await browser.newPage({viewport:{width:390,height:900}, timezoneId:'America/Los_Angeles'});
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  try {
    let indexCalls = 0, detailCalls = 0;
    await page.route('**/api/news-index*', route => {indexCalls++; return route.abort();});
    await page.route('**/api/news-detail*', route => {
      detailCalls++;
      const detail = {announce_id:3377,title:'日本語の長い見出し'.repeat(6), title_zh:'测试新闻',post_at:'2026-10-17 12:00:00'};
      if (detailCalls === 1) Object.assign(detail,{archive_state:'pending',message:'',message_zh:''});
      else Object.assign(detail,{translation_state:detailCalls === 2 ? 'pending' : 'complete', message:'<p>日本語</p>',message_zh:detailCalls === 2 ? '' : '<p>已完成译文</p>'});
      return route.fulfill({status:detailCalls === 1 ? 202 : 200,json:{detail}});
    });
    await page.goto(base+'/zh-Hans/news/3377');
    await page.locator('.news-detail-body').filter({hasText:'已完成译文'}).waitFor();
    assert.strictEqual(indexCalls,0,'a detail link does not wait for the news index');
    assert.strictEqual(detailCalls,3,'archive and translation stages both poll');
    assert.strictEqual(await page.locator('.news-detail .ui-state-loading').count(),0);
    const before = await page.locator('.news-language').boundingBox(), url = page.url();
    await page.locator('.news-language').click();
    await page.locator('.news-detail-body').filter({hasText:'日本語'}).waitFor();
    const after = await page.locator('.news-language').boundingBox();
    assert.deepStrictEqual(after,before,'switch position stays fixed when heading wraps');
    assert.strictEqual(page.url(),url);

    const pictures = await page.evaluate(() => {
      const app = window.__uma_app, saved = app.newsDetail;
      app.newsDetail = {...saved,message:'<picture><source sizes="50vw" srcset="/uma_tools/img/hero_bg.jpg 2000w"><img data-src="/uma_tools/img/hero_bg.jpg"></picture>'};
      app.setNewsLanguage('ja');
      const body = new DOMParser().parseFromString(app.newsDetailBody,'text/html');
      const source = body.querySelector('source'), img = body.querySelector('img');
      const result = {source:source.getAttribute('srcset'),sizes:source.getAttribute('sizes'),img:img.getAttribute('src')};
      app.newsDetail = saved; app.setNewsLanguage('zh');
      return result;
    });
    assert(pictures.img && pictures.source.includes('1440w') && !pictures.source.includes('2000w'));
    assert.strictEqual(pictures.sizes,'50vw');

    await page.evaluate(async () => {
      const host = document.createElement('div'); host.style='position:fixed;top:80px;left:20px;width:220px;z-index:99999'; document.body.append(host);
      const options = Vue.ref([{value:'group',label:'Group',children:[{value:'old',label:'Old'}]}]);
      let select;
      const fixture = Vue.createApp({setup:()=>()=>Vue.h(window.UmaUi.UiSelect,{ref:value=>select=value,options:options.value,modelValue:'old'})});
      fixture.mount(host); select.toggle(); await Vue.nextTick();
      select.$el.querySelector('.ui-select-back').focus(); select.onKeydown({key:'Escape',preventDefault(){},stopPropagation(){}});
      if (document.activeElement !== select.$refs.trigger) throw Error('Escape lost the select trigger focus');
      select.toggle(); options.value=[{value:'disabled',label:'Disabled',disabled:true},{value:'enabled',label:'Enabled'}]; await Vue.nextTick();
      if (select.visibleOptions.some(row=>row.value==='old') || select.visibleOptions[select.activeIndex]?.disabled) throw Error('select kept stale or disabled options');
      window.selectFixture={select,host,fixture};
    });
    await page.setViewportSize({width:390,height:320});
    await page.waitForFunction(()=>{const r=window.selectFixture.select.$refs.menu.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;});
    await page.evaluate(()=>{window.selectFixture.fixture.unmount();window.selectFixture.host.remove();delete window.selectFixture;});
    await page.setViewportSize({width:390,height:900});

    const imageBehavior = await page.evaluate(async () => {
      const img=document.createElement('img');img.style='position:fixed;top:0;left:0;width:100px';document.body.append(img);
      window.UmaMedia.apply(img,'/uma_tools/img/hero_bg.jpg');
      await new Promise(resolve=>{if(img.complete)resolve();else img.onload=resolve;});
      img.style.width='500px';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const sizes=img.sizes;
      window.UmaMedia.fallback(img,'/uma_tools/img/album-placeholder.svg');
      window.UmaMedia.apply(img,'/uma_tools/img/news-card-default.webp');
      window.UmaMedia.fallback(img,'/uma_tools/img/album-placeholder.svg');
      const reset=!img.srcset && img.src.endsWith('album-placeholder.svg');
      const emitted=[];
      const method=window.__uma_app.$.appContext.components['audio-dock'].methods.onDocumentKeydown;
      img.setAttribute('role','button');
      for(const defaultPrevented of [false,true]) method.call({player:{current:{id:'test'}},$emit:(...args)=>emitted.push(args)},
        {key:' ',code:'Space',target:img,defaultPrevented,preventDefault(){}});
      window.UmaMedia.release(img);img.remove();
      return {sizes,reset,emitted};
    });
    assert.strictEqual(imageBehavior.sizes,'500px','image candidates follow their actual resized container');
    assert(imageBehavior.reset,'a second failed source still receives its fallback');
    assert.strictEqual(imageBehavior.emitted.length,0,'image interaction never also controls audio');

    await page.goto(base+'/zh-Hans/music/albums?page=2');
    await page.locator('.album-card').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.album-card img')].slice(0,6)
      .every(img => img.complete && img.naturalWidth > 0));
    assert(/31[–-]60\s*\/\s*115/.test(await page.locator('.ui-pager').innerText()));
    await page.goto(base+'/zh-Hans/events');
    await page.locator('.event-catalog-cover img').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.event-catalog-cover img')].slice(0,3)
      .every(img => img.complete && img.naturalWidth > 0));
    await page.goto(base+'/zh-Hans/database/horses?page=2');
    await page.locator('.horse-row').first().waitFor();
    assert(!/\/\s*30\b/.test(await page.locator('.ui-pager').innerText()));
    await page.evaluate(() => {
      const anchor = document.querySelector('.horse-row');
      window.modifiedPrevented = null;
      anchor.addEventListener('click', event => { window.modifiedPrevented = event.defaultPrevented; event.preventDefault(); }, {once:true});
      anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));
    });
    assert.strictEqual(await page.evaluate(() => window.modifiedPrevented),false);

    await page.goto(base+'/zh-Hans/database/staff?page=999');
    await page.waitForFunction(() => window.__uma_app?.routeReady && new URL(location.href).searchParams.get('page') === String(window.__uma_app.staffPage));
    await page.goto(base+'/zh-Hans/database/voice-actors');
    await page.locator('#vaGrid a').first().waitFor();
    await page.evaluate(() => {window.firstVoiceCard=document.querySelector('#vaGrid a');});
    await page.locator('#vaSearch').fill('山本昌広');
    await page.waitForFunction(() => document.querySelector('#vaGrid')?.children.length === 1);
    await page.locator('#vaSearch').fill('');
    await page.waitForFunction(() => document.querySelector('#vaGrid')?.children.length > 100);
    assert(await page.evaluate(() => document.querySelector('#vaGrid a') === window.firstVoiceCard));

    await page.route('https://formsubmit.co/**', route => route.fulfill({json:{success:true}}));
    await page.goto(base+'/zh-Hans/contribute/fix');
    await page.locator('#fixPage').fill(base+'/zh-Hans/news/3377');
    await page.locator('#fixBody').fill('本地拦截测试，不发送真实反馈');
    await page.locator('.fix-check input').check();
    await page.locator('.fix-submit').click();
    await page.locator('.fix-feedback.success').waitFor();
    await page.locator('#fixBody').fill('修改后可以继续提交');
    assert(await page.locator('.fix-submit').isEnabled());
    await page.route('https://formsubmit.co/**', route => route.abort());
    await page.locator('.fix-submit').click();
    await page.locator('.fix-feedback.error').waitFor();
    assert.strictEqual(await page.locator('#fixBody').inputValue(),'修改后可以继续提交');
    await page.route('https://formsubmit.co/**', () => {});
    await page.clock.install();
    await page.locator('.fix-submit').click();
    await page.clock.runFor(20001);
    await page.locator('.fix-feedback.error').waitFor();
    assert(await page.locator('.fix-submit').isEnabled(),'a stalled submission stops waiting');
    await page.clock.resume();
    let pendingSubmission;
    const submitted = new Promise(resolve => { pendingSubmission = resolve; });
    await page.route('https://formsubmit.co/**', route => pendingSubmission(route));
    await page.locator('.fix-submit').click();
    const submission = await submitted;
    await page.locator('#fixBody').fill('发送途中编辑的草稿仍可提交');
    await submission.fulfill({json:{success:true}});
    await page.waitForFunction(() => window.__uma_app.fixSendState === '');
    assert(await page.locator('.fix-submit').isEnabled(),'an earlier success does not lock the newer draft');

    let homeFailed = true;
    await page.route('**/api/home-summary', route => homeFailed ? route.abort() : route.continue());
    await page.goto(base+'/zh-Hans/');
    await page.locator('.home-summary-error .content-state-error').waitFor();
    assert((await page.locator('.home-stat-number').allTextContents()).every(text => text.trim() === '—'));
    homeFailed = false;
    await page.locator('.home-summary-error').getByRole('button',{name:'重试'}).click();
    await page.waitForFunction(() => document.querySelector('.home-stat-number')?.textContent.trim() !== '—');

    let horseFailed = false;
    await page.route('**/api/catalog/horses?*', route => horseFailed ? route.abort() : route.continue());
    await page.goto(base+'/zh-Hans/database/horses');
    await page.locator('.horse-row').first().waitFor();
    horseFailed = true;
    await page.locator('input[type=search]').fill('a');
    await page.locator('.content-state-error').filter({hasText:'原型马资料'}).waitFor();
    horseFailed = false;
    await page.locator('.content-state-error').filter({hasText:'原型马资料'}).getByRole('button',{name:'重试'}).click();
    await page.locator('.horse-row').first().waitFor();
    assert.strictEqual(await page.locator('.content-state-error').count(),0);

    let characterFailed = true;
    await page.route('**/data/character_detail_data.js*', route => characterFailed ? route.abort() : route.continue());
    await page.goto(base+'/zh-Hans/database/characters');
    await page.locator('#cIntroGrid a').first().waitFor();
    await page.locator('#cIntroGrid a').first().click();
    await page.locator('.content-state-error').waitFor();
    characterFailed = false;
    await page.locator('.content-state-error').getByRole('button',{name:'重试'}).click();
    await page.waitForFunction(() => window.__uma_app?.charDetail && !window.__uma_app.navigationError);

    let voiceFailed = true;
    await page.route('**/api/catalog/voice-actors?id=*', route => voiceFailed ? route.abort() : route.continue());
    await page.goto(base+'/zh-Hans/database/voice-actors/va-0142');
    await page.locator('.content-state-error').filter({hasText:'声优资料'}).waitFor();
    voiceFailed = false;
    await page.locator('.content-state-error').filter({hasText:'声优资料'}).getByRole('button',{name:'重试'}).click();
    await page.waitForFunction(() => window.__uma_app?.voiceDetail && !window.__uma_app.voiceError);
    for (const [detailPath, dependency] of [
      ['/music/songs/song-fb9000e3ae/credits', '**/data/character_index_data.js*'],
      ['/music/albums/album-laca-15859', '**/api/catalog/voice-actors?scope=index'],
    ]) {
      let failed = true;
      await page.route(dependency, route => failed ? route.abort() : route.continue());
      await page.goto(base + '/zh-Hans' + detailPath, {waitUntil:'domcontentloaded'});
      await page.locator('.entity-hero h1').waitFor();
      const warning = page.locator('.content-state-error').filter({hasText:'人物资料'});
      await warning.waitFor();
      assert.strictEqual(await page.locator('.content-state-uncollected').filter({hasText:/尚未收录(歌曲|专辑)$/}).count(),0);
      failed = false;
      await warning.getByRole('button',{name:'重试'}).click();
      await page.waitForFunction(() => window.CHAR_INDEX?.length > 0 && window.__uma_app.voiceProfiles.length > 0 && !window.__uma_app.musicPeopleError);
      assert.strictEqual(await page.locator('.entity-hero h1').count(),1,'retry keeps the music detail visible');
      await page.unroute(dependency);
    }
    assert.deepStrictEqual(errors,[]);
    console.log('news pending stages, stable switch, totals, modifier clicks, staff URL, voice aliases/node reuse and feedback recovery passed');
  } finally {await browser.close();}
}
main().catch(error => {console.error(error);process.exitCode=1;});
