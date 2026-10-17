/* PhotoSwipe 5.4.4 adapter for real artwork; synthetic identity SVGs remain static. */
import PhotoSwipe from '/uma_tools/vendor/photoswipe/photoswipe.esm.min.js';

const selector = '.entity-cover img, .image-view-trigger img, .roommate-image, .news-detail-cover, .news-detail-body img';
const esc = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = path => '<svg class="pswp__icn" viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>';
let activeViewer = null;
let activeTrigger = null;
function original(img) {
  const url = new URL(img.dataset.original || img.currentSrc || img.src, location.href);
  if (url.hostname === 'images.microcms-assets.io') url.search = '';
  return url.href;
}
function eligible(img) {
  const value = img.getAttribute('src') || '';
  return value && !/^(data:|blob:)|placeholder|\.svg(?:[?#]|$)/i.test(value) && !img.closest('.pswp');
}
function decorate() {
  document.querySelectorAll(selector).forEach(img => {
    const button = img.closest('button, a') || img;
    if (!eligible(img)) {
      if (button === img) {
        img.removeAttribute('tabindex'); img.removeAttribute('role'); img.removeAttribute('aria-label');
      }
      img.classList.remove('original-image');
      return;
    }
    img.classList.add('original-image');
    if (button === img) {
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', '查看' + (img.alt || '图片') + '原图');
    }
  });
}
function openViewer(img) {
  if (activeViewer || !eligible(img)) return;
  const gallery = img.closest('.anime-stills, .news-detail');
  const images = gallery ? Array.from(gallery.querySelectorAll('img')).filter(eligible) : [img];
  const trigger = img.closest('button, a') || img;
  const data = images.map(element => ({
    src: original(element), msrc: element.currentSrc || element.src,
    width: Number(element.dataset.width) || element.naturalWidth || 1280,
    height: Number(element.dataset.height) || element.naturalHeight || 720,
    alt: element.alt || '', source: element.dataset.source || original(element),
    element
  }));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pswp = new PhotoSwipe({
    dataSource: data, index: images.indexOf(img), bgOpacity: .94, mainClass: 'uma-image-viewer',
    showHideAnimationType: getComputedStyle(img).objectFit==='cover'?'fade':'zoom',
    showAnimationDuration: reduced ? 0 : 240, hideAnimationDuration: reduced ? 0 : 190,
    easing: 'cubic-bezier(.22,1,.36,1)', counter: false, zoom: false, returnFocus: false,
    preloaderDelay: 450, preload: [0,1], initialZoomLevel: levels=>Math.min(1,levels.fit), secondaryZoomLevel: 1,
    arrowPrev: data.length>1, arrowNext: data.length>1,
    maxZoomLevel: 4, paddingFn: v => ({top:v.x<650?68:76,bottom:16,left:v.x<650?12:74,right:v.x<650?12:74}),
    closeSVG: icon('<path d="m6 6 12 12M18 6 6 18"/>'),
    arrowPrevSVG: icon('<path d="m14 5-7 7 7 7"/>'),
    arrowNextSVG: icon('<path d="m10 5 7 7-7 7"/>'),
    closeTitle: '关闭', arrowPrevTitle: '上一张', arrowNextTitle: '下一张'
  });
  activeViewer = pswp;
  activeTrigger = trigger;
  let closeAfterOpening = false;
  const openingKey = event => {
    if (event.key === 'Escape' && !pswp.opener.isOpen && !pswp.isDestroying) {
      event.preventDefault();
      closeAfterOpening = true;
    }
  };
  document.addEventListener('keydown', openingKey, true);
  pswp.on('openingAnimationEnd', () => { if (closeAfterOpening) pswp.close(); });
  pswp.on('destroy', () => document.removeEventListener('keydown', openingKey, true));
  const fitLevel = () => Math.min(1, pswp.currSlide.zoomLevels.fit);
  const zoom = factor => {
    const s = pswp.currSlide;
    if(!s || pswp.isDestroying)return;
    s.zoomTo(Math.min(s.zoomLevels.max, Math.max(fitLevel(),s.currZoomLevel*factor)), undefined, reduced?0:180);
  };
  const fit = () => {if(pswp.currSlide && !pswp.isDestroying)pswp.currSlide.zoomTo(fitLevel(), undefined, reduced?0:180)};
  const actual = () => {if(pswp.currSlide && !pswp.isDestroying)pswp.currSlide.zoomTo(1, undefined, reduced?0:180)};
  pswp.addFilter('thumbBounds', (_,item) => {
    const rect = (item.element || img).getBoundingClientRect();
    const element = item.element || img;
    const ratio = (element.naturalWidth || item.width) / (element.naturalHeight || item.height);
    const width = Math.min(rect.width,rect.height*ratio);
    const height = width/ratio;
    return {x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,w:width};
  });
  pswp.addFilter('contentErrorElement', (_,content) => {
    const box = document.createElement('div');
    box.className = 'viewer-failure';
    box.innerHTML = '<img src="' + esc(content.data.msrc) + '" alt="' + esc(content.data.alt) +
      '预览"><div class="viewer-failure-message"><p>大图未能载入，预览仍可查看。</p>' +
      '<button type="button">重试</button><a target="_blank" rel="noopener">打开来源</a></div>';
    box.querySelector('a').href = content.data.source;
    const retry = box.querySelector('button');
    retry.onclick = () => {
      if (retry.disabled || pswp.isDestroying) return;
      retry.disabled = true;
      retry.textContent = '加载中';
      // Keep the working preview attached while a separate image retries the original.
      const image = new Image();
      retryImages.add(image);
      const timer = setTimeout(() => { image.onerror?.(); image.src = ''; }, 15000);
      retryTimers.add(timer);
      const finish = () => { clearTimeout(timer); retryTimers.delete(timer); retryImages.delete(image); image.onload = image.onerror = null; };
      image.onerror = () => {
        finish();
        if (pswp.isDestroying) return;
        retry.disabled = false;
        retry.textContent = '重试';
      };
      image.onload = () => {
        finish();
        if (pswp.isDestroying || !image.naturalWidth) return;
        content.data.width = image.naturalWidth;
        content.data.height = image.naturalHeight;
        readySlides.add(content.index);
        refreshReadySlide();
      };
      image.src = content.data.src;
    };
    return box;
  });
  const retryImages = new Set();
  const retryTimers = new Set();
  const loadTimers = new Map();
  pswp.on('contentLoadImage', ({content}) => {
    clearTimeout(loadTimers.get(content));
    loadTimers.set(content, setTimeout(() => {
      loadTimers.delete(content);
      if (pswp.isDestroying || !content.isLoading()) return;
      if (content.element) { content.element.onload = content.element.onerror = null; content.element.src = ''; }
      content.onError();
    }, 15000));
  });
  function clearLoad(content) { clearTimeout(loadTimers.get(content)); loadTimers.delete(content); }
  pswp.on('loadComplete', ({content}) => clearLoad(content));
  pswp.on('contentDestroy', ({content}) => clearLoad(content));
  const readySlides = new Set();
  const refreshReadySlide = () => requestAnimationFrame(() => {
    if (pswp.isDestroying || !pswp.opener.isOpen || pswp.mainScroll.isShifted() || !readySlides.has(pswp.currIndex)) return;
    readySlides.delete(pswp.currIndex);
    pswp.refreshSlideContent(pswp.currIndex);
  });
  // PhotoSwipe's default activation retries an error by replacing its element,
  // leaving the custom preview behind. Only the explicit retry replaces it.
  pswp.on('contentActivate', event => {
    if (event.content.isError()) {
      event.preventDefault();
      event.content.slide?.holderElement?.setAttribute('aria-hidden', 'false');
    }
  });
  pswp.on('loadComplete', ({content, isError}) => {
    const element = content.element;
    if (isError || !element?.naturalWidth || (content.data.width === element.naturalWidth && content.data.height === element.naturalHeight)) return;
    content.data.width = element.naturalWidth;
    content.data.height = element.naturalHeight;
    content.width = element.naturalWidth;
    content.height = element.naturalHeight;
    if (content.slide) {
      content.slide.width = element.naturalWidth;
      content.slide.height = element.naturalHeight;
      content.slide.resize();
    }
  });
  pswp.on('openingAnimationEnd', refreshReadySlide);
  pswp.on('change', refreshReadySlide);
  pswp.on('moveMainScroll', () => { if (readySlides.size) refreshReadySlide(); });
  pswp.on('destroy', () => {
    retryImages.forEach(image => { image.onload = image.onerror = null; image.src = ''; });
    retryImages.clear();
    retryTimers.forEach(clearTimeout);
    retryTimers.clear();
    loadTimers.forEach(clearTimeout);
    loadTimers.clear();
    readySlides.clear();
  });
  pswp.on('uiRegister', () => {
    pswp.ui.registerElement({name:'title',order:1,isButton:false,className:'viewer-title',onInit:el=>{
      const update = () => el.textContent = (data[pswp.currIndex].alt || '查看原图') + (data.length>1?' · '+(pswp.currIndex+1)+' / '+data.length:'');
      pswp.on('change',update); update();
    }});
    pswp.ui.registerElement({name:'out',order:5,isButton:true,ariaLabel:'缩小',html:icon('<path d="M5 12h14"/>'),onClick:()=>zoom(.8)});
    pswp.ui.registerElement({name:'in',order:6,isButton:true,ariaLabel:'放大',html:icon('<path d="M5 12h14M12 5v14"/>'),onClick:()=>zoom(1.25)});
    pswp.ui.registerElement({name:'fit',order:7,isButton:true,ariaLabel:'适应窗口',html:'适应窗口',onClick:fit});
    pswp.ui.registerElement({name:'actual',order:8,isButton:true,ariaLabel:'按原始尺寸查看',html:'100%',onClick:actual});
    pswp.ui.registerElement({name:'original',order:9,isButton:false,tagName:'a',html:'打开原图'+icon('<path d="M7 17 17 7M7 7h10v10"/>'),onInit:el=>{
      el.classList.add('pswp__button','pswp__button--original'); el.target='_blank'; el.rel='noopener';
      const update = () => el.href = data[pswp.currIndex].src;
      pswp.on('change',update); update();
    }});
    pswp.ui.registerElement({name:'more',order:10,isButton:false,className:'viewer-more',
      html:'<button type="button" aria-label="更多图片操作" aria-expanded="false">' +
        icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>') +
        '</button><div class="viewer-menu" hidden><button type="button" data-action="fit">适应窗口</button>' +
        '<button type="button" data-action="actual">原始尺寸 100%</button><a target="_blank" rel="noopener">打开原图</a></div>',
      onInit:el=>{
        const button=el.querySelector('button'), menu=el.querySelector('.viewer-menu');
        const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false')};
        button.onclick=()=>{menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector('button').focus()};
        menu.querySelector('[data-action=fit]').onclick=()=>{fit();close();button.focus({preventScroll:true})};
        menu.querySelector('[data-action=actual]').onclick=()=>{actual();close();button.focus({preventScroll:true})};
        menu.querySelector('a').onclick=close;
        const outside=event=>{if(!el.contains(event.target))close()};
        const key=event=>{
          if(event.key==='Escape' && !menu.hidden){event.preventDefault();event.stopImmediatePropagation();close();button.focus()}
        };
        document.addEventListener('pointerdown',outside);
        document.addEventListener('keydown',key,true);
        pswp.on('destroy',()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true)});
        const update=()=>{menu.querySelector('a').href=data[pswp.currIndex].src;close()};
        pswp.on('change',update); update();
      }});
  });
  const updateControls=()=>{
    const slide=pswp.currSlide;
    if(!slide || !pswp.element)return;
    const out=pswp.element.querySelector('.pswp__button--out'),inside=pswp.element.querySelector('.pswp__button--in');
    if(out)out.disabled=slide.currZoomLevel<=fitLevel()+.001;
    if(inside)inside.disabled=slide.currZoomLevel>=slide.zoomLevels.max-.001;
  };
  pswp.on('zoomPanUpdate',updateControls);
  pswp.on('change',updateControls);
  pswp.on('afterInit',updateControls);
  const position={x:scrollX,y:scrollY};
  document.body.classList.add('image-viewer-open');
  pswp.on('destroy',()=>{
    activeViewer=null;activeTrigger=null;document.body.classList.remove('image-viewer-open');
    requestAnimationFrame(()=>{if(trigger.isConnected) trigger.focus({preventScroll:true});window.scrollTo(position.x,position.y)});
  });
  pswp.init();
}
document.addEventListener('click', event=>{
  if(event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const img=event.target.closest(selector) || event.target.closest('.image-view-trigger')?.querySelector('img');
  if(!img || !eligible(img)) return;
  event.preventDefault();openViewer(img);
});
document.addEventListener('keydown', event=>{
  if(event.target.matches?.('img.original-image') && ['Enter',' '].includes(event.key)){
    event.preventDefault();openViewer(event.target);
  }
});
let pending=false;
new MutationObserver(()=>{
  if(pending)return;pending=true;
  requestAnimationFrame(()=>{pending=false;if(activeViewer && activeTrigger && !activeTrigger.isConnected)activeViewer.close();decorate()});
}).observe(document.getElementById('app') || document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['src','data-original']});
decorate();
