(function () {
  'use strict';

  var query = new URLSearchParams(window.location.search);
  var requestedSample = query.get('sample');
  var embedded = query.has('embed');
  var state = {
    sample: requestedSample || 'staygold',
    expanded: true,
    lockedItem: null,
    lockedKey: '',
    resizeTimer: null
  };
  var byId = {};
  var charById = {};
  var viewport = document.getElementById('graph-viewport');
  var stage = document.getElementById('graph-stage');
  var inspector = document.getElementById('relation-inspector');
  var sheet = document.getElementById('mobile-sheet');
  var sheetContent = document.getElementById('sheet-content');
  var workspace = document.querySelector('.lab-workspace');
  var workspaceContent = document.getElementById('workspace-content');
  var backLink = document.getElementById('character-back-link');
  var currentModel = null;
  var sexLabels = { male: '牡马', female: '牝马', gelding: '阉马' };
  var sexShort = { male: '牡', female: '牝', gelding: '阉' };
  var countryLabels = {
    JPN: '日本', USA: '美国', GB: '英国', CAN: '加拿大', IRE: '爱尔兰',
    FR: '法国', ITY: '意大利', ARG: '阿根廷', AUS: '澳大利亚',
    NZ: '新西兰', GER: '德国', BRZ: '巴西', CHI: '智利',
    SAF: '南非', UAE: '阿联酋', SYR: '叙利亚', SUI: '瑞士', URU: '乌拉圭'
  };
  var relationRank = { full: 0, same_dam: 1, same_sire: 2 };

  if (embedded) document.documentElement.classList.add('is-embedded');

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
    if (url.indexOf('jbis.or.jp') !== -1 || url.indexOf('jbis.jp') !== -1) return '查看JBIS资料';
    if (url.indexOf('netkeiba.com') !== -1) return '查看netkeiba资料';
    return '查看赛马资料来源';
  }

  function getNode(id, rootId) {
    var rootNode = byId[rootId];
    var lookupId = rootNode && id === rootNode.horse_id ? rootId : id;
    var node = byId[lookupId] || byId[id] || { cid: id, zh: id };
    var horseNode = node.horse_id && byId[node.horse_id] ? byId[node.horse_id] : node;
    var cid = charById[lookupId] ? lookupId : node.character_id;
    var character = cid ? charById[cid] : null;
    var role = Boolean(character);
    var horseZh = cleanName(horseNode.real_zh || horseNode.zh || node.real_zh || node.zh ||
      horseNode.en || node.en || id);
    var sourceUrl = horseNode.metadata_source_url || node.metadata_source_url ||
      horseNode.profile_url || node.profile_url || node.parentage_source_url || '';
    return {
      id: id,
      lookupId: lookupId,
      raw: node,
      cid: cid || '',
      role: role,
      isCurrent: cid === rootId,
      name: role ? cleanName(character.zh) : horseZh,
      horseId: horseNode.cid || node.horse_id || id,
      horseZh: horseZh,
      ja: cleanName(horseNode.real || horseNode.ja || node.real || node.ja),
      en: cleanName(horseNode.real_en || horseNode.en || node.real_en || node.en),
      sex: horseNode.sex || node.sex || '',
      born: horseNode.born || node.born || '',
      country: horseNode.country || node.country || '',
      avatar: avatarUrl((character && character.img) || node.av || horseNode.av),
      sourceUrl: sourceUrl,
      sourceName: sourceLabel(sourceUrl),
      parents: horseNode.parents || node.parents || {}
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

  function compareBornName(a, b) {
    var aBorn = Number(a.born) || 9999;
    var bBorn = Number(b.born) || 9999;
    if (aBorn !== bBorn) return aBorn - bBorn;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  }

  function buildModel(rootId) {
    var rootNode = byId[rootId];
    var relations = rootNode.character_relations || { siblings: [], descendants: [] };
    var ancestors = [];
    (rootNode.up || []).forEach(function (row, generation) {
      (row || []).forEach(function (id, index) {
        if (!id) return;
        var item = getNode(id, rootId);
        item.group = 'ancestor';
        item.tag = pedigreeTag(generation + 1, index);
        item.generation = generation + 1;
        item.index = index;
        item.focusId = 'ancestor:' + item.generation + ':' + index;
        ancestors.push(item);
      });
    });
    ancestors.forEach(function (item) {
      var path = [rootId];
      for (var level = 0; level < item.generation; level++) {
        var divisor = Math.pow(2, item.generation - level - 1);
        var ancestorId = (rootNode.up[level] || [])[Math.floor(item.index / divisor)];
        if (ancestorId && path.indexOf(ancestorId) === -1) path.push(ancestorId);
      }
      item.path = path;
      item.pathFocusIds = [rootId];
      for (var pathLevel = 1; pathLevel <= item.generation; pathLevel++) {
        var pathIndex = Math.floor(item.index / Math.pow(2, item.generation - pathLevel));
        item.pathFocusIds.push('ancestor:' + pathLevel + ':' + pathIndex);
      }
    });

    var siblings = (relations.siblings || []).map(function (relation) {
      var item = getNode(relation.cid, rootId);
      item.group = 'sibling';
      item.tag = siblingLabel(relation.relation);
      item.relationKind = relation.relation;
      item.sharedParents = relation.shared_parents || [];
      item.pathFocusIds = [rootId, item.id].concat(ancestors.filter(function (ancestor) {
        return item.sharedParents.indexOf(ancestor.id) !== -1;
      }).map(function (ancestor) { return ancestor.focusId; }));
      return item;
    }).sort(function (a, b) {
      var relationDifference = relationRank[a.relationKind] - relationRank[b.relationKind];
      return relationDifference || compareBornName(a, b);
    });

    var descendants = (relations.descendants || []).map(function (relation) {
      var item = getNode(relation.cid, rootId);
      item.group = 'descendant';
      item.tag = relation.generation === 1 ? '子代' : '孙代';
      item.generation = relation.generation;
      item.path = (relation.path || []).slice();
      item.links = relation.links || [];
      item.pathPartners = item.links.map(function (link) { return link.partner; }).filter(Boolean);
      return item;
    }).sort(function (a, b) {
      return a.generation - b.generation || compareBornName(a, b);
    });

    var breeding = (rootNode.breeding_partners || []).map(function (relation) {
      var item = getNode(relation.horse_id, rootId);
      item.group = 'breeding';
      item.tag = '繁育关联';
      item.years = relation.years || [];
      item.sourceUrl = relation.source_url || item.sourceUrl;
      item.sourceName = sourceLabel(item.sourceUrl);
      item.path = [rootId, item.id];
      return item;
    }).sort(function (a, b) {
      var aYear = a.years[0] || 9999;
      var bYear = b.years[0] || 9999;
      return aYear - bYear || compareBornName(a, b);
    });

    var root = getNode(rootId, rootId);
    root.group = 'root';
    root.tag = '当前角色';
    return {
      root: root,
      rootNode: rootNode,
      ancestors: ancestors,
      siblings: siblings,
      descendants: descendants,
      breeding: breeding
    };
  }

  function factRow(label, value) {
    if (!value) return '';
    return '<div class="horse-fact"><dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd></div>';
  }

  function detailHtml(item, headingId, locked) {
    var groupNames = {
      root: '当前角色', ancestor: '先代血统', sibling: '同辈角色',
      descendant: '后代角色', partner: '另一方亲本', breeding: '繁育关联'
    };
    var detailClass = item.role ? 'is-role-detail' : 'is-horse-detail';
    var html = '<div class="inspector-card ' + detailClass + '">';
    html += '<div class="inspector-heading">';
    if (item.role && item.avatar) html += '<img class="inspector-avatar" src="' + escapeHtml(item.avatar) + '" alt="">';
    html += '<div class="inspector-identity"><span class="inspector-type ' + escapeHtml(item.group) + '">' +
      escapeHtml(item.tag || groupNames[item.group] || '赛马资料') + '</span>';
    html += '<h2' + (headingId ? ' id="' + escapeHtml(headingId) + '"' : '') + '>' + escapeHtml(item.name) + '</h2>';
    if (item.sex) html += '<span class="detail-sex ' + escapeHtml(item.sex) + '">' + escapeHtml(sexLabels[item.sex]) + '</span>';
    html += '</div></div>';
    html += '<dl class="horse-names">';
    html += factRow('中文名', item.horseZh);
    html += factRow('日文名', item.ja);
    html += factRow('英文名', item.en);
    html += '</dl>';
    html += '<dl class="horse-facts">';
    html += factRow('出生年份', item.born ? item.born + '年' : '');
    html += factRow('产地', countryLabels[item.country] || item.country);
    if (item.parents && item.parents.sire) html += factRow('父', nameOf(item.parents.sire, currentModel.root.lookupId));
    if (item.parents && item.parents.dam) html += factRow('母', nameOf(item.parents.dam, currentModel.root.lookupId));
    if (item.sharedParents && item.sharedParents.length) {
      html += factRow('共同亲本', item.sharedParents.map(function (id) {
        return nameOf(id, currentModel.root.lookupId);
      }).join('、'));
    }
    if (item.via && item.via.length) {
      html += factRow('关联子代', item.via.map(function (id) {
        return nameOf(id, currentModel.root.lookupId);
      }).join('、'));
    }
    if (item.years && item.years.length) html += factRow('记录年份', item.years.join('、') + '年');
    html += '</dl>';
    html += '<div class="inspector-actions">';
    if (locked) {
      html += '<button class="inspector-unpin" type="button" data-unpin>取消固定</button>';
    }
    if (item.sourceUrl) {
      html += '<a class="inspector-link source-link" href="' + escapeHtml(item.sourceUrl) +
        '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.sourceName) + '</a>';
    }
    if (item.role && !item.isCurrent) {
      html += '<a class="inspector-link character-link" href="' + characterRoute(item.cid) + '"' +
        (embedded ? ' target="_top"' : '') + '>前往' +
        escapeHtml(item.name) + '角色页</a>';
    }
    html += '</div></div>';
    return html;
  }

  function renderDetail(item, mobile) {
    if (!item) return;
    var locked = Boolean(state.lockedItem && state.lockedKey === item.selectionKey);
    inspector.innerHTML = detailHtml(item, 'inspector-title', locked);
    var unpin = inspector.querySelector('[data-unpin]');
    if (unpin) unpin.addEventListener('click', clearPin);
    if (mobile) {
      sheetContent.innerHTML = detailHtml(item, 'sheet-title', false);
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
    }
  }

  function syncPinnedSelection() {
    stage.querySelectorAll('[data-selection-key]').forEach(function (element) {
      element.classList.toggle('is-selected', Boolean(state.lockedItem) &&
        element.dataset.selectionKey === state.lockedKey);
    });
  }

  function pinDetail(item, mobile, selectionKey) {
    if (state.lockedItem && state.lockedKey === selectionKey) {
      clearPin();
      return;
    }
    item.selectionKey = selectionKey;
    state.lockedItem = item;
    state.lockedKey = selectionKey;
    renderDetail(item, mobile);
    syncPinnedSelection();
  }

  function closeSheet() {
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function clearPin() {
    state.lockedItem = null;
    state.lockedKey = '';
    closeSheet();
    syncPinnedSelection();
    clearHoverPath();
  }

  function previewDetail(item) {
    if (!state.lockedItem) renderDetail(item, false);
  }

  function restoreDetail() {
    if (!currentModel) return;
    renderDetail(state.lockedItem || currentModel.root, false);
  }

  function isCoarsePointer() {
    return window.matchMedia('(hover: none), (pointer: coarse)').matches || window.innerWidth <= 760;
  }

  function highlightIds(item) {
    var ids = [currentModel.root.id, item.id];
    (item.path || []).concat(item.sharedParents || []).concat(item.pathPartners || []).concat(item.via || []).forEach(function (id) {
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }

  function setHoverPath(item) {
    var ids = highlightIds(item);
    var visualIds = item.pathFocusIds || ids;
    var focusId = item.focusId || item.id;
    stage.classList.add('has-hover-path');
    stage.querySelectorAll('[data-node-id]').forEach(function (element) {
      element.classList.toggle('is-path-node', visualIds.indexOf(element.dataset.focusId) !== -1);
    });
    stage.querySelectorAll('.relation-focus-edge').forEach(function (edge) {
      var triggerIds = (edge.dataset.focusIds || '').split('|').filter(Boolean);
      edge.classList.toggle('is-path-edge', triggerIds.indexOf(focusId) !== -1);
    });
  }

  function clearHoverPath() {
    stage.classList.remove('has-hover-path');
    stage.querySelectorAll('.is-path-node,.is-path-edge').forEach(function (element) {
      element.classList.remove('is-path-node', 'is-path-edge');
    });
    restoreDetail();
  }

  function bindInteractive(element, item) {
    var selectionKey = item.selectionKey || item.focusId || (item.group + ':' + item.id);
    element.dataset.selectionKey = selectionKey;
    element.addEventListener('mouseenter', function () { previewDetail(item); setHoverPath(item); });
    element.addEventListener('mouseleave', clearHoverPath);
    element.addEventListener('focus', function () { previewDetail(item); setHoverPath(item); });
    element.addEventListener('blur', clearHoverPath);
    element.addEventListener('click', function (event) {
      event.preventDefault();
      pinDetail(item, isCoarsePointer(), selectionKey);
    });
  }

  function createNode(item, x, y, options) {
    options = options || {};
    var element = document.createElement('button');
    var isRoot = Boolean(options.root);
    var isAncestor = item.group === 'ancestor';
    var width = isRoot ? 182 : (isAncestor ? (item.role ? 142 : 124) : (item.role ? 152 : 128));
    var height = isRoot ? 70 : (item.role ? 60 : 44);
    element.className = 'ped-node' + (isRoot ? ' is-root' : '') +
      (isAncestor ? ' is-ancestor-node' : '') + (item.role ? ' is-role' : ' is-horse');
    element.dataset.group = item.group;
    element.dataset.nodeId = item.id;
    element.dataset.focusId = item.focusId || item.id;
    element.dataset.horseId = item.horseId;
    element.setAttribute('aria-label', item.name + (item.tag ? '，' + item.tag : ''));
    element.style.left = Math.round(x - width / 2) + 'px';
    element.style.top = Math.round(y - height / 2) + 'px';
    element.type = 'button';
    if (item.tag && !options.hideTag) {
      var tag = document.createElement('span');
      tag.className = 'ped-tag ' + item.group;
      tag.textContent = item.tag;
      element.appendChild(tag);
    }
    if (item.sex) {
      var sex = document.createElement('span');
      sex.className = 'ped-sex ' + item.sex;
      sex.textContent = sexShort[item.sex];
      sex.setAttribute('aria-label', sexLabels[item.sex]);
      element.appendChild(sex);
    }
    if (item.role) {
      var image = document.createElement('img');
      image.className = 'ped-avatar';
      image.src = item.avatar;
      image.alt = '';
      image.loading = 'lazy';
      element.appendChild(image);
    }
    var copy = document.createElement('span');
    copy.className = 'ped-copy';
    copy.innerHTML = '<span class="ped-name">' + escapeHtml(item.name) + '</span>';
    element.appendChild(copy);
    bindInteractive(element, item);
    stage.appendChild(element);
    return { x: x, y: y, width: width, height: height, element: element, item: item };
  }

  function createGroupLabel(title, count, x, y, width) {
    var label = document.createElement('div');
    label.className = 'relation-group-label';
    label.style.left = x + 'px';
    label.style.top = y + 'px';
    if (width) label.style.width = width + 'px';
    label.innerHTML = '<strong>' + escapeHtml(title) + '</strong><span>' + count + '位</span>';
    stage.appendChild(label);
  }

  function createSvg(width, height) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    stage.appendChild(svg);
    return svg;
  }

  function addEdge(svg, from, to, group, options) {
    if (!from || !to) return;
    options = options || {};
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    var sx = from.x + (options.fromDx || 0);
    var sy = from.y + (options.fromDy == null ? from.height / 2 : options.fromDy);
    var tx = to.x + (options.toDx || 0);
    var ty = to.y + (options.toDy == null ? -to.height / 2 : options.toDy);
    var d;
    if (options.horizontal) {
      var mx = (sx + tx) / 2;
      d = 'M' + sx + ',' + sy + ' C' + mx + ',' + sy + ' ' + mx + ',' + ty + ' ' + tx + ',' + ty;
    } else {
      var my = (sy + ty) / 2;
      d = 'M' + sx + ',' + sy + ' C' + sx + ',' + my + ' ' + tx + ',' + my + ' ' + tx + ',' + ty;
    }
    path.setAttribute('d', d);
    path.setAttribute('class', 'relation-edge ' + group);
    path.dataset.relationIds = (options.relationIds || [from.item && from.item.id, to.item && to.item.id])
      .filter(Boolean).join('|');
    svg.appendChild(path);
    return path;
  }

  function addPath(svg, d, group, relationIds) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'relation-edge ' + group);
    path.dataset.relationIds = (relationIds || []).filter(Boolean).join('|');
    svg.appendChild(path);
  }

  function roundedOrthogonalPath(points, radius) {
    if (!points || points.length < 2) return '';
    points = points.filter(function (point, index) {
      return index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y;
    });
    if (points.length < 2) return '';
    var d = 'M' + points[0].x + ',' + points[0].y;
    for (var index = 1; index < points.length - 1; index++) {
      var previous = points[index - 1];
      var corner = points[index];
      var next = points[index + 1];
      var incoming = Math.abs(corner.x - previous.x) + Math.abs(corner.y - previous.y);
      var outgoing = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y);
      var turnRadius = Math.min(radius || 12, incoming / 2, outgoing / 2);
      var before = {
        x: corner.x + (previous.x === corner.x ? 0 : (previous.x < corner.x ? -turnRadius : turnRadius)),
        y: corner.y + (previous.y === corner.y ? 0 : (previous.y < corner.y ? -turnRadius : turnRadius))
      };
      var after = {
        x: corner.x + (next.x === corner.x ? 0 : (next.x < corner.x ? -turnRadius : turnRadius)),
        y: corner.y + (next.y === corner.y ? 0 : (next.y < corner.y ? -turnRadius : turnRadius))
      };
      d += ' L' + before.x + ',' + before.y + ' Q' + corner.x + ',' + corner.y + ' ' + after.x + ',' + after.y;
    }
    var last = points[points.length - 1];
    return d + ' L' + last.x + ',' + last.y;
  }

  function addRoundedPath(svg, points, group, relationIds, radius) {
    addPath(svg, roundedOrthogonalPath(points, radius), group, relationIds);
  }

  function addFocusPath(svg, points, group, focusIds, radius) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', roundedOrthogonalPath(points, radius || 14));
    path.setAttribute('class', 'relation-focus-edge ' + group);
    path.dataset.focusIds = (focusIds || []).filter(Boolean).join('|');
    svg.appendChild(path);
  }

  function addFocusCurve(svg, from, to, group, focusIds, options) {
    options = options || {};
    var base = addEdge(svg, from, to, group + ' relation-focus-edge', options);
    base.dataset.focusIds = (focusIds || []).filter(Boolean).join('|');
  }

  function addPartnerChip(item, x, y) {
    var chip = document.createElement('button');
    var parentRole = item.parentRole || '';
    chip.className = 'partner-chip' + (parentRole ? ' is-' + parentRole : '');
    chip.dataset.group = item.group;
    chip.dataset.nodeId = item.id;
    chip.dataset.focusId = item.focusId || item.id;
    chip.dataset.horseId = item.horseId;
    chip.style.left = (x - 76) + 'px';
    chip.style.top = y + 'px';
    chip.type = 'button';
    chip.innerHTML = '<span class="partner-role">' + escapeHtml(item.tag) + '</span><strong>' +
      escapeHtml(item.name) + '</strong>';
    chip.setAttribute('aria-label', item.tag + '，' + item.name + '，' + (sexLabels[item.sex] || '赛马'));
    bindInteractive(chip, item);
    stage.appendChild(chip);
    return { x: x, y: y + 15, width: 152, height: 30, element: chip, item: item };
  }

  function spread(count, center, spacing) {
    var result = [];
    for (var i = 0; i < count; i++) result.push(center + (i - (count - 1) / 2) * spacing);
    return result;
  }

  function descendantStructure(model) {
    var firstMap = {};
    model.descendants.forEach(function (descendant) {
      var path = descendant.path || [];
      var firstId = path[1] || descendant.id;
      if (!firstMap[firstId]) {
        var firstItem = path.length === 2 ? descendant : getNode(firstId, model.root.lookupId);
        firstItem.group = 'descendant';
        firstItem.tag = '子代';
        firstItem.path = path.length === 2 ? path.slice() : [model.root.id, firstId];
        firstMap[firstId] = { id: firstId, item: firstItem, terminals: [], partner: null };
      }
      if (path.length > 2) firstMap[firstId].terminals.push(descendant);
      var firstLink = descendant.links && descendant.links[0];
      if (firstLink && firstLink.partner && !firstMap[firstId].partner) {
        var partner = getNode(firstLink.partner, model.root.lookupId);
        partner.group = 'partner';
        partner.parentRole = firstLink.role === 'dam' ? 'sire' : 'dam';
        partner.tag = partner.parentRole === 'sire' ? '父' : '母';
        partner.via = [firstId];
        partner.path = [model.root.id, firstId];
        firstMap[firstId].partner = partner;
      }
    });
    var first = Object.keys(firstMap).map(function (id) { return firstMap[id]; });
    first.sort(function (a, b) { return compareBornName(a.item, b.item); });
    first.forEach(function (entry) { entry.terminals.sort(compareBornName); });
    return { first: first };
  }

  function descendantGroups(structure, rootId) {
    var groups = [];
    var byPartner = {};
    structure.first.forEach(function (entry) {
      var key = entry.partner ? entry.partner.id : '__' + entry.id;
      if (!byPartner[key]) {
        byPartner[key] = { partner: entry.partner, entries: [] };
        groups.push(byPartner[key]);
      }
      byPartner[key].entries.push(entry);
    });
    groups.sort(function (a, b) {
      return compareBornName(a.entries[0].item, b.entries[0].item);
    });
    groups.forEach(function (group) {
      group.entries.sort(function (a, b) { return compareBornName(a.item, b.item); });
      var ids = [rootId];
      if (group.partner) ids.push(group.partner.id);
      group.entries.forEach(function (entry) {
        ids.push(entry.item.id);
        entry.terminals.forEach(function (terminal) { ids.push(terminal.id); });
      });
      group.ids = ids;
      if (group.partner) {
        group.partner.via = group.entries.map(function (entry) { return entry.id; });
      }
      group.entries.forEach(function (entry) {
        var partnerId = group.partner && group.partner.id;
        entry.item.pathPartners = (entry.item.pathPartners || []).concat(partnerId || []).filter(Boolean);
        entry.terminals.forEach(function (terminal) {
          terminal.pathPartners = (terminal.pathPartners || []).concat(partnerId || []).filter(Boolean);
        });
      });
    });
    return groups;
  }

  function descendantRows(groups, columns) {
    var rows = [];
    for (var index = 0; index < groups.length; index += columns) {
      var rowGroups = groups.slice(index, index + columns);
      var hasGrandchildren = rowGroups.some(function (group) {
        return group.entries.some(function (entry) { return entry.terminals.length > 0; });
      });
      rows.push({ groups: rowGroups, height: hasGrandchildren ? 306 : 200 });
    }
    return rows;
  }

  function descendantSpinePosition(rows, areaLeft, laneWidth, columns, rootX) {
    var occupied = [];
    rows.forEach(function (row) {
      var rowStart = areaLeft + (columns - row.groups.length) * laneWidth / 2;
      row.groups.forEach(function (group, groupIndex) {
        var groupX = rowStart + laneWidth * (groupIndex + .5);
        occupied.push([groupX - 82, groupX + 82]);
        spread(group.entries.length, groupX, 164).forEach(function (childX, entryIndex) {
          occupied.push([childX - 82, childX + 82]);
          spread(group.entries[entryIndex].terminals.length, childX, 158).forEach(function (terminalX) {
            occupied.push([terminalX - 82, terminalX + 82]);
          });
        });
      });
    });
    var left = 380;
    var right = rootX - 28;
    var ranges = occupied.map(function (range) {
      return [Math.max(left, range[0]), Math.min(right, range[1])];
    }).filter(function (range) { return range[0] < range[1]; }).sort(function (a, b) {
      return a[0] - b[0];
    });
    var merged = [];
    ranges.forEach(function (range) {
      var last = merged[merged.length - 1];
      if (!last || range[0] > last[1]) merged.push(range.slice());
      else last[1] = Math.max(last[1], range[1]);
    });
    var gaps = [];
    var cursor = left;
    merged.forEach(function (range) {
      if (range[0] > cursor) gaps.push([cursor, range[0]]);
      cursor = Math.max(cursor, range[1]);
    });
    if (cursor < right) gaps.push([cursor, right]);
    if (!gaps.length) return left - 24;
    gaps.sort(function (a, b) {
      var widthDifference = (b[1] - b[0]) - (a[1] - a[0]);
      if (widthDifference) return widthDifference;
      return Math.abs(rootX - b[1]) - Math.abs(rootX - a[1]);
    });
    return (gaps[0][0] + gaps[0][1]) / 2;
  }

  function renderLens(model) {
    var structure = descendantStructure(model);
    var descendantFamilies = descendantGroups(structure, model.root.id);
    var siblingGroups = [];
    var siblingMap = {};
    model.siblings.forEach(function (item) {
      var key = item.relationKind + ':' + (item.sharedParents || []).join(',');
      if (!siblingMap[key]) {
        siblingMap[key] = {
          items: [],
          title: item.tag + '·' + item.sharedParents.map(function (id) {
            return nameOf(id, model.root.lookupId);
          }).join('、')
        };
        siblingGroups.push(siblingMap[key]);
      }
      siblingMap[key].items.push(item);
    });
    siblingGroups.forEach(function (group) {
      var groupIds = [model.root.id].concat(group.items[0].sharedParents || []);
      group.items.forEach(function (item) { groupIds.push(item.id); });
      group.ids = groupIds;
      group.itemIds = group.items.map(function (item) { return item.id; });
    });

    var hasSiblings = siblingGroups.length > 0;
    var descendantColumns = hasSiblings ? 2 : Math.min(3, Math.max(1, descendantFamilies.length));
    var familyRows = descendantRows(descendantFamilies, descendantColumns);
    var siblingHeight = 0;
    siblingGroups.forEach(function (group) {
      siblingHeight += 60 + Math.ceil(group.items.length / 3) * 78;
    });
    var familyHeight = familyRows.reduce(function (total, row) { return total + row.height; }, 0);
    var breedingHeight = model.breeding.length ? 126 : 0;
    var lowerHeight = Math.max(siblingHeight, familyHeight + breedingHeight);
    var width = 1320;
    var height = Math.max(790, 505 + lowerHeight);
    var rootX = 660;
    var rootY = 405;
    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
    var svg = createSvg(width, height);
    var positions = {};

    var orbit = document.createElement('div');
    orbit.className = 'root-orbit';
    orbit.style.left = (rootX - 116) + 'px';
    orbit.style.top = (rootY - 91) + 'px';
    stage.appendChild(orbit);

    for (var generation = 2; generation >= 0; generation--) {
      var row = model.ancestors.filter(function (item) { return item.generation === generation + 1; });
      var spacing = generation === 2 ? 156 : (generation === 1 ? 210 : 310);
      var xs = spread(row.length, rootX, spacing);
      var y = 58 + (2 - generation) * 104;
      row.forEach(function (item, index) {
        positions['a' + generation + '_' + item.index] = createNode(item, xs[index], y);
      });
    }
    positions.root = createNode(model.root, rootX, rootY, { root: true, hideTag: true });
    [0, 1].forEach(function (index) {
      var parent = positions['a0_' + index];
      if (parent) {
        var parentFocusIds = model.ancestors.filter(function (item) {
          return Math.floor(item.index / Math.pow(2, item.generation - 1)) === index;
        }).map(function (item) { return item.focusId; });
        addEdge(svg, parent, positions.root, 'ancestor', {
          relationIds: [parent.item.id, model.root.id]
        });
        addFocusCurve(svg, parent, positions.root, 'ancestor', parentFocusIds);
      }
    });
    [0, 1, 2, 3].forEach(function (index) {
      var ancestor = positions['a1_' + index];
      var child = positions['a0_' + Math.floor(index / 2)];
      if (ancestor && child) {
        var ancestorFocusIds = model.ancestors.filter(function (item) {
          return item.generation >= 2 &&
            Math.floor(item.index / Math.pow(2, item.generation - 2)) === index;
        }).map(function (item) { return item.focusId; });
        addEdge(svg, ancestor, child, 'ancestor', {
          relationIds: [ancestor.item.id, child.item.id]
        });
        addFocusCurve(svg, ancestor, child, 'ancestor', ancestorFocusIds);
      }
    });
    for (var ai = 0; ai < 8; ai++) {
      var oldest = positions['a2_' + ai];
      var next = positions['a1_' + Math.floor(ai / 2)];
      if (oldest && next) {
        addEdge(svg, oldest, next, 'ancestor', {
          relationIds: [oldest.item.id, next.item.id]
        });
        addFocusCurve(svg, oldest, next, 'ancestor', [oldest.item.focusId]);
      }
    }

    var siblingY = 516;
    siblingGroups.forEach(function (group, groupIndex) {
      createGroupLabel(group.title, group.items.length, 24, siblingY, 472);
      var rowCount = Math.ceil(group.items.length / 3);
      var busX = 526 - groupIndex * 6;
      var firstRowBusY = siblingY + 46;
      var lastRowBusY = firstRowBusY + (rowCount - 1) * 78;
      addRoundedPath(svg, [
        { x: rootX - 91, y: rootY },
        { x: busX, y: rootY },
        { x: busX, y: lastRowBusY }
      ], 'sibling', group.ids, 18);
      for (var rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        var rowItems = group.items.slice(rowIndex * 3, rowIndex * 3 + 3);
        var rowXs = spread(rowItems.length, 256, 164);
        var rowBusY = firstRowBusY + rowIndex * 78;
        var nodeY = rowBusY + 38;
        addPath(svg, 'M' + rowXs[0] + ',' + rowBusY + ' H' + busX, 'sibling',
          [model.root.id].concat(group.items[0].sharedParents || []));
        rowItems.forEach(function (item, colIndex) {
          var node = createNode(item, rowXs[colIndex], nodeY, { hideTag: true });
          addPath(svg, 'M' + rowXs[colIndex] + ',' + rowBusY + ' V' + (nodeY - node.height / 2),
            'sibling', [model.root.id, item.id].concat(item.sharedParents || []));
          addFocusPath(svg, [
            { x: rootX - 91, y: rootY },
            { x: busX, y: rootY },
            { x: busX, y: rowBusY },
            { x: rowXs[colIndex], y: rowBusY },
            { x: rowXs[colIndex], y: nodeY - node.height / 2 }
          ], 'sibling', [item.id], 18);
        });
      }
      siblingY += 60 + rowCount * 78;
    });

    if (descendantFamilies.length) {
      var areaLeft = hasSiblings ? 635 : 40;
      var areaWidth = hasSiblings ? 670 : 1240;
      var laneWidth = areaWidth / descendantColumns;
      var descendantSpineX = hasSiblings ? 604 : descendantSpinePosition(
        familyRows, areaLeft, laneWidth, descendantColumns, rootX
      );
      var branchY = rootY + 68;
      var familyY = 516;
      var rowUnionYs = [];
      familyRows.forEach(function (row) {
        rowUnionYs.push(familyY + 50);
        familyY += row.height;
      });
      addRoundedPath(svg, [
        { x: rootX, y: rootY + 35 },
        { x: rootX, y: branchY },
        { x: descendantSpineX, y: branchY },
        { x: descendantSpineX, y: rowUnionYs[rowUnionYs.length - 1] }
      ], 'descendant', [model.root.id], 18);
      familyY = 516;
      familyRows.forEach(function (row) {
        var rowStart = areaLeft + (descendantColumns - row.groups.length) * laneWidth / 2;
        var centers = row.groups.map(function (_, index) {
          return rowStart + laneWidth * (index + .5);
        });
        var unionY = familyY + 50;
        row.groups.forEach(function (group, groupIndex) {
          var groupX = centers[groupIndex];
          if (group.partner) {
            addPartnerChip(group.partner, groupX, familyY);
            addPath(svg, 'M' + groupX + ',' + (familyY + 30) + ' V' + unionY,
              'partner ' + group.partner.parentRole, group.ids);
          }
          var childY = familyY + 125;
          var childXs = spread(group.entries.length, groupX, 164);
          var childBusY = familyY + 78;
          addRoundedPath(svg, [
            { x: descendantSpineX, y: unionY },
            { x: groupX, y: unionY },
            { x: groupX, y: childBusY }
          ], 'descendant', [model.root.id], 18);
          if (childXs.length > 1) {
            addPath(svg, 'M' + childXs[0] + ',' + childBusY + ' H' + childXs[childXs.length - 1],
              'descendant', group.ids);
          }
          group.entries.forEach(function (entry, entryIndex) {
            var childX = childXs[entryIndex];
            var childNode = createNode(entry.item, childX, childY);
            positions['d1_' + entry.id] = childNode;
            addPath(svg, 'M' + childX + ',' + childBusY + ' V' + (childY - childNode.height / 2),
              'descendant', [model.root.id, entry.id].concat(group.partner ? [group.partner.id] : []));
            var familyFocusIds = [entry.id].concat(entry.terminals.map(function (terminal) { return terminal.id; }));
            if (group.partner) familyFocusIds.push(group.partner.id);
            addFocusPath(svg, [
              { x: rootX, y: rootY + 35 },
              { x: rootX, y: branchY },
              { x: descendantSpineX, y: branchY },
              { x: descendantSpineX, y: unionY },
              { x: groupX, y: unionY },
              { x: groupX, y: childBusY },
              { x: childX, y: childBusY },
              { x: childX, y: childY - childNode.height / 2 }
            ], 'descendant', familyFocusIds, 18);
            if (group.partner) {
              addFocusPath(svg, [
                { x: groupX, y: familyY + 30 },
                { x: groupX, y: unionY }
              ], 'partner ' + group.partner.parentRole, familyFocusIds, 18);
            }
            if (entry.terminals.length) {
              var terminalY = familyY + 240;
              var terminalXs = spread(entry.terminals.length, childX, 158);
              var terminalBusY = familyY + 190;
              addPath(svg, 'M' + childX + ',' + (childY + childNode.height / 2) + ' V' + terminalBusY,
                'descendant', [entry.id]);
              if (terminalXs.length > 1) {
                addPath(svg, 'M' + terminalXs[0] + ',' + terminalBusY + ' H' + terminalXs[terminalXs.length - 1],
                  'descendant', [entry.id]);
              }
              entry.terminals.forEach(function (item, terminalIndex) {
                var terminal = createNode(item, terminalXs[terminalIndex], terminalY);
                addPath(svg, 'M' + terminalXs[terminalIndex] + ',' + terminalBusY +
                  ' V' + (terminalY - terminal.height / 2), 'descendant', [entry.id, item.id]);
                addFocusPath(svg, [
                  { x: childX, y: childY + childNode.height / 2 },
                  { x: childX, y: terminalBusY },
                  { x: terminalXs[terminalIndex], y: terminalBusY },
                  { x: terminalXs[terminalIndex], y: terminalY - terminal.height / 2 }
                ], 'descendant', [item.id], 18);
              });
            }
          });
        });
        familyY += row.height;
      });
    }

    if (model.breeding.length) {
      var breedingY = 540 + familyHeight;
      var breedingXs = spread(model.breeding.length, rootX, Math.min(260, 900 / Math.max(1, model.breeding.length - 1)));
      var breedingBusY = breedingY - 54;
      addRoundedPath(svg, [
        { x: rootX, y: rootY + 35 },
        { x: rootX, y: breedingBusY }
      ], 'breeding', [model.root.id], 18);
      addPath(svg, 'M' + breedingXs[0] + ',' + breedingBusY + ' H' + breedingXs[breedingXs.length - 1],
        'breeding', [model.root.id]);
      model.breeding.forEach(function (item, index) {
        var node = createNode(item, breedingXs[index], breedingY);
        addPath(svg, 'M' + breedingXs[index] + ',' + breedingBusY +
          ' V' + (breedingY - node.height / 2), 'breeding', [model.root.id, item.id]);
        addFocusPath(svg, [
          { x: rootX, y: rootY + 35 },
          { x: rootX, y: breedingBusY },
          { x: breedingXs[index], y: breedingBusY },
          { x: breedingXs[index], y: breedingY - node.height / 2 }
        ], 'breeding', [item.id], 18);
      });
    }
    return { width: width, height: height };
  }

  function syncEmbeddedHeight() {
    if (embedded && window.parent !== window) {
      window.parent.postMessage({
        type: 'uma-pedigree-height',
        sample: state.sample,
        height: Math.ceil(workspace.getBoundingClientRect().height)
      }, window.location.origin);
    }
  }

  function layoutStage() {
    var width = parseFloat(stage.style.width) || 1;
    var height = parseFloat(stage.style.height) || 1;
    var mobile = window.innerWidth <= 760;
    var padding = mobile ? 10 : 18;
    var scale = mobile ? .62 : Math.min(1, (viewport.clientWidth - padding * 2) / width);
    var tx = mobile ? 0 : Math.max(padding, (viewport.clientWidth - width * scale) / 2);
    stage.style.transform = 'translate(' + tx + 'px,' + padding + 'px) scale(' + scale + ')';
    viewport.style.height = (mobile ? 610 : Math.ceil(height * scale + padding * 2)) + 'px';
    if (mobile) {
      var root = stage.querySelector('.ped-node.is-root');
      if (root) {
        var rootCenter = (parseFloat(root.style.left) + root.offsetWidth / 2) * scale;
        viewport.scrollLeft = Math.max(0, rootCenter - viewport.clientWidth / 2);
      }
      viewport.scrollTop = 0;
    }
    syncEmbeddedHeight();
  }

  function render() {
    currentModel = buildModel(state.sample);
    stage.innerHTML = '';
    state.lockedItem = null;
    state.lockedKey = '';
    closeSheet();
    document.getElementById('workspace-title').textContent = currentModel.root.name + '的血统关系';
    var summary = ['三代血统'];
    if (currentModel.siblings.length) summary.push(currentModel.siblings.length + '位同辈角色');
    if (currentModel.descendants.length) summary.push(currentModel.descendants.length + '位后代角色');
    if (currentModel.breeding.length) summary.push(currentModel.breeding.length + '位繁育关联角色');
    document.getElementById('workspace-summary').textContent = summary.join('·');
    backLink.href = characterRoute(state.sample);
    backLink.setAttribute('aria-label', '返回' + currentModel.root.name + '角色页');
    renderLens(currentModel);
    renderDetail(currentModel.root, false);
    syncPinnedSelection();
    requestAnimationFrame(layoutStage);
  }

  function initializeData() {
    (window.PED_REL || []).forEach(function (node) { byId[node.cid] = node; });
    (window.CHAR_INDEX || []).forEach(function (character) { charById[character.id] = character; });
    if (!byId[state.sample]) {
      document.getElementById('workspace-summary').textContent = '血统关系数据载入失败，请刷新页面重试。';
      return;
    }
    render();
  }

  document.querySelectorAll('[data-sample]').forEach(function (button) {
    button.classList.toggle('is-active', button.dataset.sample === state.sample);
    button.addEventListener('click', function () {
      state.sample = button.dataset.sample;
      document.querySelectorAll('[data-sample]').forEach(function (item) {
        item.classList.toggle('is-active', item === button);
      });
      render();
    });
  });

  document.querySelector('[data-action="toggle"]').addEventListener('click', function () {
    state.expanded = !state.expanded;
    workspace.classList.toggle('is-expanded', state.expanded);
    workspaceContent.hidden = !state.expanded;
    var button = document.querySelector('[data-action="toggle"]');
    button.setAttribute('aria-expanded', String(state.expanded));
    button.querySelector('span').textContent = state.expanded ? '收起血统' : '展开血统';
    requestAnimationFrame(state.expanded ? layoutStage : syncEmbeddedHeight);
  });

  sheet.querySelectorAll('[data-sheet-close]').forEach(function (button) {
    button.addEventListener('click', clearPin);
  });
  viewport.addEventListener('click', function (event) {
    if (state.lockedItem && !event.target.closest('[data-horse-id]')) clearPin();
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') clearPin();
  });
  window.addEventListener('resize', function () {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(layoutStage, 120);
  });

  if (embedded) {
    backLink.setAttribute('target', '_top');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeData);
  else initializeData();
}());
