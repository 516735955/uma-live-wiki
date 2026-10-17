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

    await page.goto(base+'/zh-Hans/music/albums?page=2');
    await page.locator('.album-card').first().waitFor();
    assert(/31[–-]60\s*\/\s*115/.test(await page.locator('.ui-pager').innerText()));
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

    let homeFailed = true;
    await page.route('**/api/home-summary', route => homeFailed ? route.abort() : route.continue());
    await page.goto(base+'/zh-Hans/');
    await page.getByText('统计暂时无法载入。').waitFor();
    assert((await page.locator('.home-stat-number').allTextContents()).every(text => text.trim() === '—'));
    homeFailed = false;
    await page.getByText('统计暂时无法载入。').getByRole('button',{name:'重试'}).click();
    await page.waitForFunction(() => document.querySelector('.home-stat-number')?.textContent.trim() !== '—');

    let horseFailed = false;
    await page.route('**/api/catalog/horses?*', route => horseFailed ? route.abort() : route.continue());
    await page.goto(base+'/zh-Hans/database/horses');
    await page.locator('.horse-row').first().waitFor();
    horseFailed = true;
    await page.locator('input[type=search]').fill('a');
    await page.getByText('原型马目录暂时无法载入，请重试。').waitFor();
    horseFailed = false;
    await page.locator('.ui-state-error').filter({hasText:'原型马目录暂时无法载入，请重试。'}).getByRole('button',{name:'重试'}).click();
    await page.locator('.horse-row').first().waitFor();
    assert.strictEqual(await page.getByText('原型马目录暂时无法载入，请重试。').count(),0);

    let characterFailed = true;
    await page.route('**/data/character_detail_data.js*', route => characterFailed ? route.abort() : route.continue());
    await page.goto(base+'/zh-Hans/database/characters');
    await page.locator('#cIntroGrid a').first().waitFor();
    await page.locator('#cIntroGrid a').first().click();
    await page.getByText('角色完整资料暂时无法载入，请重试。').waitFor();
    characterFailed = false;
    await page.getByText('角色完整资料暂时无法载入，请重试。').getByRole('button',{name:'重试'}).click();
    await page.waitForFunction(() => window.__uma_app?.charDetail && !window.__uma_app.navigationError);

    let voiceFailed = true;
    await page.route('**/api/catalog/voice-actors?id=*', route => voiceFailed ? route.abort() : route.continue());
    await page.goto(base+'/zh-Hans/database/voice-actors/va-0142');
    await page.getByText('声优资料暂时无法载入，请重试。').waitFor();
    voiceFailed = false;
    await page.getByText('声优资料暂时无法载入，请重试。').getByRole('button',{name:'重试'}).click();
    await page.waitForFunction(() => window.__uma_app?.voiceDetail && !window.__uma_app.voiceError);
    assert.deepStrictEqual(errors,[]);
    console.log('news pending stages, stable switch, totals, modifier clicks, staff URL, voice aliases/node reuse and feedback recovery passed');
  } finally {await browser.close();}
}
main().catch(error => {console.error(error);process.exitCode=1;});
