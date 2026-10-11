/* Shared original-image viewer for detail artwork and still galleries. */
(function () {
  'use strict';
  const selector = '.entity-cover img, .image-view-trigger img';
  const dialog = document.createElement('dialog');
  dialog.className = 'image-viewer';
  dialog.setAttribute('aria-label', '查看图片');
  dialog.innerHTML = '<div class="image-viewer-toolbar"><button type="button" data-action="previous" aria-label="上一张">←</button><span class="image-viewer-count"></span><button type="button" data-action="next" aria-label="下一张">→</button><button type="button" data-action="out" aria-label="缩小">−</button><button type="button" data-action="reset">适应窗口</button><button type="button" data-action="in" aria-label="放大">＋</button><a target="_blank" rel="noopener" class="image-viewer-original">原图 ↗</a><button type="button" data-action="close" aria-label="关闭">×</button></div><div class="image-viewer-stage"><img alt=""><p class="image-viewer-error" hidden>图片未能载入，请重试。<button type="button" data-action="retry">重试</button></p></div>';
  document.body.appendChild(dialog);
  const image = dialog.querySelector('img');
  const stage = dialog.querySelector('.image-viewer-stage');
  const error = dialog.querySelector('.image-viewer-error');
  let items = [], index = 0, scale = 1, x = 0, y = 0, drag = null, trigger = null;
  let restoreScroll = null;
  function original(element) {
    const value = element.dataset.original || element.currentSrc || element.src;
    const url = new URL(value, location.href);
    if (url.hostname === 'images.microcms-assets.io') url.search = '';
    return url.href;
  }
  function transform() {
    image.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
    stage.classList.toggle('is-zoomed', scale > 1);
  }
  function zoom(value) { scale = Math.max(1, Math.min(5, value)); if(scale === 1) x = y = 0; transform(); }
  function show(next) {
    index = Math.max(0, Math.min(items.length - 1, next));
    scale = 1; x = y = 0; transform(); error.hidden = true;
    stage.classList.add('is-loading');
    stage.setAttribute('aria-busy', 'true');
    image.src = original(items[index]); image.alt = items[index].alt || '';
    dialog.querySelector('.image-viewer-original').href = image.src;
    dialog.querySelector('.image-viewer-count').textContent = (index + 1) + ' / ' + items.length;
    dialog.querySelector('[data-action="previous"]').disabled = index === 0;
    dialog.querySelector('[data-action="next"]').disabled = index === items.length - 1;
  }
  function action(name) {
    if (name === 'close') dialog.close();
    else if (name === 'previous') show(index - 1);
    else if (name === 'next') show(index + 1);
    else if (name === 'in') zoom(scale + .5);
    else if (name === 'out') zoom(scale - .5);
    else if (name === 'reset') zoom(1);
    else if (name === 'retry') show(index);
  }
  document.addEventListener('click', function (event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const element = event.target.closest(selector);
    if (!element || !element.getAttribute('src') || element.src.includes('placeholder')) return;
    event.preventDefault();
    const gallery = element.closest('.anime-stills');
    items = gallery ? Array.from(gallery.querySelectorAll('img')) : [element];
    trigger = element.closest('button, a, [tabindex]') || element;
    restoreScroll = { x: window.scrollX, y: window.scrollY };
    show(items.indexOf(element)); dialog.showModal();
    document.body.classList.add('image-viewer-open');
  });
  dialog.addEventListener('click', function (event) {
    const button = event.target.closest('[data-action]');
    if (button) action(button.dataset.action);
    else if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', function () {
    document.body.classList.remove('image-viewer-open');
    const position = restoreScroll;
    restoreScroll = null;
    if (trigger && trigger.focus) {
      try { trigger.focus({ preventScroll: true }); } catch (_) { trigger.focus(); }
    }
    if (position) window.requestAnimationFrame(function () { window.scrollTo(position.x, position.y); });
    image.removeAttribute('src');
  });
  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); action('previous'); }
    if (event.key === 'ArrowRight') { event.preventDefault(); action('next'); }
    if (event.key === '+' || event.key === '=') zoom(scale + .5);
    if (event.key === '-') zoom(scale - .5);
  });
  function finishLoading() {
    stage.classList.remove('is-loading');
    stage.setAttribute('aria-busy', 'false');
  }
  image.addEventListener('load', finishLoading);
  image.addEventListener('error', function () { finishLoading(); error.hidden = false; });
  stage.addEventListener('wheel', function (event) { event.preventDefault(); zoom(scale + (event.deltaY < 0 ? .25 : -.25)); }, {passive:false});
  stage.addEventListener('pointerdown', function (event) {
    if (scale <= 1 || event.target !== image) return;
    drag = {x:event.clientX-x,y:event.clientY-y}; stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', function (event) { if(drag) {x=event.clientX-drag.x;y=event.clientY-drag.y;transform();} });
  stage.addEventListener('pointerup', function () {drag=null;});
  stage.addEventListener('pointercancel', function () {drag=null;});
  image.addEventListener('dragstart', function (event) {event.preventDefault();});
})();
