(function () {
  'use strict';

  var state = {
    sample: 'staygold',
    view: 'lens',
    focus: 'all',
    scale: 1,
    tx: 0,
    ty: 0,
    fitScale: 1,
    dragging: false,
    moved: false
  };
  var byId = {};
  var charById = {};
  var viewport = document.getElementById('graph-viewport');
  var stage = document.getElementById('graph-stage');
  var inspector = document.getElementById('relation-inspector');
  var readout = document.getElementById('zoom-readout');
  var sheet = document.getElementById('mobile-sheet');
  var sheetContent = document.getElementById('sheet-content');
  var currentModel = null;

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

  function sourceLabel(node) {
    var url = node.profile_url || node.parentage_source_url || '';
    if (url.indexOf('netkeiba.com') !== -1) return 'netkeiba赛马资料页';
    if (url.indexOf('jbis.or.jp') !== -1 || url.indexOf('jbis.jp') !== -1) return 'JBIS赛马资料页';
    return '现实赛马资料来源';
  }

  function getNode(id, rootId) {
    var rootNode = byId[rootId];
    var lookupId = id;
    if (rootNode && id === rootNode.horse_id) lookupId = rootId;
    var node = byId[lookupId] || byId[id] || { cid: id, zh: id };
    var cid = charById[lookupId] ? lookupId : node.character_id;
    var character = cid ? charById[cid] : null;
    var role = Boolean(character);
    var horseNode = node.horse_id && byId[node.horse_id] ? byId[node.horse_id] : node;
    var name = role ? character.zh : cleanName(node.zh || node.real || node.en || id);
    var prototypeName = cleanName(node.real || horseNode.zh || node.zh || horseNode.en || node.en);
    var secondary = role ? '原型·' + prototypeName : '';
    var originals = [];
    [horseNode.en, horseNode.ja].forEach(function (value) {
      value = cleanName(value);
      if (value && value !== name && originals.indexOf(value) === -1) originals.push(value);
    });
    if (!role) secondary = originals.shift() || '';
    var profileUrl = horseNode.profile_url || node.profile_url || node.parentage_source_url || '';
    return {
      id: id,
      lookupId: lookupId,
      raw: node,
      cid: cid || '',
      role: role,
      name: name,
      secondary: secondary,
      originals: originals,
      avatar: avatarUrl((character && character.img) || node.av),
      href: role ? characterRoute(cid) : profileUrl,
      sourceUrl: profileUrl,
      sourceName: sourceLabel(horseNode)
    };
  }

  function nameOf(id, rootId) {
    return getNode(id, rootId).name;
  }

  function ancestorTag(generation, index) {
    if (generation === 0) return index === 0 ? '父' : '母';
    if (generation === 1) return ['祖父', '祖母', '外祖父', '外祖母'][index] || '祖辈';
    return '曾祖辈';
  }

  function siblingLabel(kind) {
    if (kind === 'full') return '同父同母';
    if (kind === 'same_dam') return '同母';
    return '同父';
  }

  function buildModel(rootId) {
    var rootNode = byId[rootId];
    var relations = rootNode.character_relations || { siblings: [], descendants: [], partners: [] };
    var ancestors = [];
    (rootNode.up || []).forEach(function (row, generation) {
      (row || []).forEach(function (id, index) {
        if (!id) return;
        var item = getNode(id, rootId);
        item.group = 'ancestor';
        item.tag = ancestorTag(generation, index);
        item.generation = generation + 1;
        item.index = index;
        item.relationText = '位于' + nameOf(rootId, rootId) + '的第' + (generation + 1) + '代先代血统。';
        item.facts = [{ label: '关系位置', value: item.tag }];
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
      item.relationText = '与' + nameOf(rootId, rootId) + item.tag + '。';
      item.facts = [{
        label: '共同亲本',
        value: item.sharedParents.map(function (id) { return nameOf(id, rootId); }).join('、')
      }];
      return item;
    });

    var descendants = (relations.descendants || []).map(function (relation) {
      var path = (relation.path || []).slice();
      var item = getNode(relation.cid, rootId);
      item.group = 'descendant';
      item.tag = relation.generation === 1 ? '子代' : '孙代';
      item.generation = relation.generation;
      item.path = path;
      item.links = relation.links || [];
      item.relationText = '是' + nameOf(rootId, rootId) + '的第' + relation.generation + '代后代角色。';
      item.facts = [
        { label: '完整路径', value: path.map(function (id) { return nameOf(id, rootId); }).join('→') },
        {
          label: '路径另一侧血统',
          value: item.links.map(function (link) {
            return link.partner ? nameOf(link.partner, rootId) : '';
          }).filter(Boolean).join('、') || '当前路径无另一侧亲本记录'
        }
      ];
      return item;
    });

    var partners = (relations.partners || []).map(function (relation) {
      var item = getNode(relation.horse_id, rootId);
      item.group = 'partner';
      item.tag = '配种对象';
      item.via = relation.via || [];
      item.relationText = '与' + nameOf(rootId, rootId) + '共同出现在已展示的后代路径中。';
      item.facts = [{
        label: '关联后代路径',
        value: item.via.map(function (id) { return nameOf(id, rootId); }).join('、')
      }];
      return item;
    });

    var root = getNode(rootId, rootId);
    root.group = 'root';
    root.tag = '';
    root.relationText = '当前血缘关系图的中心角色。图中完整保留3代先祖，并展示有角色页面的兄弟姐妹与2代内后代。';
    root.facts = [
      { label: '兄弟姐妹角色', value: siblings.length + '位' },
      { label: '角色后代路径', value: descendants.length + '条' },
      { label: '相关配种对象', value: partners.length + '位' }
    ];
    return { root: root, rootNode: rootNode, ancestors: ancestors, siblings: siblings, descendants: descendants, partners: partners };
  }

  function detailHtml(item) {
    var groupNames = {
      root: '当前角色',
      ancestor: '先代血统',
      sibling: '兄弟姐妹',
      descendant: '后代角色',
      partner: '配种关系'
    };
    var html = '<span class="inspector-type ' + escapeHtml(item.group) + '">' + escapeHtml(item.tag || groupNames[item.group] || '关系详情') + '</span>';
    if (item.avatar) html += '<img class="inspector-avatar" src="' + escapeHtml(item.avatar) + '" alt="">';
    html += '<h2 id="sheet-title">' + escapeHtml(item.name) + '</h2>';
    if (item.secondary) html += '<p class="inspector-real">' + escapeHtml(item.secondary) + '</p>';
    if (item.originals && item.originals.length) {
      html += '<p class="inspector-original">' + item.originals.map(escapeHtml).join('<span>·</span>') + '</p>';
    }
    html += '<p class="inspector-relation">' + escapeHtml(item.relationText || '') + '</p>';
    if (item.facts && item.facts.length) {
      html += '<div class="inspector-facts">';
      item.facts.forEach(function (fact) {
        html += '<div class="inspector-fact"><span>' + escapeHtml(fact.label) + '</span><strong>' + escapeHtml(fact.value) + '</strong></div>';
      });
      html += '</div>';
    }
    if (item.role && item.cid) {
      html += '<a class="inspector-link" href="' + characterRoute(item.cid) + '">查看' + escapeHtml(item.name) + '角色页</a>';
    } else if (item.sourceUrl) {
      html += '<a class="inspector-link" href="' + escapeHtml(item.sourceUrl) + '" target="_blank" rel="noopener noreferrer">查看' + escapeHtml(item.sourceName) + '</a>';
    }
    return html;
  }

  function showDetail(item, mobile) {
    if (!item) return;
    inspector.innerHTML = detailHtml(item);
    if (mobile) {
      sheetContent.innerHTML = detailHtml(item);
      sheet.classList.add('is-open');
      sheet.setAttribute('aria-hidden', 'false');
    }
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
      edge.classList.toggle('is-path-edge', edgeIds.length > 0 && edgeIds.every(function (id) { return ids.indexOf(id) !== -1; }));
    });
  }

  function clearHoverPath() {
    stage.classList.remove('has-hover-path');
    stage.querySelectorAll('.is-path-node,.is-path-edge').forEach(function (element) {
      element.classList.remove('is-path-node', 'is-path-edge');
    });
  }

  function bindInteractive(element, item) {
    element.addEventListener('mouseenter', function () { showDetail(item, false); setHoverPath(item); });
    element.addEventListener('mouseleave', clearHoverPath);
    element.addEventListener('focus', function () { showDetail(item, false); setHoverPath(item); });
    element.addEventListener('blur', clearHoverPath);
    element.addEventListener('click', function (event) {
      if (state.moved) {
        event.preventDefault();
        return;
      }
      if (isCoarsePointer()) {
        event.preventDefault();
        showDetail(item, true);
      }
    });
  }

  function createNode(item, x, y, options) {
    options = options || {};
    var element = document.createElement(item.href ? 'a' : 'button');
    var isRoot = Boolean(options.root);
    var width = isRoot ? 202 : (item.role ? 156 : 154);
    var height = isRoot ? 88 : (item.role ? 72 : 62);
    element.className = 'ped-node' + (isRoot ? ' is-root' : '') + (item.role ? ' is-role' : ' is-horse');
    element.dataset.group = item.group;
    element.dataset.nodeId = item.id;
    element.setAttribute('aria-label', item.name + (item.tag ? '，' + item.tag : ''));
    element.style.left = Math.round(x - width / 2) + 'px';
    element.style.top = Math.round(y - height / 2) + 'px';
    if (item.href) {
      element.href = item.href;
      if (!item.role) {
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
      }
    } else {
      element.type = 'button';
    }
    if (item.tag && !options.hideTag) {
      var tag = document.createElement('span');
      tag.className = 'ped-tag ' + item.group;
      tag.textContent = item.tag;
      element.appendChild(tag);
    }
    if (item.role) {
      var image = document.createElement('img');
      image.className = 'ped-avatar';
      image.src = item.avatar;
      image.alt = '';
      image.loading = 'lazy';
      element.appendChild(image);
    } else {
      var mark = document.createElement('span');
      mark.className = 'horse-mark';
      mark.textContent = '原';
      element.appendChild(mark);
    }
    var copy = document.createElement('span');
    copy.className = 'ped-copy';
    copy.innerHTML = '<span class="ped-name">' + escapeHtml(item.name) + '</span>' +
      (item.secondary ? '<span class="ped-sub">' + escapeHtml(item.secondary) + '</span>' : '');
    element.appendChild(copy);
    bindInteractive(element, item);
    stage.appendChild(element);
    return { x: x, y: y, width: width, height: height, element: element, item: item };
  }

  function createPanelRow(item) {
    var row = document.createElement(item.href ? 'a' : 'button');
    row.className = 'panel-row';
    row.dataset.group = item.group;
    if (item.href) {
      row.href = item.href;
      if (!item.role) { row.target = '_blank'; row.rel = 'noopener noreferrer'; }
    } else {
      row.type = 'button';
    }
    if (item.avatar) {
      var img = document.createElement('img');
      img.src = item.avatar;
      img.alt = '';
      img.loading = 'lazy';
      row.appendChild(img);
    } else {
      var mark = document.createElement('span');
      mark.className = 'horse-mark';
      mark.textContent = '原';
      row.appendChild(mark);
    }
    var copy = document.createElement('span');
    copy.className = 'ped-copy';
    copy.innerHTML = '<strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.tag || item.secondary) + '</small>';
    row.appendChild(copy);
    bindInteractive(row, item);
    return row;
  }

  function createLabel(text, x, y, cluster) {
    var label = document.createElement('div');
    label.className = cluster ? 'cluster-label' : 'generation-label';
    label.textContent = text;
    label.style.left = x + 'px';
    label.style.top = y + 'px';
    stage.appendChild(label);
  }

  function createZone(title, note, x, y, width, height, group) {
    var zone = document.createElement('section');
    zone.className = 'relation-zone ' + group;
    zone.dataset.group = group;
    zone.style.left = x + 'px';
    zone.style.top = y + 'px';
    zone.style.width = width + 'px';
    zone.style.height = height + 'px';
    zone.innerHTML = '<div class="zone-heading"><span>' + escapeHtml(title) + '</span><small>' + escapeHtml(note) + '</small></div>';
    stage.appendChild(zone);
    return zone;
  }

  function createGroupLabel(title, count, x, y, group) {
    var label = document.createElement('div');
    label.className = 'relation-group-label ' + group;
    label.dataset.group = group;
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
    path.dataset.group = group;
    path.dataset.relationIds = (options.relationIds || [from.item && from.item.id, to.item && to.item.id])
      .filter(Boolean).join('|');
    svg.appendChild(path);
  }

  function addPartnerChip(item, x, y) {
    var chip = document.createElement(item.href ? 'a' : 'button');
    chip.className = 'partner-chip';
    chip.dataset.group = 'partner';
    chip.dataset.nodeId = item.id;
    chip.style.left = x + 'px';
    chip.style.top = y + 'px';
    chip.textContent = item.name;
    if (item.href) {
      chip.href = item.href;
      if (!item.role) { chip.target = '_blank'; chip.rel = 'noopener noreferrer'; }
    } else {
      chip.type = 'button';
    }
    bindInteractive(chip, item);
    stage.appendChild(chip);
  }

  function spread(count, center, spacing) {
    var result = [];
    for (var i = 0; i < count; i++) result.push(center + (i - (count - 1) / 2) * spacing);
    return result;
  }

  function descendantStructure(model) {
    var firstOrder = [];
    var firstMap = {};
    var terminals = [];
    model.descendants.forEach(function (descendant) {
      var path = descendant.path || [];
      var firstId = path[1] || descendant.id;
      if (!firstMap[firstId]) {
        var firstItem = path.length === 2 ? descendant : getNode(firstId, model.root.lookupId);
        firstItem.group = 'descendant';
        firstItem.tag = path.length === 2 ? descendant.tag : '中间代';
        firstItem.path = path.length === 2 ? path.slice() : [model.root.id, firstId];
        firstItem.relationText = path.length === 2
          ? descendant.relationText
          : '连接' + model.root.name + '与后代角色的中间代现实赛马。';
        firstItem.facts = path.length === 2 ? descendant.facts : [{
          label: '通向角色', value: descendant.name
        }];
        firstMap[firstId] = { id: firstId, item: firstItem, terminals: [], partner: null };
        firstOrder.push(firstMap[firstId]);
      }
      if (path.length > 2) {
        firstMap[firstId].terminals.push(descendant);
        terminals.push({ parentId: firstId, item: descendant });
      }
      var firstLink = descendant.links && descendant.links[0];
      if (firstLink && firstLink.partner && !firstMap[firstId].partner) {
        var partner = getNode(firstLink.partner, model.root.lookupId);
        partner.group = 'partner';
        partner.tag = '配种对象';
        partner.via = [firstId];
        partner.path = [model.root.id, firstId];
        partner.relationText = '与' + model.root.name + '共同构成通向' + descendant.name + '的后代路径。';
        partner.facts = [{ label: '关联后代路径', value: nameOf(firstId, model.root.lookupId) }];
        firstMap[firstId].partner = partner;
      }
    });
    return { first: firstOrder, terminals: terminals };
  }

  function renderAtlas(model) {
    var structure = descendantStructure(model);
    var maxCount = Math.max(8, model.siblings.length, structure.first.length, structure.terminals.length);
    var width = Math.max(1500, maxCount * 170 + 240);
    var height = structure.terminals.length ? 1240 : 1060;
    var center = width / 2;
    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
    var svg = createSvg(width, height);
    var positions = {};

    createLabel('第3代先祖', 50, 43);
    createLabel('第2代先祖', 50, 183);
    createLabel('父母', 50, 323);
    createLabel('当前角色', 50, 499);
    createLabel('兄弟姐妹角色', 50, 677);
    createLabel('角色后代路径', 50, 875);

    for (var generation = 2; generation >= 0; generation--) {
      var row = model.ancestors.filter(function (item) { return item.generation === generation + 1; });
      var y = 82 + (2 - generation) * 140;
      var xs = spread(row.length, center, Math.min(178, (width - 260) / Math.max(1, row.length)));
      row.forEach(function (item, index) {
        positions['a' + generation + '_' + item.index] = createNode(item, xs[index], y);
      });
    }
    positions.root = createNode(model.root, center, 550, { root: true, hideTag: true });
    [0, 1].forEach(function (index) { addEdge(svg, positions['a0_' + index], positions.root, 'ancestor'); });
    [0, 1, 2, 3].forEach(function (index) {
      addEdge(svg, positions['a1_' + index], positions['a0_' + Math.floor(index / 2)], 'ancestor');
    });
    for (var ai = 0; ai < 8; ai++) addEdge(svg, positions['a2_' + ai], positions['a1_' + Math.floor(ai / 2)], 'ancestor');

    var siblingXs = spread(model.siblings.length, center, 168);
    model.siblings.forEach(function (item, index) {
      var node = createNode(item, siblingXs[index], 734);
      positions['s' + index] = node;
      var shared = item.sharedParents && item.sharedParents[0];
      var parent = null;
      model.ancestors.forEach(function (ancestor) {
        if (ancestor.id === shared && ancestor.generation === 1) parent = positions['a0_' + ancestor.index];
      });
      addEdge(svg, parent || positions.root, node, 'sibling');
    });

    var firstXs = spread(structure.first.length, center, Math.min(210, (width - 280) / Math.max(1, structure.first.length)));
    structure.first.forEach(function (entry, index) {
      var node = createNode(entry.item, firstXs[index], 930);
      positions['d1_' + entry.id] = node;
      addEdge(svg, positions.root, node, 'descendant');
      if (entry.partner) addPartnerChip(entry.partner, firstXs[index] + 84, 844);
    });
    if (structure.terminals.length) {
      var terminalXs = spread(structure.terminals.length, center, Math.min(190, (width - 280) / Math.max(1, structure.terminals.length)));
      structure.terminals.forEach(function (entry, index) {
        var node = createNode(entry.item, terminalXs[index], 1122);
        addEdge(svg, positions['d1_' + entry.parentId], node, 'descendant');
      });
    }
    return { width: width, height: height };
  }

  function applyLensFocus(focus) {
    state.focus = focus;
    stage.querySelectorAll('[data-group]').forEach(function (element) {
      var group = element.dataset.group;
      var muted = focus !== 'all' && group !== focus && group !== 'root';
      element.classList.toggle(element.classList.contains('relation-edge') ? 'muted' : 'is-muted', muted);
      element.classList.toggle('is-related', !muted && focus !== 'all' && group === focus && !element.classList.contains('relation-edge'));
    });
    stage.querySelectorAll('.lens-filter button').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.focus === focus);
    });
  }

  function renderLens(model) {
    var structure = descendantStructure(model);
    var siblingGroups = [];
    var siblingMap = {};
    model.siblings.forEach(function (item) {
      var key = item.relationKind + ':' + (item.sharedParents || []).join(',');
      if (!siblingMap[key]) {
        siblingMap[key] = { items: [], title: item.tag + '·' + item.sharedParents.map(function (id) { return nameOf(id, model.root.lookupId); }).join('、') };
        siblingGroups.push(siblingMap[key]);
      }
      siblingMap[key].items.push(item);
    });
    var siblingHeight = 74;
    siblingGroups.forEach(function (group) { siblingHeight += 46 + Math.ceil(group.items.length / 3) * 92; });
    var descendantRows = 0;
    structure.first.forEach(function (entry) { descendantRows += Math.max(1, entry.terminals.length); });
    var descendantHeight = 92 + descendantRows * 102;
    var width = 1820;
    var height = Math.max(1050, 420 + siblingHeight, 420 + descendantHeight);
    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
    var svg = createSvg(width, height);
    var positions = {};
    var hasSiblings = siblingGroups.length > 0;
    var rootX = hasSiblings ? 850 : 620;
    var rootY = 520;
    var descendantZoneX = hasSiblings ? 1084 : 810;

    createZone('3代先祖', '父系在左，母系在右；悬停节点会点亮通向主角的完整路径。', hasSiblings ? 185 : 38, 24, 1330, 354, 'ancestor');
    if (hasSiblings) {
      createZone('兄弟姐妹角色', '只展示已有角色页的同父、同母及全同胞。', 38, 414, 560, siblingHeight, 'sibling');
    }
    createZone('2代内角色后代', '保留连接角色所需的中间代，配种对象贴近对应路径。', descendantZoneX, 414, hasSiblings ? 690 : 964, descendantHeight, 'descendant');

    var orbit = document.createElement('div');
    orbit.className = 'root-orbit';
    orbit.style.left = (rootX - 142) + 'px';
    orbit.style.top = (rootY - 118) + 'px';
    stage.appendChild(orbit);

    for (var generation = 2; generation >= 0; generation--) {
      var row = model.ancestors.filter(function (item) { return item.generation === generation + 1; });
      var xs = spread(row.length, rootX, generation === 2 ? 158 : 188);
      var y = 80 + (2 - generation) * 112;
      row.forEach(function (item, index) {
        positions['a' + generation + '_' + item.index] = createNode(item, xs[index], y);
      });
    }
    positions.root = createNode(model.root, rootX, rootY, { root: true, hideTag: true });
    [0, 1].forEach(function (index) {
      var parent = positions['a0_' + index];
      if (parent) addEdge(svg, parent, positions.root, 'ancestor', { relationIds: [parent.item.id, model.root.id] });
    });
    [0, 1, 2, 3].forEach(function (index) {
      var ancestor = positions['a1_' + index];
      var child = positions['a0_' + Math.floor(index / 2)];
      if (ancestor && child) addEdge(svg, ancestor, child, 'ancestor', { relationIds: [ancestor.item.id, child.item.id] });
    });
    for (var ai = 0; ai < 8; ai++) {
      var oldest = positions['a2_' + ai];
      var next = positions['a1_' + Math.floor(ai / 2)];
      if (oldest && next) addEdge(svg, oldest, next, 'ancestor', { relationIds: [oldest.item.id, next.item.id] });
    }

    var siblingY = 472;
    siblingGroups.forEach(function (group) {
      createGroupLabel(group.title, group.items.length, 66, siblingY, 'sibling');
      var rowCount = Math.ceil(group.items.length / 3);
      var groupCenterY = siblingY + 42 + rowCount * 46;
      addEdge(svg, positions.root, { x: 598, y: groupCenterY, width: 0, height: 0, item: null }, 'sibling', {
        horizontal: true,
        fromDx: -101,
        fromDy: 0,
        toDx: 0,
        toDy: 0,
        relationIds: [model.root.id].concat(group.items[0].sharedParents || [])
      });
      group.items.forEach(function (item, index) {
        var col = index % 3;
        var rowIndex = Math.floor(index / 3);
        createNode(item, 142 + col * 176, siblingY + 66 + rowIndex * 92, { hideTag: true });
      });
      siblingY += 46 + rowCount * 92;
    });

    var descendantY = 492;
    structure.first.forEach(function (entry) {
      var span = Math.max(1, entry.terminals.length);
      var firstY = descendantY + (span - 1) * 51;
      var firstX = descendantZoneX + 108;
      var terminalX = descendantZoneX + 486;
      var node = createNode(entry.item, firstX, firstY);
      positions['d1_' + entry.id] = node;
      addEdge(svg, positions.root, node, 'descendant', {
        horizontal: true,
        fromDx: 101,
        fromDy: 0,
        toDx: -78,
        toDy: 0,
        relationIds: [model.root.id, entry.id]
      });
      if (entry.partner) addPartnerChip(entry.partner, descendantZoneX + 192, firstY - 44);
      entry.terminals.forEach(function (item, index) {
        var terminalY = descendantY + index * 102;
        var terminal = createNode(item, terminalX, terminalY);
        addEdge(svg, node, terminal, 'descendant', {
          horizontal: true,
          fromDx: 77,
          fromDy: 0,
          toDx: -78,
          toDy: 0,
          relationIds: [entry.id, item.id]
        });
      });
      descendantY += span * 102;
    });

    var filter = document.createElement('div');
    filter.className = 'lens-filter';
    filter.style.left = (rootX - 160) + 'px';
    filter.style.top = '610px';
    [['all', '全部'], ['ancestor', '先代'], ['sibling', '同辈'], ['descendant', '后代'], ['partner', '配种']].forEach(function (entry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.focus = entry[0];
      button.textContent = entry[1];
      button.addEventListener('click', function () { applyLensFocus(entry[0]); });
      filter.appendChild(button);
    });
    stage.appendChild(filter);
    applyLensFocus(state.focus);
    return { width: width, height: height };
  }

  function createRelationPanel(title, note, items, x, y, partnerPanel) {
    var panel = document.createElement('section');
    panel.className = 'panel-list' + (partnerPanel ? ' is-partners' : '');
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    var heading = document.createElement('h3');
    heading.textContent = title;
    panel.appendChild(heading);
    var description = document.createElement('p');
    description.textContent = note;
    panel.appendChild(description);
    var rows = document.createElement('div');
    rows.className = 'panel-rows';
    items.forEach(function (item) { rows.appendChild(createPanelRow(item)); });
    panel.appendChild(rows);
    stage.appendChild(panel);
  }

  function renderPanel(model) {
    var structure = descendantStructure(model);
    var width = 1480;
    var height = Math.max(900, 780 + structure.terminals.length * 20);
    var graphCenter = 480;
    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
    var svg = createSvg(width, height);
    var positions = {};

    createLabel('3代先祖主干', 50, 37);
    createLabel('当前角色', 50, 437);
    createLabel('角色后代路径', 50, 586);

    for (var generation = 2; generation >= 0; generation--) {
      var row = model.ancestors.filter(function (item) { return item.generation === generation + 1; });
      var xs = spread(row.length, graphCenter, generation === 2 ? 104 : 170);
      var y = 78 + (2 - generation) * 130;
      row.forEach(function (item, index) {
        positions['a' + generation + '_' + item.index] = createNode(item, xs[index], y);
      });
    }
    positions.root = createNode(model.root, graphCenter, 486, { root: true, hideTag: true });
    [0, 1].forEach(function (index) { addEdge(svg, positions['a0_' + index], positions.root, 'ancestor'); });
    [0, 1, 2, 3].forEach(function (index) { addEdge(svg, positions['a1_' + index], positions['a0_' + Math.floor(index / 2)], 'ancestor'); });
    for (var ai = 0; ai < 8; ai++) addEdge(svg, positions['a2_' + ai], positions['a1_' + Math.floor(ai / 2)], 'ancestor');

    var firstXs = spread(structure.first.length, graphCenter, Math.min(184, 780 / Math.max(1, structure.first.length)));
    structure.first.forEach(function (entry, index) {
      var node = createNode(entry.item, firstXs[index], 645);
      positions['d1_' + entry.id] = node;
      addEdge(svg, positions.root, node, 'descendant');
    });
    if (structure.terminals.length) {
      var terminalXs = spread(structure.terminals.length, graphCenter, Math.min(174, 780 / Math.max(1, structure.terminals.length)));
      structure.terminals.forEach(function (entry, index) {
        var node = createNode(entry.item, terminalXs[index], 805);
        addEdge(svg, positions['d1_' + entry.parentId], node, 'descendant');
      });
    }

    createRelationPanel('兄弟姐妹角色', '仅收录拥有角色页面的同父、同母或全同胞。', model.siblings, 1000, 62, false);
    createRelationPanel('配种关系', '对象不占用主图节点，悬停或点击查看来源与关联路径。', model.partners, 1000, 575, true);
    return { width: width, height: height };
  }

  function updateTransform() {
    stage.style.transform = 'translate(' + state.tx + 'px,' + state.ty + 'px) scale(' + state.scale + ')';
    readout.textContent = Math.round(state.scale * 100) + '%';
  }

  function fitStage() {
    var width = parseFloat(stage.style.width) || 1;
    var height = parseFloat(stage.style.height) || 1;
    var padding = window.innerWidth <= 760 ? 18 : 34;
    var sx = (viewport.clientWidth - padding * 2) / width;
    var sy = (viewport.clientHeight - padding * 2) / height;
    state.scale = Math.min(1, sx, sy);
    state.fitScale = state.scale;
    state.tx = (viewport.clientWidth - width * state.scale) / 2;
    state.ty = (viewport.clientHeight - height * state.scale) / 2;
    updateTransform();
  }

  function focusRoot(minimumScale) {
    var root = stage.querySelector('.ped-node.is-root');
    if (!root) return;
    var rootX = parseFloat(root.style.left) + root.offsetWidth / 2;
    var rootY = parseFloat(root.style.top) + root.offsetHeight / 2;
    state.scale = Math.max(state.fitScale, minimumScale);
    state.tx = viewport.clientWidth / 2 - rootX * state.scale;
    state.ty = viewport.clientHeight * .46 - rootY * state.scale;
    updateTransform();
  }

  function zoomAt(factor, clientX, clientY) {
    var rect = viewport.getBoundingClientRect();
    var x = clientX == null ? viewport.clientWidth / 2 : clientX - rect.left;
    var y = clientY == null ? viewport.clientHeight / 2 : clientY - rect.top;
    var worldX = (x - state.tx) / state.scale;
    var worldY = (y - state.ty) / state.scale;
    var next = Math.max(.12, Math.min(2.5, state.scale * factor));
    state.tx = x - worldX * next;
    state.ty = y - worldY * next;
    state.scale = next;
    updateTransform();
  }

  function render() {
    currentModel = buildModel(state.sample);
    stage.innerHTML = '';
    state.focus = 'all';
    document.getElementById('workspace-title').textContent = currentModel.root.name + '的血缘关系';
    document.getElementById('workspace-summary').textContent =
      '上溯3代·' + currentModel.siblings.length + '位兄弟姐妹角色·' +
      currentModel.descendants.length + '条角色后代路径·' + currentModel.partners.length + '位配种对象';
    renderLens(currentModel);
    showDetail(currentModel.root, false);
    requestAnimationFrame(function () {
      fitStage();
      if (window.innerWidth <= 760) focusRoot(.72);
      else if (state.fitScale < .62) focusRoot(.62);
    });
  }

  function initializeData() {
    (window.PED_REL || []).forEach(function (node) { byId[node.cid] = node; });
    (window.CHAR_INDEX || []).forEach(function (character) { charById[character.id] = character; });
    if (!byId[state.sample]) {
      document.getElementById('workspace-summary').textContent = '血缘关系数据载入失败，请刷新页面重试。';
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

  document.querySelector('[data-action=zoom-in]').addEventListener('click', function () { zoomAt(1.2); });
  document.querySelector('[data-action=zoom-out]').addEventListener('click', function () { zoomAt(1 / 1.2); });
  document.querySelector('[data-action=fit]').addEventListener('click', fitStage);
  document.querySelector('[data-action=root]').addEventListener('click', function () { focusRoot(window.innerWidth <= 760 ? .72 : .7); });

  viewport.addEventListener('wheel', function (event) {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
  }, { passive: false });

  viewport.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || event.target.closest('.ped-node,.panel-row,.partner-chip,.lens-filter')) return;
    state.dragging = true;
    state.moved = false;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.originX = state.tx;
    state.originY = state.ty;
    viewport.classList.add('is-dragging');
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', function (event) {
    if (!state.dragging) return;
    var dx = event.clientX - state.startX;
    var dy = event.clientY - state.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) state.moved = true;
    state.tx = state.originX + dx;
    state.ty = state.originY + dy;
    updateTransform();
  });
  function endDrag() {
    state.dragging = false;
    viewport.classList.remove('is-dragging');
    window.setTimeout(function () { state.moved = false; }, 0);
  }
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

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
    state.resizeTimer = window.setTimeout(function () {
      fitStage();
      if (window.innerWidth <= 760) focusRoot(.72);
      else if (state.fitScale < .62) focusRoot(.62);
    }, 120);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeData);
  else initializeData();
}());
