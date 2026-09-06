# -*- coding: utf-8 -*-
import shutil, os

SRC = r'G:\学习\AI\赛马娘LIVE相关.html'
BAK = r'G:\学习\AI\uma_tools\赛马娘LIVE相关_备份_角色页签注入前.html'
shutil.copyfile(SRC, BAK)
c = open(SRC, encoding='utf-8').read()

NEW_INNER = '''            <div class="c-wrap">
                <nav class="c-subnav">
                    <button class="c-sub active" data-sub="intro" type="button">赛马娘角色介绍</button>
                    <button class="c-sub" data-sub="room" type="button">宿舍室友图</button>
                    <button class="c-sub" data-sub="video" type="button">入坑推荐视频</button>
                    <button class="c-sub" data-sub="blood" type="button">现实马血统关系图</button>
                </nav>

                <div class="c-pane active" id="c-intro">
                    <input class="c-search" id="cIntroSearch" placeholder="搜索：中文名 / 日文名 / CV…" autocomplete="off">
                    <div class="c-count" id="cIntroCount"></div>
                    <div class="c-grid" id="cIntroGrid"></div>
                </div>

                <div class="c-pane" id="c-room">
                    <div class="c-room">
                        <img src="480DD656D6F892646606A962F0A9246C.jpg" alt="宿舍室友图" class="c-room-img">
                        <div class="c-room-hint">点击图片在新窗口查看大图</div>
                    </div>
                </div>

                <div class="c-pane" id="c-video">
                    <div class="c-vlist">
                        <a class="c-vcard" href="https://www.bilibili.com/video/BV1N83n6YEyT/" target="_blank" rel="noopener">
                            <span class="c-vthumb">▶</span>
                            <span class="c-vtitle">世纪末霸王与他的指定产驹龙二</span>
                        </a>
                        <a class="c-vcard" href="https://www.bilibili.com/video/BV1N83n6YEyT/" target="_blank" rel="noopener">
                            <span class="c-vthumb">▶</span>
                            <span class="c-vtitle">世纪末霸王与他的指定产驹龙二</span>
                        </a>
                    </div>
                </div>

                <div class="c-pane" id="c-blood">
                    <div class="c-zoombar">
                        <button type="button" id="cgzin">＋ 放大</button>
                        <button type="button" id="cgzout">－ 缩小</button>
                        <button type="button" id="cgzreset">重置视图</button>
                        <button type="button" id="cgzfit">适应窗口</button>
                        <span class="c-zhint">鼠标滚轮缩放 · 按住拖动平移</span>
                    </div>
                    <div class="c-gwrap">
                        <div class="c-gstage" id="c-global-stage"><img id="c-global-img" src="uma_pedigree_2026.svg" alt="现实马血统关系图"></div>
                    </div>
                </div>
            </div>
'''

STYLE = '''
        <style>
        #tab-characters { padding-bottom: 20px; }
        #tab-characters .c-wrap { max-width: 1280px; margin: 0 auto; }
        #tab-characters .c-subnav { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0 16px; }
        #tab-characters .c-sub {
            border: 1px solid #e6e4ee; background: #fff; color: #2c3650;
            padding: 8px 18px; border-radius: 20px; font-size: 14px; cursor: pointer; font-family: inherit;
        }
        #tab-characters .c-sub:hover { border-color: #ff8c1a; }
        #tab-characters .c-sub.active { background: #20283b; color: #ff8c1a; border-color: #20283b; font-weight: 600; }
        #tab-characters .c-pane { display: none; }
        #tab-characters .c-pane.active { display: block; }
        #tab-characters .c-search {
            width: 320px; max-width: 100%; padding: 9px 14px; border: 1px solid #e6e4ee; border-radius: 8px;
            font-size: 14px; margin-bottom: 10px; outline: none; font-family: inherit;
        }
        #tab-characters .c-search:focus { border-color: #ff8c1a; }
        #tab-characters .c-count { color: #7c7a8a; font-size: 13px; margin-bottom: 12px; }
        #tab-characters .c-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px;
        }
        #tab-characters .c-intro-card {
            background: #fff; border: 1px solid #eee; border-radius: 12px; padding: 14px 10px 12px;
            text-align: center; cursor: pointer; transition: transform .12s, box-shadow .12s;
        }
        #tab-characters .c-intro-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(32,40,59,.18); border-color: #ff8c1a; }
        #tab-characters .c-intro-card img { width: 92px; height: 92px; border-radius: 50%; object-fit: cover; background: #f5f4f9; }
        #tab-characters .c-intro-card .c-zh { font-weight: 700; font-size: 15px; color: #20283b; margin-top: 8px; }
        #tab-characters .c-intro-card .c-jp { font-size: 12px; color: #888; }
        #tab-characters .c-intro-card .c-cv { font-size: 11px; color: #b39aab; margin-top: 2px; }
        #tab-characters .c-room { text-align: center; padding: 8px 0 20px; }
        #tab-characters .c-room img { max-width: 100%; max-height: 78vh; border-radius: 10px; box-shadow: 0 8px 24px rgba(32,40,59,.18); cursor: zoom-in; }
        #tab-characters .c-room-hint { color: #a99cbf; font-size: 12px; margin-top: 10px; }
        #tab-characters .c-vlist { display: flex; gap: 16px; flex-wrap: wrap; }
        #tab-characters .c-vcard {
            display: flex; align-items: center; gap: 14px; width: 440px; max-width: 100%;
            background: #fff; border: 1px solid #eee; border-radius: 12px; padding: 14px 16px;
            text-decoration: none; color: inherit; box-shadow: 0 2px 8px rgba(32,40,59,.12);
            transition: transform .12s, box-shadow .12s;
        }
        #tab-characters .c-vcard:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(32,40,59,.28); border-color: #ff8c1a; }
        #tab-characters .c-vthumb {
            width: 116px; height: 72px; border-radius: 8px; flex-shrink: 0;
            background: linear-gradient(135deg, #20283b, #ff8c1a); color: #fff;
            display: flex; align-items: center; justify-content: center; font-size: 28px;
        }
        #tab-characters .c-vtitle { font-size: 14px; font-weight: 600; color: #2c3650; }
        #tab-characters .c-zoombar {
            display: flex; gap: 6px; padding: 8px 12px; background: #fff; border: 1px solid #e6e4ee;
            border-bottom: none; border-radius: 10px 10px 0 0;
        }
        #tab-characters .c-zoombar button {
            border: 1px solid #e6e4ee; background: #fff; color: #2c3650; padding: 5px 12px;
            border-radius: 6px; font-size: 13px; cursor: pointer; font-family: inherit;
        }
        #tab-characters .c-zoombar button:hover { background: #f5f4f9; }
        #tab-characters .c-zhint { margin-left: auto; color: #a99cbf; font-size: 12px; align-self: center; }
        #tab-characters .c-gwrap {
            height: calc(100vh - 320px); min-height: 420px; overflow: auto; position: relative;
            border: 1px solid #e6e4ee; border-radius: 0 0 10px 10px; background: #fff;
        }
        #tab-characters .c-gstage { transform-origin: 0 0; width: max-content; line-height: 0; }
        #tab-characters .c-gstage img { display: block; max-width: none; }
        </style>
'''

INIT_JS = '''
<script src="intro_data.js"></script>
<script>
(function () {
  var curZoom = null;
  function applyZ() {
    var z = curZoom;
    if (z) z.stage.style.transform = 'translate(' + z.tx + 'px,' + z.ty + 'px) scale(' + z.scale + ')';
  }
  window.addEventListener('mousemove', function (e) {
    var z = curZoom;
    if (!z || !z.dragging) return;
    z.tx = z.ox + (e.clientX - z.sx);
    z.ty = z.oy + (e.clientY - z.sy);
    applyZ();
  });
  window.addEventListener('mouseup', function () { if (curZoom) curZoom.dragging = false; });

  function fitGlobal() {
    var z = curZoom;
    if (!z) return;
    var w = z.stage.parentElement.clientWidth, h = z.stage.parentElement.clientHeight;
    if (w < 50) return;
    var iw = z.img.naturalWidth || 1000, ih = z.img.naturalHeight || 800;
    z.scale = Math.min(w / iw, h / ih); if (z.scale > 1) z.scale = 1;
    z.tx = (w - iw * z.scale) / 2; z.ty = (h - ih * z.scale) / 2;
    applyZ();
  }
  function zoomStep(delta) {
    var z = curZoom;
    if (!z) return;
    var ns = Math.max(0.05, Math.min(4, z.scale * delta));
    z.tx = (z.stage.parentElement.clientWidth / 2) - ((z.stage.parentElement.clientWidth / 2) - z.tx) * (ns / z.scale);
    z.ty = 100 - (100 - z.ty) * (ns / z.scale);
    z.scale = ns;
    applyZ();
  }

  function initZoom(root) {
    var stage = root.querySelector('#c-global-stage');
    var img = root.querySelector('#c-global-img');
    if (!stage || !img) return;
    var z = { scale: 1, tx: 0, ty: 0, dragging: false, stage: stage, img: img };
    curZoom = z;
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      var rect = stage.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      var nx = (px - z.tx) / z.scale, ny = (py - z.ty) / z.scale;
      var ns = Math.max(0.05, Math.min(4, z.scale * delta));
      z.tx = px - nx * ns; z.ty = py - ny * ns; z.scale = ns;
      applyZ();
    }, { passive: false });
    stage.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      z.dragging = true; z.sx = e.clientX; z.sy = e.clientY; z.ox = z.tx; z.oy = z.ty;
      e.preventDefault();
    });
    img.addEventListener('load', fitGlobal);
    var zin = root.querySelector('#cgzin'), zout = root.querySelector('#cgzout'),
        zreset = root.querySelector('#cgzreset'), zfit = root.querySelector('#cgzfit');
    if (zfit) zfit.addEventListener('click', fitGlobal);
    if (zin) zin.addEventListener('click', function () { zoomStep(1.2); });
    if (zout) zout.addEventListener('click', function () { zoomStep(1 / 1.2); });
    if (zreset) zreset.addEventListener('click', function () { z.scale = 1; z.tx = 0; z.ty = 0; applyZ(); });
    applyZ();
  }

  function renderIntro(root) {
    var grid = root.querySelector('#cIntroGrid');
    var count = root.querySelector('#cIntroCount');
    var input = root.querySelector('#cIntroSearch');
    function render() {
      var q = (input.value || '').trim().toLowerCase();
      var list = UMA_INTRO.filter(function (c) {
        if (!q) return true;
        return (c.zh && c.zh.toLowerCase().indexOf(q) >= 0) ||
               (c.name && c.name.toLowerCase().indexOf(q) >= 0) ||
               (c.cv && c.cv.toLowerCase().indexOf(q) >= 0);
      });
      count.textContent = '共 ' + list.length + ' 位角色 · 点击卡片查看官方介绍（萌娘百科）';
      grid.innerHTML = '';
      list.forEach(function (c) {
        var d = document.createElement('div');
        d.className = 'c-intro-card';
        var url = c.page ? c.page.replace('zh.moegirl.org.cn', 'mobile.moegirl.org.cn')
                         : 'https://mobile.moegirl.org.cn/' + encodeURIComponent(c.zh);
        d.dataset.url = url;
        d.innerHTML = '<img src="' + c.av + '"><div class="c-zh">' + c.zh + '</div><div class="c-jp">' + c.name + '</div><div class="c-cv">CV：' + c.cv + '</div>';
        grid.appendChild(d);
      });
    }
    input.addEventListener('input', render);
    render();
  }

  function initCharTab() {
    var tab = document.getElementById('tab-characters');
    if (!tab || tab.getAttribute('data-c-inited')) return;
    tab.setAttribute('data-c-inited', '1');
    renderIntro(tab);
    initZoom(tab);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.c-sub') : null;
    if (b) {
      var root = b.closest('#tab-characters');
      if (!root) return;
      var id = b.getAttribute('data-sub');
      root.querySelectorAll('.c-sub').forEach(function (x) { x.classList.toggle('active', x === b); });
      root.querySelectorAll('.c-pane').forEach(function (p) { p.classList.toggle('active', p.id === 'c-' + id); });
      if (id === 'blood') fitGlobal();
      return;
    }
    var card = e.target.closest ? e.target.closest('.c-intro-card') : null;
    if (card && card.dataset.url) window.open(card.dataset.url, '_blank', 'noopener');
  });

  var mo = new MutationObserver(function () { initCharTab(); });
  mo.observe(document.body, { childList: true, subtree: true });
  initCharTab();
})();
</script>
'''

# ---- apply edits ----
openDiv = c.find('<div id="tab-characters"')
assert openDiv > 0, 'tab-characters not found'
lineEnd = c.find('\n', openDiv)
endPlaceholder = c.rfind('</div>', lineEnd, c.find('<div id="tab-events"', openDiv))
newc = c[:lineEnd + 1] + NEW_INNER + c[endPlaceholder:]

# insert style before tab-characters div
newc = newc.replace('<div id="tab-characters"', STYLE + '<div id="tab-characters"', 1)

# insert data script + init js before </body>
bodyEnd = newc.rfind('</body>')
newc = newc[:bodyEnd] + INIT_JS + newc[bodyEnd:]

open(SRC, 'w', encoding='utf-8').write(newc)
print('written. new len', len(newc))
print('backup at', BAK)
