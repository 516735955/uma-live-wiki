(function () {
  'use strict';

  var state = { sample: 'staygold', expanded: true, lockedItem: null, resizeTimer: null };
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
    SAF: '南非', UAE: '阿联酋'
  };
  var relationRank = { full: 0, same_dam: 1, same_sire: 2 };

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
    var horseZh = cleanName(horseNode.zh || node.real || node.zh || horseNode.en || node.en || id);
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
      ja: cleanName(horseNode.ja || node.ja),
      en: cleanName(horseNode.en || node.en),
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
    });

    var siblings = (relations.siblings || []).map(function (relation) {
      var item = getNode(relation.cid, rootId);
      item.group = 'sibling';
      item.tag = siblingLabel(relation.relation);
      item.relationKind = relation.relation;
      item.sharedParents = relation.shared_parents || [];
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

  function detailHtml(item, headingId) {
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
    if (item.sourceUrl) {
      html += '<a class="inspector-link source-link" href="' + escapeHtml(item.sourceUrl) +
        '" target="_blank" rel="noopener noreferrer">' + escapeHtml(item.sourceName) + '</a>';
    }
    if (item.role && !item.isCurrent) {
      html += '<a class="inspector-link character-link" href="' + characterRoute(item.cid) + '">前往' +
        escapeHtml(item.name) + '角色页</a>';
    }
    html += '</div></div>';
    return html;
  }

  function renderDetail(item, mobile) {
    if (!item) return;
    inspector.innerHTML = detailHtml(item, 'inspector-title');
    if (mobile) {
      sheetContent.innerHTML = detailHtml(item, 'sheet-title');
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
    }
  }

  function syncPinnedSelection() {
    stage.querySelectorAll('[data-horse-id]').forEach(function (element) {
      element.classList.toggle('is-selected', Boolean(state.lockedItem) &&
        element.dataset.horseId === state.lockedItem.horseId);
    });
  }

  function pinDetail(item, mobile) {
    state.lockedItem = item;
    renderDetail(item, mobile);
    syncPinnedSelection();
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
    (item.path || []).concat(item.sharedParents || []).concat(item.via || []).forEach(function (id) {
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }

  function setHoverPath(item) {
    var ids = highlightIds(item);
    stage.classList.add('has-hover-path');
    stage.querySelectorAll('[data-node-id]').forEach(function (element) {
      element.classList.toggle('is-path-node', ids.indexOf(element.dataset.nodeId) !== -1);
    });
    stage.querySelectorAll('.relation-edge').forEach(function (edge) {
      var edgeIds = (edge.dataset.relationIds || '').split('|').filter(Boolean);
      edge.classList.toggle('is-path-edge', edgeIds.length > 0 && edgeIds.every(function (id) {
        return ids.indexOf(id) !== -1;
      }));
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
    element.addEventListener('mouseenter', function () { previewDetail(item); setHoverPath(item); });
    element.addEventListener('mouseleave', clearHoverPath);
    element.addEventListener('focus', function () { previewDetail(item); setHoverPath(item); });
    element.addEventListener('blur', clearHoverPath);
    element.addEventListener('click', function (event) {
      event.preventDefault();
      pinDetail(item, isCoarsePointer());
    });
  }

  function createNode(item, x, y, options) {
    options = options || {};
    var element = document.createElement('button');
    var isRoot = Boolean(options.root);
    var width = isRoot ? 178 : (item.role ? 140 : 124);
    var height = isRoot ? 68 : (item.role ? 56 : 42);
    element.className = 'ped-node' + (isRoot ? ' is-root' : '') + (item.role ? ' is-role' : ' is-horse');
    element.dataset.group = item.group;
    element.dataset.nodeId = item.id;
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

  function createGroupLabel(title, count, x, y) {
    var label = document.createElement('div');
    label.className = 'relation-group-label';
    label.style.left = x + 'px';
    label.style.top = y + 'px';
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
  }

  function addPartnerChip(item, x, y) {
    var chip = document.createElement('button');
    var parentRole = item.parentRole || '';
    chip.className = 'partner-chip' + (parentRole ? ' is-' + parentRole : '');
    chip.dataset.nodeId = item.id;
    chip.dataset.horseId = item.horseId;
    chip.style.left = x + 'px';
    chip.style.top = y + 'px';
    chip.type = 'button';
    chip.innerHTML = '<span class="partner-role">' + escapeHtml(item.tag) + '</span><strong>' +
      escapeHtml(item.name) + '</strong>';
    chip.setAttribute('aria-label', item.tag + '，' + item.name + '，' + (sexLabels[item.sex] || '赛马'));
    bindInteractive(chip, item);
    stage.appendChild(chip);
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

  function renderLens(model) {
    var structure = descendantStructure(model);
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

    var siblingRows = 0;
    siblingGroups.forEach(function (group) { siblingRows += 1 + Math.ceil(group.items.length / 3); });
    var descendantRows = 0;
    structure.first.forEach(function (entry) { descendantRows += Math.max(1, entry.terminals.length); });
    var relationRows = Math.max(siblingRows, descendantRows, model.breeding.length);
    var width = 1280;
    var height = Math.max(790, 470 + relationRows * 78);
    var rootX = 620;
    var rootY = 390;
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
      var spacing = generation === 2 ? 136 : (generation === 1 ? 190 : 280);
      var xs = spread(row.length, rootX, spacing);
      var y = 55 + (2 - generation) * 100;
      row.forEach(function (item, index) {
        positions['a' + generation + '_' + item.index] = createNode(item, xs[index], y);
      });
    }
    positions.root = createNode(model.root, rootX, rootY, { root: true, hideTag: true });
    [0, 1].forEach(function (index) {
      var parent = positions['a0_' + index];
      if (parent) addEdge(svg, parent, positions.root, 'ancestor', {
        relationIds: [parent.item.id, model.root.id]
      });
    });
    [0, 1, 2, 3].forEach(function (index) {
      var ancestor = positions['a1_' + index];
      var child = positions['a0_' + Math.floor(index / 2)];
      if (ancestor && child) addEdge(svg, ancestor, child, 'ancestor', {
        relationIds: [ancestor.item.id, child.item.id]
      });
    });
    for (var ai = 0; ai < 8; ai++) {
      var oldest = positions['a2_' + ai];
      var next = positions['a1_' + Math.floor(ai / 2)];
      if (oldest && next) addEdge(svg, oldest, next, 'ancestor', {
        relationIds: [oldest.item.id, next.item.id]
      });
    }

    var siblingY = 474;
    siblingGroups.forEach(function (group) {
      createGroupLabel(group.title, group.items.length, 47, siblingY - 20);
      var rowCount = Math.ceil(group.items.length / 3);
      group.items.forEach(function (item, index) {
        var col = index % 3;
        var rowIndex = Math.floor(index / 3);
        var node = createNode(item, 88 + col * 142, siblingY + 36 + rowIndex * 68, { hideTag: true });
        addEdge(svg, positions.root, node, 'sibling', {
          horizontal: true,
          fromDx: -89,
          fromDy: 0,
          toDx: node.width / 2,
          toDy: 0,
          relationIds: [model.root.id, item.id].concat(item.sharedParents || [])
        });
      });
      siblingY += 58 + rowCount * 68;
    });

    var descendantY = 500;
    structure.first.forEach(function (entry) {
      var span = Math.max(1, entry.terminals.length);
      var firstY = descendantY + (span - 1) * 38;
      var firstNode = createNode(entry.item, 855, firstY);
      positions['d1_' + entry.id] = firstNode;
      addEdge(svg, positions.root, firstNode, 'descendant', {
        horizontal: true,
        fromDx: 89,
        fromDy: 0,
        toDx: -firstNode.width / 2,
        toDy: 0,
        relationIds: [model.root.id, entry.id]
      });
      if (entry.partner) addPartnerChip(entry.partner, 768, firstY - 49);
      entry.terminals.forEach(function (item, index) {
        var terminalY = descendantY + index * 76;
        var terminal = createNode(item, 1110, terminalY);
        addEdge(svg, firstNode, terminal, 'descendant', {
          horizontal: true,
          fromDx: firstNode.width / 2,
          fromDy: 0,
          toDx: -terminal.width / 2,
          toDy: 0,
          relationIds: [entry.id, item.id]
        });
      });
      descendantY += span * 76;
    });

    var breedingY = Math.max(500, descendantY + (structure.first.length ? 18 : 0));
    model.breeding.forEach(function (item, index) {
      var node = createNode(item, 935, breedingY + index * 78);
      addEdge(svg, positions.root, node, 'breeding', {
        horizontal: true,
        fromDx: 89,
        fromDy: 0,
        toDx: -node.width / 2,
        toDy: 0,
        relationIds: [model.root.id, item.id]
      });
    });
    return { width: width, height: height };
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
  }

  function render() {
    currentModel = buildModel(state.sample);
    stage.innerHTML = '';
    state.lockedItem = null;
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
    if (state.expanded) requestAnimationFrame(layoutStage);
  });

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
    state.resizeTimer = window.setTimeout(layoutStage, 120);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeData);
  else initializeData();
}());
