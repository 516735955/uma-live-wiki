(function () {
  'use strict';

  var query = new URLSearchParams(window.location.search);
  var requestedSample = query.get('sample') || window.PEDIGREE_SAMPLE;
  var embedded = query.has('embed') || Boolean(window.PEDIGREE_EMBEDDED);
  var state = {
    sample: requestedSample || 'staygold',
    expanded: true,
    lockedItem: null,
    lockedKey: '',
    resizeTimer: null,
    returnFocus: null
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

  function safeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
  }

  function contrastColor(value) {
    var color = safeColor(value, '#3159d9').slice(1);
    var red = parseInt(color.slice(0, 2), 16);
    var green = parseInt(color.slice(2, 4), 16);
    var blue = parseInt(color.slice(4, 6), 16);
    return (red * 299 + green * 587 + blue * 114) / 1000 > 164 ? '#20283b' : '#ffffff';
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
      roleColor: safeColor(character && character.main, '#3159d9'),
      roleSubColor: safeColor(character && character.sub, '#23418f'),
      roleInk: contrastColor(character && character.main),
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
      item.focusId = 'sibling:' + item.id;
      item.pathFocusIds = ['root:' + rootId, item.focusId].concat(ancestors.filter(function (ancestor) {
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
      item.focusId = 'descendant:' + relation.generation + ':' + item.id;
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
      item.tag = '繁育';
      item.records = relation.records || [];
      item.focusId = 'breeding:' + item.id;
      item.sourceUrl = relation.source_url || item.sourceUrl;
      item.sourceName = sourceLabel(item.sourceUrl);
      item.path = [rootId, item.id];
      return item;
    }).sort(function (a, b) {
      var aYear = a.records.length ? a.records[0].year : 9999;
      var bYear = b.records.length ? b.records[0].year : 9999;
      return aYear - bYear || compareBornName(a, b);
    });

    var root = getNode(rootId, rootId);
    root.group = 'root';
    root.tag = '当前角色';
    root.focusId = 'root:' + rootId;
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
      descendant: '后代角色', partner: '另一方亲本', breeding: '繁育记录'
    };
    var detailClass = item.role ? 'is-role-detail' : 'is-horse-detail';
    var style = item.role ? ' style="--role-color:' + escapeHtml(item.roleColor) +
      ';--role-sub-color:' + escapeHtml(item.roleSubColor) + ';--role-ink:' + escapeHtml(item.roleInk) + '"' : '';
    var html = '<div class="inspector-card ' + detailClass + '"' + style + '>';
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
    if (item.records && item.records.length) {
      html += factRow('繁育记录', item.records.length + '次');
      html += '<div class="breeding-history"><dt>逐年结果</dt><dd>';
      item.records.forEach(function (record) {
        var outcome = record.outcome === 'no_foal' ? '未产驹' : '有产驹';
        html += '<span class="breeding-event ' + escapeHtml(record.outcome) + '">' +
          escapeHtml(record.year + '年·' + outcome) + '</span>';
      });
      html += '</dd></div>';
    }
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
      requestAnimationFrame(function () {
        var close = sheet.querySelector('.sheet-close');
        if (close) close.focus();
      });
    }
  }

  function syncPinnedSelection() {
    stage.querySelectorAll('[data-selection-key]').forEach(function (element) {
      element.classList.toggle('is-selected', Boolean(state.lockedItem) &&
        element.dataset.selectionKey === state.lockedKey);
    });
  }

  function pinDetail(item, mobile, selectionKey, trigger) {
    if (state.lockedItem && state.lockedKey === selectionKey) {
      clearPin();
      return;
    }
    item.selectionKey = selectionKey;
    state.lockedItem = item;
    state.lockedKey = selectionKey;
    state.returnFocus = trigger || document.activeElement;
    renderDetail(item, mobile);
    syncPinnedSelection();
  }

  function closeSheet() {
    var wasOpen = sheet.classList.contains('is-open');
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    if (wasOpen && state.returnFocus && document.contains(state.returnFocus)) {
      state.returnFocus.focus();
    }
  }

  function clearPin() {
    state.lockedItem = null;
    state.lockedKey = '';
    closeSheet();
    state.returnFocus = null;
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
    var focusId = item.focusId || (item.group + ':' + item.id);
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
      pinDetail(item, isCoarsePointer(), selectionKey, element);
    });
  }

  function createNode(item, x, y, options) {
    options = options || {};
    var element = document.createElement('button');
    var isRoot = Boolean(options.root);
    var isAncestor = item.group === 'ancestor';
    var isBreeding = item.group === 'breeding' && item.records && item.records.length;
    var width = isRoot ? 182 : (isAncestor ? (item.role ? 142 : 124) :
      (isBreeding ? 176 : (item.role ? 152 : 128)));
    var height = isRoot ? 70 : (isBreeding ? 78 : (item.role ? 60 : 44));
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
    if (isBreeding) {
      var history = document.createElement('span');
      history.className = 'ped-breeding-history';
      item.records.forEach(function (record) {
        var event = document.createElement('span');
        event.className = 'ped-breeding-event ' + record.outcome;
        event.textContent = record.year + (record.outcome === 'no_foal' ? '未产驹' : '有产驹');
        history.appendChild(event);
      });
      copy.appendChild(history);
    }
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
        firstItem.focusId = 'descendant:1:' + firstId;
        firstItem.path = path.length === 2 ? path.slice() : [model.root.id, firstId];
        firstMap[firstId] = { id: firstId, item: firstItem, terminals: [], partner: null };
      }
      if (path.length > 2) firstMap[firstId].terminals.push(descendant);
      var firstLink = descendant.links && descendant.links[0];
      if (firstLink && firstLink.partner && !firstMap[firstId].partner) {
        var partner = getNode(firstLink.partner, model.root.lookupId);
        partner.group = 'partner';
        partner.focusId = 'partner:' + partner.id;
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

  function packFamilies(groups, availableWidth) {
    var rows = [];
    var gap = 16;
    var row = { groups: [], width: 0, height: 0 };
    groups.forEach(function (group) {
      var widestLevel = group.entries.length;
      group.entries.forEach(function (entry) {
        widestLevel = Math.max(widestLevel, entry.terminals.length);
      });
      group.layoutWidth = Math.min(availableWidth, Math.max(172, widestLevel * 158));
      var needed = group.layoutWidth + (row.groups.length ? gap : 0);
      if (row.groups.length && row.width + needed > availableWidth) {
        rows.push(row);
        row = { groups: [], width: 0, height: 0 };
        needed = group.layoutWidth;
      }
      row.groups.push(group);
      row.width += needed;
      row.height = Math.max(row.height, group.entries.some(function (entry) {
        return entry.terminals.length > 0;
      }) ? 202 : 130);
    });
    if (row.groups.length) rows.push(row);
    return rows;
  }

  function pairPath(from, to) {
    var startY = from.y + from.height / 2;
    var endY = to.y - to.height / 2;
    var middleY = (startY + endY) / 2;
    return [
      { x: from.x, y: startY },
      { x: from.x, y: middleY },
      { x: to.x, y: middleY },
      { x: to.x, y: endY }
    ];
  }

  function renderLens(model) {
    var width = 1180;
    var edgePadding = 38;
    var contentWidth = width - edgePadding * 2;
    var rootX = width / 2;
    var hasAncestors = model.ancestors.length > 0;
    var rootY = hasAncestors ? 326 : 88;
    var cursorY = rootY + 118;
    var positions = {};
    var structure = descendantStructure(model);
    var descendantFamilies = descendantGroups(structure, model.root.id);
    var siblingGroups = [];
    var siblingMap = {};
    var siblingColumns = Math.max(1, Math.floor(contentWidth / 168));

    model.root.pathFocusIds = [model.root.focusId];
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
      cursorY += 48 + Math.ceil(group.items.length / siblingColumns) * 74;
    });
    var familyRows = packFamilies(descendantFamilies, contentWidth);
    if (familyRows.length) {
      cursorY += 20;
      familyRows.forEach(function (row) { cursorY += row.height; });
    }
    if (model.breeding.length) {
      cursorY += 56 + Math.ceil(model.breeding.length / siblingColumns) * 102;
    }
    var height = Math.max(rootY + 92, cursorY + 34);

    stage.style.width = width + 'px';
    stage.style.height = height + 'px';
    var svg = createSvg(width, height);

    var orbit = document.createElement('div');
    orbit.className = 'root-orbit';
    orbit.style.left = (rootX - 116) + 'px';
    orbit.style.top = (rootY - 91) + 'px';
    stage.appendChild(orbit);

    if (hasAncestors) {
      var ancestorYs = { 3: 50, 2: 136, 1: 222 };
      [3, 2, 1].forEach(function (generation) {
        var row = model.ancestors.filter(function (item) { return item.generation === generation; });
        var spacing = row.length > 1 ? (width - 142) / (row.length - 1) : 0;
        var xs = spread(row.length, rootX, spacing);
        row.forEach(function (item, index) {
          positions['a' + (generation - 1) + '_' + item.index] = createNode(
            item, xs[index], ancestorYs[generation]
          );
        });
      });
    }
    positions.root = createNode(model.root, rootX, rootY, { root: true, hideTag: true });

    [0, 1].forEach(function (index) {
      var parent = positions['a0_' + index];
      if (!parent) return;
      var focusIds = model.ancestors.filter(function (item) {
        return Math.floor(item.index / Math.pow(2, item.generation - 1)) === index;
      }).map(function (item) { return item.focusId; });
      var points = pairPath(parent, positions.root);
      addRoundedPath(svg, points, 'ancestor', [parent.item.id, model.root.id], 14);
      addFocusPath(svg, points, 'ancestor', focusIds, 14);
    });
    [0, 1, 2, 3].forEach(function (index) {
      var ancestor = positions['a1_' + index];
      var child = positions['a0_' + Math.floor(index / 2)];
      if (!ancestor || !child) return;
      var focusIds = model.ancestors.filter(function (item) {
        return item.generation >= 2 &&
          Math.floor(item.index / Math.pow(2, item.generation - 2)) === index;
      }).map(function (item) { return item.focusId; });
      var points = pairPath(ancestor, child);
      addRoundedPath(svg, points, 'ancestor', [ancestor.item.id, child.item.id], 14);
      addFocusPath(svg, points, 'ancestor', focusIds, 14);
    });
    for (var ancestorIndex = 0; ancestorIndex < 8; ancestorIndex++) {
      var oldest = positions['a2_' + ancestorIndex];
      var next = positions['a1_' + Math.floor(ancestorIndex / 2)];
      if (!oldest || !next) continue;
      var points = pairPath(oldest, next);
      addRoundedPath(svg, points, 'ancestor', [oldest.item.id, next.item.id], 14);
      addFocusPath(svg, points, 'ancestor', [oldest.item.focusId], 14);
    }

    var sectionY = rootY + 118;
    siblingGroups.forEach(function (group) {
      createGroupLabel(group.title, group.items.length, edgePadding, sectionY, contentWidth);
      sectionY += 40;
      var rows = Math.ceil(group.items.length / siblingColumns);
      for (var rowIndex = 0; rowIndex < rows; rowIndex++) {
        var rowItems = group.items.slice(rowIndex * siblingColumns, (rowIndex + 1) * siblingColumns);
        var rowXs = spread(rowItems.length, rootX, rowItems.length > 1 ? 168 : 0);
        var busY = sectionY + rowIndex * 74;
        var nodeY = busY + 34;
        if (rowXs.length > 1) {
          addRoundedPath(svg, [
            { x: rowXs[0], y: busY },
            { x: rowXs[rowXs.length - 1], y: busY }
          ], 'sibling', group.items.map(function (item) { return item.id; }), 12);
        }
        rowItems.forEach(function (item, itemIndex) {
          var node = createNode(item, rowXs[itemIndex], nodeY, { hideTag: true });
          addRoundedPath(svg, [
            { x: rowXs[itemIndex], y: busY },
            { x: rowXs[itemIndex], y: nodeY - node.height / 2 }
          ], 'sibling', [model.root.id, item.id], 12);
          addFocusPath(svg, [
            { x: rowXs[0], y: busY },
            { x: rowXs[itemIndex], y: busY },
            { x: rowXs[itemIndex], y: nodeY - node.height / 2 }
          ], 'sibling', [item.focusId], 12);
        });
      }
      sectionY += rows * 74 + 8;
    });
    if (familyRows.length) sectionY += 12;
    familyRows.forEach(function (row) {
      var rowStart = (width - row.width) / 2;
      var xCursor = rowStart;
      var rowTop = sectionY;
        var rowBusY = rowTop + 36;
      row.groups.forEach(function (group, groupIndex) {
        if (groupIndex) xCursor += 16;
        var groupX = xCursor + group.layoutWidth / 2;
        var childXs = spread(group.entries.length, groupX, group.entries.length > 1 ? 158 : 0);
        var childBusY = rowTop + 50;
        var childY = rowTop + 86;
        var groupFocusIds = [];
        group.entries.forEach(function (entry) {
          groupFocusIds.push(entry.item.focusId);
          entry.terminals.forEach(function (terminal) { groupFocusIds.push(terminal.focusId); });
        });
        if (group.partner) {
          group.partner.pathFocusIds = [model.root.focusId, group.partner.focusId].concat(groupFocusIds);
          addPartnerChip(group.partner, groupX, rowTop);
          addRoundedPath(svg, [
            { x: groupX, y: rowTop + 30 },
            { x: groupX, y: childBusY }
          ], 'partner ' + group.partner.parentRole, group.ids, 12);
          addFocusPath(svg, [
            { x: groupX, y: rowTop + 30 },
            { x: groupX, y: childBusY }
          ], 'partner ' + group.partner.parentRole, [group.partner.focusId], 12);
        }
        if (!group.partner) {
          addRoundedPath(svg, [
            { x: groupX, y: rowBusY },
            { x: groupX, y: childBusY }
          ], 'descendant', group.ids, 12);
        }
        if (childXs.length > 1) {
          addRoundedPath(svg, [
            { x: childXs[0], y: childBusY },
            { x: childXs[childXs.length - 1], y: childBusY }
          ], 'descendant', group.ids, 12);
        }
        group.entries.forEach(function (entry, entryIndex) {
          var childX = childXs[entryIndex];
          var childNode = createNode(entry.item, childX, childY);
          var partnerFocus = group.partner ? [group.partner.focusId] : [];
          var terminalFocus = entry.terminals.map(function (terminal) { return terminal.focusId; });
          entry.item.pathFocusIds = [model.root.focusId, entry.item.focusId].concat(partnerFocus);
          entry.terminals.forEach(function (terminal) {
            terminal.pathFocusIds = [model.root.focusId, entry.item.focusId, terminal.focusId].concat(partnerFocus);
          });
          addRoundedPath(svg, [
            { x: childX, y: childBusY },
            { x: childX, y: childY - childNode.height / 2 }
          ], 'descendant', [model.root.id, entry.id], 12);
          addFocusPath(svg, [
            { x: groupX, y: group.partner ? rowTop + 30 : rowBusY },
            { x: groupX, y: childBusY },
            { x: childX, y: childBusY },
            { x: childX, y: childY - childNode.height / 2 }
          ], 'descendant', [entry.item.focusId].concat(terminalFocus, partnerFocus), 14);
          if (entry.terminals.length) {
            var terminalBusY = rowTop + 130;
            var terminalY = rowTop + 168;
            var terminalXs = spread(entry.terminals.length, childX,
              entry.terminals.length > 1 ? 158 : 0);
            addRoundedPath(svg, [
              { x: childX, y: childY + childNode.height / 2 },
              { x: childX, y: terminalBusY }
            ], 'descendant', [entry.id], 12);
            if (terminalXs.length > 1) {
              addRoundedPath(svg, [
                { x: terminalXs[0], y: terminalBusY },
                { x: terminalXs[terminalXs.length - 1], y: terminalBusY }
              ], 'descendant', [entry.id], 12);
            }
            entry.terminals.forEach(function (terminal, terminalIndex) {
              var terminalNode = createNode(terminal, terminalXs[terminalIndex], terminalY);
              addRoundedPath(svg, [
                { x: terminalXs[terminalIndex], y: terminalBusY },
                { x: terminalXs[terminalIndex], y: terminalY - terminalNode.height / 2 }
              ], 'descendant', [entry.id, terminal.id], 12);
              addFocusPath(svg, [
                { x: childX, y: childY + childNode.height / 2 },
                { x: childX, y: terminalBusY },
                { x: terminalXs[terminalIndex], y: terminalBusY },
                { x: terminalXs[terminalIndex], y: terminalY - terminalNode.height / 2 }
              ], 'descendant', [terminal.focusId], 14);
            });
          }
        });
        xCursor += group.layoutWidth;
      });
      sectionY += row.height;
    });
    if (model.breeding.length) {
      sectionY += 22;
      createGroupLabel('繁育记录', model.breeding.length, edgePadding, sectionY, contentWidth);
      sectionY += 40;
      var breedingRows = Math.ceil(model.breeding.length / siblingColumns);
      for (var breedingRow = 0; breedingRow < breedingRows; breedingRow++) {
        var breedingItems = model.breeding.slice(
          breedingRow * siblingColumns, (breedingRow + 1) * siblingColumns
        );
        var breedingXs = spread(breedingItems.length, rootX,
          breedingItems.length > 1 ? 190 : 0);
        var breedingBusY = sectionY + breedingRow * 102;
        if (breedingXs.length > 1) {
          addRoundedPath(svg, [
            { x: breedingXs[0], y: breedingBusY },
            { x: breedingXs[breedingXs.length - 1], y: breedingBusY }
          ], 'breeding', breedingItems.map(function (item) { return item.id; }), 12);
        }
        breedingItems.forEach(function (item, itemIndex) {
          var nodeY = breedingBusY + 50;
          var node = createNode(item, breedingXs[itemIndex], nodeY);
          item.pathFocusIds = [model.root.focusId, item.focusId];
          addRoundedPath(svg, [
            { x: breedingXs[itemIndex], y: breedingBusY },
            { x: breedingXs[itemIndex], y: nodeY - node.height / 2 }
          ], 'breeding', [model.root.id, item.id], 12);
          addFocusPath(svg, [
            { x: breedingXs[0], y: breedingBusY },
            { x: breedingXs[itemIndex], y: breedingBusY },
            { x: breedingXs[itemIndex], y: nodeY - node.height / 2 }
          ], 'breeding', [item.focusId], 12);
        });
      }
    }
    return { width: width, height: height };
  }

  function syncEmbeddedHeight() {
    if (embedded && window.parent !== window) {
      window.parent.postMessage({
        type: 'uma-pedigree-height',
        sample: state.sample,
        height: Math.ceil(workspace.getBoundingClientRect().height)
      }, '*');
    }
  }

  function layoutStage() {
    var width = parseFloat(stage.style.width) || 1;
    var height = parseFloat(stage.style.height) || 1;
    var mobile = window.innerWidth <= 760;
    var padding = mobile ? 6 : 12;
    var scale = Math.min(1,
      (viewport.clientWidth - padding * 2) / width,
      (viewport.clientHeight - padding * 2) / height
    );
    var tx = Math.max(padding, (viewport.clientWidth - width * scale) / 2);
    var ty = Math.max(padding, (viewport.clientHeight - height * scale) / 2);
    stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
    syncEmbeddedHeight();
  }

  function render() {
    currentModel = buildModel(state.sample);
    stage.innerHTML = '';
    state.lockedItem = null;
    state.lockedKey = '';
    closeSheet();
    document.getElementById('workspace-title').textContent = currentModel.root.name + '的血统关系';
    var summary = [currentModel.ancestors.length ? '三代血统' : '血统资料始于本马'];
    if (currentModel.siblings.length) summary.push(currentModel.siblings.length + '位同辈角色');
    if (currentModel.descendants.length) summary.push(currentModel.descendants.length + '位后代角色');
    if (currentModel.breeding.length) summary.push(currentModel.breeding.length + '位繁育角色');
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
    if (event.key !== 'Tab' || !sheet.classList.contains('is-open')) return;
    var focusable = sheet.querySelectorAll('button:not([disabled]),a[href]');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
