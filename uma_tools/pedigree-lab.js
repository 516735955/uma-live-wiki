(function () {
  'use strict';

  var state = { sample: 'staygold', expanded: true };
  var byId = {};
  var charById = {};
  var currentModel = null;
  var relationshipView = document.getElementById('relationship-view');
  var inspector = document.getElementById('relation-inspector');
  var sheet = document.getElementById('mobile-sheet');
  var sheetContent = document.getElementById('sheet-content');
  var workspace = document.querySelector('.lab-workspace');
  var workspaceContent = document.getElementById('workspace-content');
  var backLink = document.getElementById('character-back-link');

  var sexLabels = { male: '牡马', female: '牝马', gelding: '阉马' };
  var sexShort = { male: '牡', female: '牝', gelding: '阉' };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cleanName(value) {
    return String(value || '').replace(/'''/g, '').trim();
  }

  function avatarUrl(value) {
    if (!value) return '';
    if (value.charAt(0) === '/' || value.indexOf('data:') === 0) return value;
    return '/' + value;
  }

  function characterRoute(cid) {
    return '/zh-Hans/database/characters/' + encodeURIComponent(cid);
  }

  function sourceLabel(url) {
    if (url.indexOf('netkeiba.com') !== -1) return '查看netkeiba赛马资料';
    if (url.indexOf('jbis.or.jp') !== -1 || url.indexOf('jbis.jp') !== -1) return '查看JBIS赛马资料';
    return '查看赛马资料';
  }

  function getNode(id, rootId) {
    var rootRecord = byId[rootId];
    var lookupId = id;
    if (rootRecord && id === rootRecord.horse_id) lookupId = rootId;
    var record = byId[lookupId] || byId[id] || { cid: id, zh: id };
    var horseRecord = record.horse_id && byId[record.horse_id] ? byId[record.horse_id] : record;
    var cid = charById[lookupId] ? lookupId : record.character_id;
    var character = cid ? charById[cid] : null;
    var role = Boolean(character);
    var horseZh = cleanName(horseRecord.zh || record.real || record.zh || horseRecord.en || record.en || id);
    var name = role ? cleanName(character.zh) : horseZh;
    var profileUrl = horseRecord.profile_url || record.profile_url || horseRecord.parentage_source_url || record.parentage_source_url || '';
    return {
      id: id,
      lookupId: lookupId,
      horseId: horseRecord.cid || record.horse_id || id,
      raw: horseRecord,
      cid: cid || '',
      role: role,
      isCurrent: cid === rootId,
      name: name,
      horseZh: horseZh,
      ja: cleanName(horseRecord.ja || record.ja),
      en: cleanName(horseRecord.en || record.en),
      sex: horseRecord.sex || record.sex || '',
      avatar: avatarUrl((character && character.img) || record.av || horseRecord.av),
      profileUrl: profileUrl,
      sourceLabel: sourceLabel(profileUrl),
      parents: horseRecord.parents || record.parents || {}
    };
  }

  function nameOf(id, rootId) {
    return getNode(id, rootId).name;
  }

  function pedigreeTag(generation, index) {
    var label = '';
    for (var bit = generation - 1; bit >= 0; bit--) label += (index >> bit) & 1 ? '母' : '父';
    return label;
  }

  function siblingLabel(kind) {
    if (kind === 'full') return '同父同母';
    if (kind === 'same_dam') return '同母';
    return '同父';
  }

  function buildModel(rootId) {
    var rootRecord = byId[rootId];
    var relations = rootRecord.character_relations || { siblings: [], descendants: [] };
    var ancestors = [];
    (rootRecord.up || []).forEach(function (row, generationIndex) {
      (row || []).forEach(function (id, index) {
        if (!id) return;
        var item = getNode(id, rootId);
        item.group = 'ancestor';
        item.generation = generationIndex + 1;
        item.index = index;
        item.tag = pedigreeTag(item.generation, index);
        ancestors.push(item);
      });
    });

    var siblings = (relations.siblings || []).map(function (relation) {
      var item = getNode(relation.cid, rootId);
      item.group = 'sibling';
      item.tag = siblingLabel(relation.relation);
      item.sharedParents = relation.shared_parents || [];
      return item;
    });

    var descendants = (relations.descendants || []).map(function (relation) {
      var item = getNode(relation.cid, rootId);
      item.group = 'descendant';
      item.tag = relation.generation === 1 ? '子代' : '孙代';
      item.generation = relation.generation;
      item.path = (relation.path || []).slice();
      item.links = relation.links || [];
      return item;
    });

    var root = getNode(rootId, rootId);
    root.group = 'root';
    root.tag = '当前角色';
    return { root: root, rootRecord: rootRecord, ancestors: ancestors, siblings: siblings, descendants: descendants };
  }

  function factRow(label, value) {
    if (!value) return '';
    return '<div class="horse-fact"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>';
  }

  function detailHtml(item, headingId) {
    var html = '<div class="inspector-heading">';
    if (item.avatar) html += '<img class="inspector-avatar" src="' + escapeHtml(item.avatar) + '" alt="">';
    html += '<div><span class="relation-badge ' + escapeHtml(item.group) + '">' + escapeHtml(item.tag || '赛马资料') + '</span>';
    html += '<h2' + (headingId ? ' id="' + escapeHtml(headingId) + '"' : '') + '>' + escapeHtml(item.name) + '</h2>';
    if (item.role) html += '<p class="role-prototype">现实原型·' + escapeHtml(item.horseZh) + '</p>';
    html += '</div></div>';
    html += '<dl class="horse-names">';
    html += factRow('中文名', item.horseZh);
    html += factRow('日文名', item.ja);
    html += factRow('英文名', item.en);
    html += '</dl>';
    html += '<dl class="horse-facts">';
    html += factRow('性别', sexLabels[item.sex] || '');
    if (item.parents && item.parents.sire) html += factRow('父', nameOf(item.parents.sire, currentModel.root.lookupId));
    if (item.parents && item.parents.dam) html += factRow('母', nameOf(item.parents.dam, currentModel.root.lookupId));
    if (item.sharedParents && item.sharedParents.length) {
      html += factRow('共同亲本', item.sharedParents.map(function (id) { return nameOf(id, currentModel.root.lookupId); }).join('、'));
    }
    if (item.path && item.path.length > 1) {
      html += factRow('血统路径', item.path.map(function (id) { return nameOf(id, currentModel.root.lookupId); }).join('→'));
    }
    html += '</dl>';
    html += '<div class="inspector-actions">';
    if (item.profileUrl) {
      html += '<a class="inspector-link source-link" href="' + escapeHtml(item.profileUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.sourceLabel) + '</a>';
    }
    if (item.role && !item.isCurrent) {
      html += '<a class="inspector-link character-link" href="' + characterRoute(item.cid) + '">前往' + escapeHtml(item.name) + '角色页</a>';
    }
    html += '</div>';
    return html;
  }

  function isMobile() {
    return window.innerWidth <= 820;
  }

  function showDetail(item) {
    inspector.innerHTML = detailHtml(item, 'inspector-title');
    relationshipView.querySelectorAll('.horse-node,.mini-horse').forEach(function (element) {
      element.classList.toggle('is-selected', element.dataset.horseId === item.horseId);
    });
    if (isMobile()) {
      sheetContent.innerHTML = detailHtml(item, 'sheet-title');
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
    }
  }

  function bindHorseButton(button, item) {
    button.dataset.horseId = item.horseId;
    button.addEventListener('click', function () { showDetail(item); });
  }

  function nodeSubtitle(item) {
    if (item.role) return '原型·' + item.horseZh;
    return item.en || item.ja;
  }

  function createHorseNode(item, options) {
    options = options || {};
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'horse-node ' + escapeHtml(item.group || '') + (item.role ? ' is-role' : ' is-horse') + (options.root ? ' is-root' : '');
    if (options.slot) button.dataset.slot = options.slot;
    button.setAttribute('aria-label', item.name + '，' + (item.tag || sexLabels[item.sex] || '赛马'));
    var meta = document.createElement('span');
    meta.className = 'node-meta';
    meta.innerHTML = '<span class="node-relation">' + escapeHtml(item.tag || '') + '</span>' +
      '<span class="sex-badge ' + escapeHtml(item.sex) + '">' + escapeHtml(sexShort[item.sex] || '') + '</span>';
    button.appendChild(meta);
    var main = document.createElement('span');
    main.className = 'node-main';
    if (item.avatar) {
      var avatar = document.createElement('img');
      avatar.className = 'node-avatar';
      avatar.src = item.avatar;
      avatar.alt = '';
      avatar.loading = 'lazy';
      main.appendChild(avatar);
    }
    var copy = document.createElement('span');
    copy.className = 'node-copy';
    copy.innerHTML = '<strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(nodeSubtitle(item)) + '</small>';
    main.appendChild(copy);
    button.appendChild(main);
    bindHorseButton(button, item);
    return button;
  }

  function sectionHeader(title, note) {
    var header = document.createElement('header');
    header.className = 'relation-section-head';
    header.innerHTML = '<h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(note) + '</p>';
    return header;
  }

  function ancestorRows(model) {
    var section = document.createElement('section');
    section.className = 'relation-section ancestry-section';
    section.appendChild(sectionHeader('三代血统', '每个节点使用父、母、母父等血统位置。'));
    var canvas = document.createElement('div');
    canvas.className = 'ancestry-canvas';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ancestry-lines');
    svg.setAttribute('aria-hidden', 'true');
    canvas.appendChild(svg);
    var rootRow = document.createElement('div');
    rootRow.className = 'ancestor-row root-row';
    rootRow.appendChild(createHorseNode(model.root, { root: true, slot: 'root' }));
    canvas.appendChild(rootRow);
    [1, 2, 3].forEach(function (generation) {
      var row = document.createElement('div');
      row.className = 'ancestor-row generation-' + generation;
      row.dataset.generation = generation;
      model.ancestors.filter(function (item) { return item.generation === generation; }).forEach(function (item) {
        row.appendChild(createHorseNode(item, { slot: generation + '-' + item.index }));
      });
      canvas.appendChild(row);
    });
    section.appendChild(canvas);
    return section;
  }

  function drawAncestryLines() {
    var canvas = relationshipView.querySelector('.ancestry-canvas');
    var svg = relationshipView.querySelector('.ancestry-lines');
    if (!canvas || !svg) return;
    svg.innerHTML = '';
    if (window.innerWidth <= 760) return;
    var canvasRect = canvas.getBoundingClientRect();
    svg.setAttribute('width', canvas.clientWidth);
    svg.setAttribute('height', canvas.clientHeight);
    svg.setAttribute('viewBox', '0 0 ' + canvas.clientWidth + ' ' + canvas.clientHeight);

    function point(slot, bottom) {
      var node = canvas.querySelector('[data-slot="' + slot + '"]');
      if (!node) return null;
      var rect = node.getBoundingClientRect();
      return { x: rect.left - canvasRect.left + rect.width / 2, y: rect.top - canvasRect.top + (bottom ? rect.height : 0) };
    }

    [1, 2, 3].forEach(function (generation) {
      var count = Math.pow(2, generation);
      for (var index = 0; index < count; index++) {
        var fromSlot = generation === 1 ? 'root' : (generation - 1) + '-' + Math.floor(index / 2);
        var from = point(fromSlot, true);
        var to = point(generation + '-' + index, false);
        if (!from || !to) continue;
        var middle = (from.y + to.y) / 2;
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M' + from.x + ',' + from.y + ' C' + from.x + ',' + middle + ' ' + to.x + ',' + middle + ' ' + to.x + ',' + to.y);
        svg.appendChild(path);
      }
    });
  }

  function siblingsSection(model) {
    if (!model.siblings.length) return null;
    var section = document.createElement('section');
    section.className = 'relation-section siblings-section';
    section.appendChild(sectionHeader('同辈角色', '只展示已有角色页的同父、同母和同父同母马。'));
    var grid = document.createElement('div');
    grid.className = 'sibling-grid';
    model.siblings.forEach(function (item) { grid.appendChild(createHorseNode(item)); });
    section.appendChild(grid);
    return section;
  }

  function miniHorse(item, roleLabel) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-horse' + (item.role ? ' is-role' : '');
    button.innerHTML = '<span class="parent-role">' + escapeHtml(roleLabel) + '</span>' +
      '<strong>' + escapeHtml(item.name) + '</strong>' +
      '<span class="sex-badge ' + escapeHtml(item.sex) + '">' + escapeHtml(sexShort[item.sex] || '') + '</span>';
    button.setAttribute('aria-label', roleLabel + '，' + item.name + '，' + (sexLabels[item.sex] || '赛马'));
    bindHorseButton(button, item);
    return button;
  }

  function parentPair(link, rootId) {
    var row = document.createElement('div');
    row.className = 'parent-pair';
    var parent = getNode(link.parent, rootId);
    var partner = getNode(link.partner, rootId);
    var parentRole = link.role === 'dam' ? '母' : '父';
    var partnerRole = link.role === 'dam' ? '父' : '母';
    parent.tag = parentRole;
    partner.tag = partnerRole;
    row.appendChild(miniHorse(parent, parentRole));
    var plus = document.createElement('span');
    plus.className = 'parent-plus';
    plus.textContent = '＋';
    row.appendChild(plus);
    row.appendChild(miniHorse(partner, partnerRole));
    return row;
  }

  function generationArrow() {
    var arrow = document.createElement('div');
    arrow.className = 'generation-arrow';
    arrow.innerHTML = '<svg viewBox="0 0 24 28" aria-hidden="true"><path d="M12 2v20M7 17l5 5 5-5"/></svg>';
    return arrow;
  }

  function descendantBranches(model) {
    var groups = [];
    var byFirst = {};
    model.descendants.forEach(function (relation) {
      var firstId = relation.path[1];
      if (!firstId) return;
      if (!byFirst[firstId]) {
        var first = getNode(firstId, model.root.lookupId);
        first.group = 'descendant';
        first.tag = first.role ? '子代' : '中间代';
        first.path = [model.root.lookupId, firstId];
        byFirst[firstId] = { first: first, firstLink: relation.links[0], terminals: [] };
        groups.push(byFirst[firstId]);
      }
      if (relation.path.length > 2) {
        var terminal = getNode(relation.path[relation.path.length - 1], model.root.lookupId);
        terminal.group = 'descendant';
        terminal.tag = '孙代';
        terminal.path = relation.path.slice();
        byFirst[firstId].terminals.push({ item: terminal, link: relation.links[relation.links.length - 1] });
      }
    });
    return groups;
  }

  function descendantSection(model) {
    var groups = descendantBranches(model);
    if (!groups.length) return null;
    var section = document.createElement('section');
    section.className = 'relation-section descendants-section';
    section.appendChild(sectionHeader('两代内角色后代', '父母以血统角色标注；连接角色所需的中间代完整保留。'));
    var grid = document.createElement('div');
    grid.className = 'descendant-grid';
    groups.forEach(function (group) {
      var branch = document.createElement('article');
      branch.className = 'descendant-branch';
      if (group.firstLink && group.firstLink.partner) branch.appendChild(parentPair(group.firstLink, model.root.lookupId));
      branch.appendChild(generationArrow());
      var firstWrap = document.createElement('div');
      firstWrap.className = 'branch-child';
      firstWrap.appendChild(createHorseNode(group.first));
      branch.appendChild(firstWrap);
      group.terminals.forEach(function (terminal) {
        var continuation = document.createElement('div');
        continuation.className = 'terminal-path';
        if (terminal.link && terminal.link.partner) continuation.appendChild(parentPair(terminal.link, model.root.lookupId));
        continuation.appendChild(generationArrow());
        var terminalWrap = document.createElement('div');
        terminalWrap.className = 'branch-child';
        terminalWrap.appendChild(createHorseNode(terminal.item));
        continuation.appendChild(terminalWrap);
        branch.appendChild(continuation);
      });
      grid.appendChild(branch);
    });
    section.appendChild(grid);
    return section;
  }

  function render() {
    currentModel = buildModel(state.sample);
    relationshipView.innerHTML = '';
    document.getElementById('workspace-title').textContent = currentModel.root.name + '的血统关系';
    document.getElementById('workspace-summary').textContent =
      '三代血统·' + currentModel.siblings.length + '位同辈角色·' +
      currentModel.descendants.length + '条两代内角色后代路径';
    backLink.href = characterRoute(state.sample);
    backLink.setAttribute('aria-label', '返回' + currentModel.root.name + '角色页');
    relationshipView.appendChild(ancestorRows(currentModel));
    var siblings = siblingsSection(currentModel);
    if (siblings) relationshipView.appendChild(siblings);
    var descendants = descendantSection(currentModel);
    if (descendants) relationshipView.appendChild(descendants);
    inspector.innerHTML = detailHtml(currentModel.root, 'inspector-title');
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    window.requestAnimationFrame(drawAncestryLines);
  }

  function toggleWorkspace() {
    state.expanded = !state.expanded;
    workspace.classList.toggle('is-expanded', state.expanded);
    workspaceContent.hidden = !state.expanded;
    var button = document.querySelector('[data-action="toggle"]');
    button.setAttribute('aria-expanded', String(state.expanded));
    button.querySelector('span').textContent = state.expanded ? '收起血统' : '展开血统';
    if (state.expanded) window.requestAnimationFrame(drawAncestryLines);
  }

  function initializeData() {
    (window.PED_REL || []).forEach(function (node) { byId[node.cid] = node; });
    (window.CHAR_INDEX || []).forEach(function (character) { charById[character.id] = character; });
    if (!byId[state.sample]) {
      document.getElementById('workspace-summary').textContent = '血统关系数据载入失败，请刷新页面。';
      return;
    }
    render();
  }

  document.querySelectorAll('[data-sample]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.sample = button.dataset.sample;
      document.querySelectorAll('[data-sample]').forEach(function (item) { item.classList.toggle('is-active', item === button); });
      render();
    });
  });
  document.querySelector('[data-action="toggle"]').addEventListener('click', toggleWorkspace);
  sheet.querySelectorAll('[data-sheet-close]').forEach(function (button) {
    button.addEventListener('click', function () {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
    });
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      sheet.classList.remove('is-open');
      sheet.setAttribute('aria-hidden', 'true');
    }
  });
  window.addEventListener('resize', function () {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(drawAncestryLines, 100);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeData);
  else initializeData();
}());
