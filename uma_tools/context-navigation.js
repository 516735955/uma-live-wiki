/* Keep the current record and its existing section actions available on long pages. */
(function () {
  const app = document.getElementById('app');
  const bar = document.createElement('nav');
  bar.className = 'context-navigation';
  bar.setAttribute('aria-label', '当前条目与栏目');
  bar.hidden = true;
  document.body.appendChild(bar);
  let current = null, observer = null, signature = '', pending = false;
  const indexToolbars = new Set();
  const toolbarSizes = new ResizeObserver(entries => entries.forEach(({target}) => {
    target.parentElement?.style.setProperty('--archive-toolbar-height', Math.ceil(target.getBoundingClientRect().height) + 'px');
  }));
  function indexFilters() {
    indexToolbars.forEach(toolbar => {
      if (!toolbar.isConnected) { toolbarSizes.unobserve(toolbar); indexToolbars.delete(toolbar); }
    });
    app.querySelectorAll('.archive-surface').forEach(surface => {
      if (surface.querySelector('.entity-detail')) return;
      const toolbar = surface.querySelector(':scope > .archive-toolbar');
      const filters = surface.querySelector(':scope > .archive-filter-row');
      if (!toolbar || !filters || indexToolbars.has(toolbar)) return;
      indexToolbars.add(toolbar); toolbarSizes.observe(toolbar);
      surface.style.setProperty('--archive-toolbar-height', Math.ceil(toolbar.getBoundingClientRect().height) + 'px');
      const button = document.createElement('button'); button.type='button';
      button.className='archive-filter-toggle';button.textContent='筛选';button.setAttribute('aria-expanded','false');
      button.onclick=()=>{
        const open=surface.classList.toggle('archive-filters-open');
        button.setAttribute('aria-expanded',String(open));
      };
      toolbar.appendChild(button);
    });
  }
  function headerHeight() {
    const header = document.querySelector('.sub-header');
    const height = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--context-header-height', height + 'px');
    return height;
  }
  function sync() {
    pending = false;
    indexFilters();
    const detail = app.querySelector('.entity-detail');
    const hero = detail?.querySelector('.entity-hero');
    const height = headerHeight();
    if (hero !== current) {
      observer?.disconnect();
      current = hero; signature = ''; bar.hidden = true;
      if (hero) {
        observer = new IntersectionObserver(() => {
          bar.hidden = hero.getBoundingClientRect().bottom > headerHeight();
        }, {rootMargin: '-' + height + 'px 0px 0px 0px',threshold:0});
        observer.observe(hero);
      }
    }
    if (!hero) return;
    const title = hero.querySelector('h1')?.textContent.trim() || '';
    const image = hero.querySelector('.entity-cover img');
    const tabs = Array.from(detail.querySelectorAll('.entity-tabs > button'));
    const next = JSON.stringify([title,image?.src,...tabs.map(tab=>[tab.textContent.trim(),tab.classList.contains('active')])]);
    if (next === signature) return;
    signature = next;
    const focused = bar.contains(document.activeElement) ? document.activeElement.textContent.trim() : '';
    const identity = document.createElement('button');
    identity.type = 'button'; identity.className = 'context-identity';
    identity.setAttribute('aria-label', '返回' + title + '顶部');
    if (image) {
      const preview = document.createElement('img');
      preview.src = image.src; preview.alt = ''; identity.appendChild(preview);
    }
    const label = document.createElement('span'); label.textContent = title;
    identity.appendChild(label);
    identity.onclick = () => hero.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'});
    const actions = document.createElement('div'); actions.className = 'context-sections';
    tabs.forEach(tab => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = tab.textContent.trim();
      button.classList.toggle('active',tab.classList.contains('active'));
      button.setAttribute('aria-pressed',String(tab.classList.contains('active')));
      button.onclick = () => {
        tab.click();
        requestAnimationFrame(() => detail.querySelector('.entity-section')?.scrollIntoView({
          behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth',block:'start'
        }));
      };
      actions.appendChild(button);
    });
    bar.replaceChildren(identity,actions);
    if (focused) Array.from(bar.querySelectorAll('button')).find(button=>button.textContent.trim()===focused)?.focus({preventScroll:true});
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(sync); } }
  new MutationObserver(schedule).observe(app,{subtree:true,childList:true,attributes:true,attributeFilter:['class','src']});
  addEventListener('resize', () => { current=null;schedule(); });
  schedule();
})();
