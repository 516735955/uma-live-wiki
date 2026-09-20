(function () {
  function renderIntro(root) {
    var grid = (root || document).querySelector('#cIntroGrid');
    var input = (root || document).querySelector('#cIntroSearch');
    var listBox = (root || document).querySelector('#cIntroList');
    if (!grid || !input || grid.getAttribute('data-c-inited')) return;
    grid.setAttribute('data-c-inited', '1');
    function norm(c) { return String(c || '').toLowerCase(); }
    function data() {
      return (window.CHAR_INDEX && window.CHAR_INDEX.length) ? window.CHAR_INDEX : [];
    }
    function render() {
      var q = norm(input.value.trim());
      var s = window.__uma_app ? window.__uma_app.charSort : 'default';
      var list = data().filter(function (c) {
        if (!q) return true;
        return norm(c.zh).indexOf(q) >= 0 || norm(c.ja).indexOf(q) >= 0 ||
               norm(c.en).indexOf(q) >= 0 || norm(c.cv_zh).indexOf(q) >= 0 || norm(c.cv).indexOf(q) >= 0;
      });
      if (s === 'zh') { list = list.slice().sort(function (a, b) { return norm(a.zh).localeCompare(norm(b.zh), 'zh'); }); }
      else if (s === 'en') { list = list.slice().sort(function (a, b) { return norm(a.en).localeCompare(norm(b.en)); }); }
      else if (s === 'cv') { list = list.slice().sort(function (a, b) { return norm(a.cv_zh).localeCompare(norm(b.cv_zh), 'zh'); }); }
      grid.innerHTML = '';
      list.forEach(function (c, i) {
        var li = document.createElement('li');
        var card = document.createElement('a');
        card.className = 'cio-card';
        card.href = '/zh-Hans/database/characters/' + encodeURIComponent(c.id);
        card.addEventListener('click', function (e) {
          e.preventDefault();
          openCharDetailGlobal(c.id);
        });
        card.style.setProperty('--color-main', c.main || '#8c83ff');
        card.style.setProperty('--color-sub', c.sub || '#ece9ff');
        var imageAttrs = (i < 2 ? ' loading="eager"' : ' loading="lazy"') + (i === 0 ? ' fetchpriority="high"' : '') + ' decoding="async"';
        card.innerHTML =
          '<dl>' +
            '<dt>' +
              (c.img || c.av ? '<div class="cio-img"><img src="' + (c.img || c.av) + '" alt="' + ((c.zh || '').replace(/（[^（）]*）$/, '')) + '"' + imageAttrs + '></div>' : '<div class="cio-img cio-img-empty"><p>暂无图片</p></div>') +
              '<div class="cio-bg"><p>' + (c.en || c.ja || '') + '</p></div>' +
            '</dt>' +
            '<dd>' +
              '<p class="cio-name">' + ((c.zh || '').replace(/（[^（）]*）$/, '')) + '</p>' +
              '<p class="cio-cv"><span>CV:</span>' + (c.cv_zh || c.cv || '') + '</p>' +
            '</dd>' +
          '</dl>' +
          '<div class="cio-veil"><p>View more</p><span class="cio-arrow">&gt;</span></div>';
        li.appendChild(card);
        grid.appendChild(li);
      });
      var nodata = (root || document).querySelector('#cIntroNoData');
      if (nodata) nodata.style.display = list.length ? 'none' : 'block';
      if (listBox) listBox.classList.remove('loading');
    }
    input.addEventListener('input', render);
    window.addEventListener('uma-character-sort', render);
    render();
  }

  window.renderBloodGraphInDetail = renderBloodGraphInDetail;

  function renderDetail(root) {
    var box = (root || document).querySelector('#cDetailBlock');
    if (!box) return;
    function fill() {
      refreshRelIndex();
      var detail = window.__uma_app ? window.__uma_app.charDetail : null;
      if (!detail || !detail.id || !window.CHAR_DETAIL) return;
      if (box.getAttribute('data-d-filled') === detail.id) return;
      var d = window.CHAR_DETAIL[detail.id];
      if (!d || !d.html) return;
      var source = document.createElement('div');
      source.innerHTML = d.html;
      var description = source.querySelector('.uma-description');
      box.innerHTML = description && description.innerHTML.trim()
        ? '<div class="character-description">' + description.innerHTML + '</div>'
        : '';
      box.setAttribute('data-d-filled', detail.id);
    }
    fill();
  }
  window.renderCharacterDetail = renderDetail;

  /* ---------- 血缘关系节点图（角色详情页下方） ---------- */
  var relByCid = {};
  var relSource = null;
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'uma-pedigree-height') return;
    var frames = document.querySelectorAll('.c-pedigree-lens-frame');
    frames.forEach(function (frame) {
      if (frame.contentWindow !== event.source) return;
      if (frame.dataset.pedigreeSample !== event.data.sample) return;
      var height = Math.max(76, Math.min(3200, Number(event.data.height) || 0));
      if (height) frame.style.height = height + 'px';
    });
  });
  function refreshRelIndex() {
    if (typeof PED_REL === 'undefined' || relSource === PED_REL) return;
    relByCid = {};
    PED_REL.forEach(function (n) { relByCid[n.cid] = n; });
    relSource = PED_REL;
  }

  function renderBloodGraphInDetail(box, root) {
    if (!box) return;
    refreshRelIndex();

    var relation = relByCid[root];
    var message = '';
    if (relation && relation.mapping_kind === 'non_uma') {
      message = '该角色非赛马娘，无现实原型，不提供血缘关系图。';
    } else if (relation && (relation.mapping_kind === 'original' || relation.pure)) {
      message = '该角色为纯原创赛马娘，无现实原型，不提供血缘关系图。';
    }
    if (message) {
      var note = document.createElement('p');
      note.className = 'pedigree-empty';
      note.textContent = message;
      box.appendChild(note);
      return true;
    }

    if (!relation) return false;
    var lens = document.createElement('section');
    lens.className = 'c-pedigree-lens';
    var frame = document.createElement('iframe');
    var displayName = relation.zh || root;
    var sampleId = String(root).replace(/[^a-z0-9_]/gi, '');
    frame.className = 'c-pedigree-lens-frame';
    frame.dataset.pedigreeSample = root;
    frame.srcdoc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<link rel="stylesheet" href="/uma_tools/pedigree-lab.css?v=20260911-15">' +
      '<script>window.PEDIGREE_SAMPLE=' + JSON.stringify(sampleId) +
      ';window.PEDIGREE_EMBEDDED=true;' +
      'window.CHAR_INDEX=window.parent.CHAR_INDEX||[];' +
      'window.PED_REL=window.parent.PED_REL||[];<\/script>' +
      '<script defer src="/uma_tools/pedigree-lab.js?v=20260911-20"><\/script></head>' +
      '<body><a id="character-back-link" hidden></a><main class="lab-page">' +
      '<section class="lab-workspace" aria-labelledby="workspace-title">' +
      '<div class="workspace-head"><h2 id="workspace-title">血统关系</h2></div>' +
      '<div class="workspace-content"><div class="workspace-body">' +
      '<div class="graph-viewport" id="graph-viewport" aria-label="血统关系图"><div class="graph-stage" id="graph-stage"></div></div>' +
      '</div></div></section></main>' +
      '<div class="mobile-sheet" id="mobile-sheet" aria-hidden="true">' +
      '<button type="button" class="sheet-backdrop" data-sheet-close aria-label="关闭关系详情"></button>' +
      '<section class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
      '<div class="sheet-grip"></div><button type="button" class="sheet-close" data-sheet-close aria-label="关闭">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '<div id="sheet-content"></div></section></div></body></html>';
    frame.title = displayName + '的血统关系';
    frame.loading = 'lazy';
    lens.appendChild(frame);
    box.appendChild(lens);
    return true;
  }

  function openCharDetailGlobal(id) {
    if (window.__uma_app && typeof window.__uma_app.openCharDetail === 'function') {
      window.__uma_app.openCharDetail(id);
    }
  }

  function roomDist(a, b) {
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function closeRoomLightbox(ov) {
    if (ov) { ov.style.display = 'none'; var im = ov.querySelector('img'); if (im) { im.style.transform = ''; } }
  }
  function initRoomPinch(ov) {
    if (ov.getAttribute('data-pinch')) return;
    ov.setAttribute('data-pinch', '1');
    var img = ov.querySelector('img');
    var st = { scale: 1, tx: 0, ty: 0 };
    ov._roomSt = st;
    var ges = null, multi = false, suppress = false;
    function apply() {
      if (st.scale > 1.01) img.classList.add('zoomed');
      else img.classList.remove('zoomed');
      img.style.transform = 'translate(' + st.tx + 'px,' + st.ty + 'px) scale(' + st.scale + ')';
    }
    ov.addEventListener('touchstart', function (e) {
      if (e.touches.length >= 2) {
        multi = true;
        e.preventDefault();
      }
      if (e.touches.length === 2) {
        ges = { type: 'pinch', d: roomDist(e.touches[0], e.touches[1]), s: st.scale, tx: st.tx, ty: st.ty, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      } else if (e.touches.length === 1 && !multi) {
        ges = { type: 'pan', x: e.touches[0].clientX, y: e.touches[0].clientY, tx: st.tx, ty: st.ty };
      }
    }, { passive: false });
    ov.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && ges && ges.type === 'pinch') {
        e.preventDefault(); suppress = true;
        var d = roomDist(e.touches[0], e.touches[1]);
        if (d > 0) {
          var ns = Math.max(1, Math.min(6, ges.s * d / ges.d));
          var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          var nx = (ges.cx - ges.tx) / ges.s, ny = (ges.cy - ges.ty) / ges.s;
          st.scale = ns;
          st.tx = cx - nx * ns; st.ty = cy - ny * ns;
          apply();
        }
      } else if (e.touches.length === 1 && ges && ges.type === 'pan') {
        e.preventDefault(); suppress = true;
        var dx = e.touches[0].clientX - ges.x, dy = e.touches[0].clientY - ges.y;
        st.tx = ges.tx + dx; st.ty = ges.ty + dy;
        apply();
      }
    }, { passive: false });
    ov.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) multi = false;
      if (e.touches.length === 0) ges = null;
    }, { passive: true });
    ov.addEventListener('click', function (e) {
      if (suppress) { suppress = false; e.preventDefault(); e.stopPropagation(); return; }
      closeRoomLightbox(ov);
    });
    ov.addEventListener('dblclick', function () {
      st.scale = 1; st.tx = 0; st.ty = 0; apply();
    });
    ov.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = ov.getBoundingClientRect();
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      var ns = Math.max(1, Math.min(6, st.scale * factor));
      if (ns === st.scale) return;
      var nx = (mx - st.tx) / st.scale, ny = (my - st.ty) / st.scale;
      st.scale = ns;
      st.tx = mx - nx * ns; st.ty = my - ny * ns;
      apply();
    }, { passive: false });
  }
  function openRoomLightbox(src) {
    var ov = document.getElementById('c-lightbox');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'c-lightbox';
      ov.className = 'c-lightbox';
      var lightboxImage = document.createElement('img');
      lightboxImage.alt = '宿舍室友图大图';
      ov.appendChild(lightboxImage);
      document.body.appendChild(ov);
    }
    initRoomPinch(ov);
    if (ov._roomSt) { ov._roomSt.scale = 1; ov._roomSt.tx = 0; ov._roomSt.ty = 0; }
    var im = ov.querySelector('img');
    im.src = src;
    im.style.transform = '';
    ov.style.display = 'flex';
  }

  function initRoom(root) {
    var img = (root || document).querySelector('.roommate-image');
    if (!img || img.getAttribute('data-room-inited')) return;
    img.setAttribute('data-room-inited', '1');
    img.addEventListener('click', function () { openRoomLightbox(img.getAttribute('src') || img.src); });
  }

  function initCharTab() {
    var tab = document.getElementById('tab-characters');
    if (tab) {
      renderIntro(tab);
      renderDetail(tab);
    }
    initRoom(document);
  }

  /* ---------- 声优库列表 ---------- */
  function renderVoiceList(root) {
    var grid = (root || document).querySelector('#vaGrid');
    var input = (root || document).querySelector('#vaSearch');
    if (!grid || !input || grid.getAttribute('data-va-inited')) return;
    grid.setAttribute('data-va-inited', '1');
    function norm(v) { return String(v || '').toLowerCase(); }
    function data() {
      var generated = window.__uma_app && window.__uma_app.voiceProfiles;
      if (generated && generated.length) {
        return generated.map(function (profile) {
          var identity = profile.identity || {}, photo = profile.photo || {};
          return {
            key: identity.zh || identity.ja || profile.id,
            slug: profile.slug || profile.id,
            zh: identity.zh || identity.ja || '', ja: identity.ja || identity.zh || '',
            photo: photo.url || '',
            roles: (profile.roles || []).map(function (role) { return { id: role.character_id || '', zh: role.name || '', image: role.image || '', main: role.color_main || '#8c83ff' }; })
          };
        });
      }
      return [];
    }
    function render() {
      var q = norm(input.value.trim());
      var list = data().filter(function (v) {
        if (!q) return true;
        if (norm(v.zh).indexOf(q) >= 0 || norm(v.ja).indexOf(q) >= 0) return true;
        for (var i = 0; i < v.roles.length; i++) {
          if (norm(v.roles[i].zh).indexOf(q) >= 0) return true;
        }
        return false;
      });
      grid.innerHTML = '';
      list.forEach(function (v, i) {
        var li = document.createElement('li');
        var card = document.createElement('a');
        card.className = 'va-card';
        card.href = '/zh-Hans/database/voice-actors/' + v.slug;
        card.style.setProperty('--color-main', v.roles[0] && v.roles[0].main ? v.roles[0].main : '#8c83ff');
        var ph = v.photo ? { img: v.photo } : null;
        var roleHtml = v.roles.map(function (role) {
          var roleImage = role.image ? '<img src="' + role.image + '" alt="">' : '<span class="performer-chip-fallback" aria-hidden="true">' + (role.zh || '?').charAt(0) + '</span>';
          return '<span class="performer-chip character-chip" style="--chip-color:' + role.main + '">' + roleImage + '<span>' + role.zh + '</span></span>';
        }).join('');
        var imageAttrs = (i < 2 ? ' loading="eager"' : ' loading="lazy"') + (i === 0 ? ' fetchpriority="high"' : '') + ' decoding="async"';
        var imgHtml = ph
          ? '<img class="va-card-img" src="' + ph.img + '" alt="' + v.zh + '"' + imageAttrs + '>'
          : '<span class="va-ph-fb">' + (v.zh || v.ja || '?').charAt(0) + '</span>';
          card.innerHTML =
          imgHtml +
          '<span class="va-card-txt">' +
            '<p class="va-name">' + v.zh + '</p>' +
            '<p class="va-kana">' + v.ja + '</p>' +
            '<span class="performer-chip-list compact va-card-roles">' + roleHtml + '</span>' +
          '</span>';
        card.addEventListener('click', function (e) {
          e.preventDefault();
          if (window.__uma_app && typeof window.__uma_app.openVa === 'function') window.__uma_app.openVa(v.slug);
        });
        li.appendChild(card);
        grid.appendChild(li);
      });
      var nodata = (root || document).querySelector('#vaNoData');
      if (nodata) nodata.style.display = list.length ? 'none' : 'block';
    }
    input.addEventListener('input', render);
    window.addEventListener('uma-voice-data', render);
    render();
  }

  function initVoiceTab() {
    var tab = document.getElementById('tab-db-voice');
    if (!tab) return;
    renderVoiceList(tab);
  }

  function init() {
    initCharTab();
    initVoiceTab();
  }

  var mo = new MutationObserver(init);
  mo.observe(document.body, { childList: true, subtree: true });
  window.UmaCharacterUi = Object.freeze({ init: init });
  init();
})();
