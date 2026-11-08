/* Iris interactive viewer — everything opens collapsed and expands one level per click.
 * Graph diagrams (class, component, activity, state, ER) are laid out with ELK.
 * Sequence diagrams use their own lifeline renderer.
 * Design derived from code-flow-graph (MIT); see NOTICE. */
(function () {
  'use strict';

  var DATA = window.IRIS_DATA;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var elk = new ELK();
  var $ = function (id) { return document.getElementById(id); };
  var svg = $('canvas'), viewport = $('viewport'), defs = $('defs');
  var states = {};          // diagramId -> { expanded: Set, view: {x,y,k}, fitted: bool }
  var current = null;       // { d, st }
  var renderToken = 0;

  // ---------- text measuring ----------
  var mctx = document.createElement('canvas').getContext('2d');
  var rootStyle = getComputedStyle(document.documentElement);
  var FONT = getComputedStyle(document.body).fontFamily;
  var MONO = rootStyle.getPropertyValue('--mono') || 'monospace';
  function tw(text, size, weight, mono) {
    mctx.font = (weight || 400) + ' ' + (size || 13) + 'px ' + (mono ? MONO : FONT);
    return Math.ceil(mctx.measureText(String(text)).width);
  }

  // ---------- svg helpers ----------
  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, 'class': cls, 'text-anchor': anchor || 'start' }, parent);
    t.textContent = s;
    return t;
  }
  function label(e) { return e.label || e.id; }
  function plural(n, noun) { return n + ' ' + (n === 1 ? noun.replace(/s$/, '') : noun); }

  // ---------- markers ----------
  function marker(id, vb, refX, refY, w, h, build) {
    var m = el('marker', { id: id, viewBox: vb, refX: refX, refY: refY, markerWidth: w, markerHeight: h,
      markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' }, defs);
    build(m);
  }
  function buildMarkers() {
    defs.innerHTML = '';
    marker('m-arrow', '0 0 10 10', 10, 5, 10, 10, function (m) { el('path', { d: 'M0,0 L10,5 L0,10 z', 'class': 'marker-fill' }, m); });
    marker('m-open', '0 0 10 10', 10, 5, 10, 10, function (m) { el('path', { d: 'M0,0 L10,5 L0,10', 'class': 'marker-line' }, m); });
    marker('m-tri', '0 0 14 14', 14, 7, 14, 14, function (m) { el('path', { d: 'M1,1 L14,7 L1,13 z', 'class': 'marker-hollow' }, m); });
    marker('m-dia-filled', '0 0 18 10', 18, 5, 18, 10, function (m) { el('path', { d: 'M0,5 L9,0 L18,5 L9,10 z', 'class': 'marker-fill' }, m); });
    marker('m-dia-hollow', '0 0 18 10', 18, 5, 18, 10, function (m) { el('path', { d: 'M0,5 L9,0 L18,5 L9,10 z', 'class': 'marker-hollow' }, m); });
    // ER crow's-foot markers; tip (node side) at x=20
    marker('m-one', '0 0 20 12', 20, 6, 20, 12, function (m) { el('path', { d: 'M0,6 H20 M12,0 V12 M16,0 V12', 'class': 'marker-line' }, m); });
    marker('m-zero-one', '0 0 20 12', 20, 6, 20, 12, function (m) {
      el('path', { d: 'M8,6 H20 M15,0 V12', 'class': 'marker-line' }, m);
      el('circle', { cx: 4.5, cy: 6, r: 3.5, 'class': 'marker-hollow' }, m);
    });
    marker('m-zero-many', '0 0 20 12', 20, 6, 20, 12, function (m) {
      el('path', { d: 'M8,6 H20 M11,6 L20,0 M11,6 L20,12', 'class': 'marker-line' }, m);
      el('circle', { cx: 4.5, cy: 6, r: 3.5, 'class': 'marker-hollow' }, m);
    });
    marker('m-one-many', '0 0 20 12', 20, 6, 20, 12, function (m) { el('path', { d: 'M0,6 H20 M8,0 V12 M11,6 L20,0 M11,6 L20,12', 'class': 'marker-line' }, m); });
  }
  function cardMarker(card) {
    if (!card) return null;
    var c = String(card).trim().toLowerCase();
    if (c === '1' || c === '1..1' || c === 'one') return 'm-one';
    if (c === '0..1' || c === '?') return 'm-zero-one';
    if (c === '1..*' || c === '1..n' || c === '+') return 'm-one-many';
    if (c === '*' || c === '0..*' || c === 'n' || c === 'many' || c === '0..n') return 'm-zero-many';
    return null;
  }
  var EDGE_STYLE = {
    inheritance: { end: 'm-tri' }, realization: { end: 'm-tri', dashed: true },
    association: { end: 'm-open' }, aggregation: { start: 'm-dia-hollow' }, composition: { start: 'm-dia-filled' },
    dependency: { end: 'm-open', dashed: true },
    uses: { end: 'm-arrow' }, calls: { end: 'm-arrow' }, reads: { end: 'm-arrow' }, writes: { end: 'm-arrow' },
    publishes: { end: 'm-arrow', dashed: true }, subscribes: { end: 'm-arrow', dashed: true },
    flow: { end: 'm-arrow' }, transition: { end: 'm-arrow' }, relationship: {}
  };

  // ---------- graph model ----------
  var CLASSLIKE = { 'class': 1, 'interface': 1, 'abstract': 1, 'enum': 1, 'record': 1, 'annotation': 1, table: 1, view: 1 };
  var CHILD_NOUN = { 'class': 'types', component: 'parts', activity: 'steps', state: 'states', er: 'tables' };
  var MEMBER_NOUN = { er: 'columns' };

  function graphModel(d) {
    if (d._model) return d._model;
    var byId = {}, children = {}, roots = [];
    d.elements.forEach(function (e) { byId[e.id] = e; });
    d.elements.forEach(function (e) {
      if (e.parent && byId[e.parent]) (children[e.parent] = children[e.parent] || []).push(e);
      else roots.push(e);
    });
    d._model = { byId: byId, children: children, roots: roots };
    return d._model;
  }
  function hasKids(m, e) { return !!(m.children[e.id] && m.children[e.id].length); }
  function hasMembers(e) { return !!(e.members && e.members.length); }
  function expandable(m, e) { return hasKids(m, e) || hasMembers(e); }
  function chain(m, id) {
    var out = [], cur = m.byId[id];
    while (cur) { out.unshift(cur); cur = cur.parent ? m.byId[cur.parent] : null; }
    return out;
  }
  // Nearest element on the path from the root that is currently visible.
  function visibleRep(m, st, id) {
    var c = chain(m, id);
    var rep = c[0];
    for (var i = 1; i < c.length; i++) {
      if (st.expanded.has(c[i - 1].id)) rep = c[i]; else break;
    }
    return rep;
  }
  function isAncestor(m, a, b) { // a is ancestor of b
    var cur = m.byId[b];
    while (cur && cur.parent) { if (cur.parent === a) return true; cur = m.byId[cur.parent]; }
    return false;
  }

  // ---------- node measuring ----------
  function visSym(v) { return v === 'public' ? '+' : v === 'private' ? '−' : v === 'protected' ? '#' : v === 'package' ? '~' : ''; }
  function memberText(d, mem) {
    if (d.type === 'er' || mem.kind === 'column') return mem.name + (mem.type ? '  ' + mem.type : '');
    if (mem.kind === 'literal') return mem.name;
    var s = visSym(mem.visibility);
    s = s ? s + ' ' : '';
    if (mem.kind === 'method' || mem.kind === 'constructor') {
      return s + mem.name + '(' + (mem.params || '') + ')' + (mem.type ? ': ' + mem.type : '');
    }
    return s + mem.name + (mem.type ? ': ' + mem.type : '');
  }
  function stereoText(e) {
    if (e.stereotype) return '«' + e.stereotype + '»';
    if (e.kind === 'interface' || e.kind === 'enum' || e.kind === 'abstract' || e.kind === 'record' || e.kind === 'annotation' || e.kind === 'view') return '«' + e.kind + '»';
    return null;
  }
  function memberSections(d, e) {
    var mem = e.members || [];
    if (d.type === 'er' || e.kind === 'table' || e.kind === 'view') return [mem];
    var f = mem.filter(function (x) { return x.kind !== 'method' && x.kind !== 'constructor'; });
    var me = mem.filter(function (x) { return x.kind === 'method' || x.kind === 'constructor'; });
    return [f, me].filter(function (s) { return s.length; });
  }
  var ROW = 18, BADGE_W = 24;

  function measure(d, m, st, e) {
    var open = st.expanded.has(e.id);
    var k = e.kind;
    var name = label(e);
    if (CLASSLIKE[k]) {
      var st0 = stereoText(e);
      var w = Math.max(tw(name, 13, 650), st0 ? tw(st0, 11) : 0);
      var head = 12 + (st0 ? 15 : 0) + 18;
      var h = head;
      if (hasMembers(e)) {
        if (open) {
          var badge = (d.type === 'er') ? BADGE_W : 0;
          memberSections(d, e).forEach(function (sec) {
            h += 6;
            sec.forEach(function (mem) { w = Math.max(w, badge + tw(memberText(d, mem), 12, 400, true)); h += ROW; });
            h += 4;
          });
        } else {
          var tl = '▸ ' + plural(e.members.length, MEMBER_NOUN[d.type] || 'members');
          w = Math.max(w, tw(tl, 11, 650));
          h += 22;
        }
      }
      return { w: Math.max(130, w + 26), h: h + 2 };
    }
    if (hasKids(m, e) && !open) { // collapsed container
      var count = m.children[e.id].length;
      var tl2 = '▸ ' + plural(count, CHILD_NOUN[d.type] || 'items');
      var w2 = Math.max(tw(name, 13, 650), tw(tl2, 11, 650)) + 32;
      return { w: Math.max(120, w2), h: (k === 'package' ? 58 : 50) + (e.stereotype ? 14 : 0) };
    }
    switch (k) {
      case 'start': case 'initial': return { w: 24, h: 24 };
      case 'end': case 'final': return { w: 26, h: 26 };
      case 'history': return { w: 26, h: 26 };
      case 'fork': case 'join':
        return (d.direction === 'RIGHT' || d.direction === 'LEFT') ? { w: 8, h: 70 } : { w: 90, h: 8 };
      case 'decision': case 'merge': case 'choice':
        if (!e.label) return { w: 30, h: 30 };
        return { w: Math.max(60, tw(name, 12) + 64), h: 50 };
      case 'actor': return { w: Math.max(44, tw(name, 12) + 8), h: 66 };
      case 'database': return { w: Math.max(90, tw(name, 13, 650) + 30), h: 58 };
      case 'queue': return { w: Math.max(100, tw(name, 13, 650) + 44), h: 42 };
      case 'note': return { w: tw(name, 12) + 28, h: 32 };
      default: {
        var sw = e.stereotype ? tw('«' + e.stereotype + '»', 11) : 0;
        var icon = k === 'component' ? 26 : 0;
        return { w: Math.max(90, Math.max(tw(name, 13, 600), sw) + 28 + icon), h: e.stereotype ? 48 : 36 };
      }
    }
  }

  // ---------- ELK graph ----------
  function buildElk(d, m, st) {
    var dir = d.direction || (d.type === 'component' || d.type === 'er' ? 'RIGHT' : 'DOWN');
    var root = {
      id: '__root',
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': dir,
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '48',
        'elk.spacing.edgeNode': '18', 'elk.spacing.edgeEdge': '12',
        'elk.edgeLabels.placement': 'CENTER', 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.padding': '[top=24,left=24,bottom=24,right=24]',
        'elk.layered.thoroughness': '3'
      },
      children: [], edges: []
    };
    function add(e, parentArr) {
      var open = st.expanded.has(e.id);
      if (hasKids(m, e) && open) {
        var top = 34 + (e.stereotype ? 14 : 0);
        var n = { id: e.id, layoutOptions: { 'elk.padding': '[top=' + top + ',left=16,bottom=16,right=16]',
          'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': '(' + (tw(label(e), 12, 650) + 50) + ',60)' }, children: [] };
        m.children[e.id].forEach(function (c) { add(c, n.children); });
        parentArr.push(n);
      } else {
        var s = measure(d, m, st, e);
        parentArr.push({ id: e.id, width: s.w, height: s.h });
      }
    }
    m.roots.forEach(function (e) { add(e, root.children); });

    var agg = {};
    (d.relations || []).forEach(function (r) {
      if (!m.byId[r.from] || !m.byId[r.to]) return;
      var a = visibleRep(m, st, r.from), b = visibleRep(m, st, r.to);
      if (a.id === b.id || isAncestor(m, a.id, b.id) || isAncestor(m, b.id, a.id)) return;
      var key = a.id + '\u0000' + b.id + '\u0000' + r.kind;
      var direct = (a.id === r.from && b.id === r.to);
      if (!agg[key]) agg[key] = { from: a.id, to: b.id, kind: r.kind, rels: [], direct: true };
      agg[key].rels.push(r);
      if (!direct) agg[key].direct = false;
    });
    var edges = [], i = 0;
    Object.keys(agg).forEach(function (key) {
      var g = agg[key];
      var r0 = g.rels[0];
      var text = null;
      if (g.rels.length > 1) text = '×' + g.rels.length + (r0.label && g.rels.every(function (r) { return r.label === r0.label; }) ? ' ' + r0.label : '');
      else if (r0.label) text = r0.label;
      var info = { id: 'e' + (i++), from: g.from, to: g.to, kind: g.kind, text: text, count: g.rels.length,
        fromCard: g.rels.length === 1 && g.direct ? r0.fromCard : null, toCard: g.rels.length === 1 && g.direct ? r0.toCard : null };
      var ee = { id: info.id, sources: [g.from], targets: [g.to] };
      if (text) ee.labels = [{ text: text, width: tw(text, 11) + 6, height: 14 }];
      root.edges.push(ee);
      edges.push(info);
    });
    return { graph: root, edges: edges };
  }

  // ---------- graph rendering ----------
  function renderGraph(d, st, anchorId) {
    var m = graphModel(d);
    var built = buildElk(d, m, st);
    var token = ++renderToken;
    var busyTimer = setTimeout(function () { $('busy').hidden = false; }, 150);
    return elk.layout(built.graph).then(function (res) {
      clearTimeout(busyTimer); $('busy').hidden = true;
      if (token !== renderToken) return;
      var before = anchorId && current && current.positions ? current.positions[anchorId] : null;
      viewport.innerHTML = '';
      var lc = el('g', { 'class': 'layer-containers' }, viewport);
      var le = el('g', { 'class': 'layer-edges' }, viewport);
      var ln = el('g', { 'class': 'layer-nodes' }, viewport);
      var abs = { __root: { x: 0, y: 0 } }, positions = {};
      (function walk(n, ox, oy) {
        (n.children || []).forEach(function (c) {
          var x = ox + c.x, y = oy + c.y;
          abs[c.id] = { x: x, y: y };
          positions[c.id] = { x: x, y: y, w: c.width, h: c.height };
          var e = m.byId[c.id];
          if (e) drawNode(d, m, st, e, x, y, c.width, c.height, (c.children && c.children.length) || (hasKids(m, e) && st.expanded.has(e.id)) ? lc : ln);
          walk(c, x, y);
        });
      })(res, 0, 0);
      var info = {};
      built.edges.forEach(function (e) { info[e.id] = e; });
      (res.edges || []).forEach(function (e) {
        var o = abs[e.container] || abs.__root;
        drawEdge(d, info[e.id], e, o.x, o.y, le);
      });
      current.positions = positions;
      current.size = { w: res.width, h: res.height };
      if (!st.fitted) { fit(); st.fitted = true; }
      else if (before && positions[anchorId]) {
        var after = positions[anchorId];
        st.view.x += (before.x - after.x) * st.view.k;
        st.view.y += (before.y - after.y) * st.view.k;
        applyView();
      } else applyView();
    }).catch(function (err) {
      clearTimeout(busyTimer); $('busy').hidden = true;
      showError('Layout failed: ' + (err && err.message ? err.message : err));
    });
  }

  function nodeGroup(d, m, st, e, parent, x, y) {
    var exp = expandable(m, e);
    var open = st.expanded.has(e.id);
    var g = el('g', { 'class': 'node k-' + e.kind + (exp ? ' expandable' : ''), transform: 'translate(' + x + ',' + y + ')',
      'data-id': e.id }, parent);
    if (exp) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-expanded', open ? 'true' : 'false');
      g.setAttribute('aria-label', label(e) + (open ? ', expanded' : ', collapsed'));
    }
    var tip = label(e) + (e.source && e.source.file ? '\n' + e.source.file + (e.source.line ? ':' + e.source.line : '') : '') + (e.note ? '\n' + e.note : '');
    el('title', {}, g).textContent = tip;
    return g;
  }

  function drawNode(d, m, st, e, x, y, w, h, layer) {
    var open = st.expanded.has(e.id);
    var k = e.kind, name = label(e);
    if (hasKids(m, e) && open) {
      var gc = nodeGroup(d, m, st, e, layer, x, y);
      gc.classList.add('container');
      if (k === 'package') {
        var tab = Math.min(w - 10, tw(name, 12, 650) + 34);
        el('path', { d: 'M0,10 V' + h + ' H' + w + ' V10 H' + tab + ' L' + (tab - 6) + ',0 H0 Z', 'class': 'body' }, gc);
      } else {
        el('rect', { width: w, height: h, rx: k === 'subflow' || k === 'composite' ? 12 : 6, 'class': 'body' }, gc);
      }
      var ty = k === 'package' ? 26 : 20;
      if (e.stereotype) { txt(gc, 12, ty, '«' + e.stereotype + '»', 'stereo'); ty += 14; }
      var tt = txt(gc, 12, ty, '▾ ' + name, 'name');
      tt.classList.add('toggle-target');
      return;
    }
    var g = nodeGroup(d, m, st, e, layer, x, y);
    if (CLASSLIKE[k]) return drawClassLike(d, e, g, w, h, open);
    if (hasKids(m, e)) { // collapsed container
      if (k === 'package') {
        var tab2 = Math.min(w * 0.6, tw(name, 12, 650) * 0.5 + 30);
        el('path', { d: 'M0,10 V' + h + ' H' + w + ' V10 H' + tab2 + ' L' + (tab2 - 6) + ',0 H0 Z', 'class': 'body' }, g);
      } else el('rect', { width: w, height: h, rx: k === 'subflow' || k === 'composite' ? 12 : 6, 'class': 'body' }, g);
      var cy = k === 'package' ? 30 : 22;
      if (e.stereotype) { txt(g, w / 2, cy - 2, '«' + e.stereotype + '»', 'stereo', 'middle'); cy += 12; }
      txt(g, w / 2, cy, name, 'name', 'middle');
      txt(g, w / 2, cy + 18, '▸ ' + plural(m.children[e.id].length, CHILD_NOUN[d.type] || 'items'), 'toggle', 'middle');
      return;
    }
    switch (k) {
      case 'start': case 'initial': el('circle', { cx: w / 2, cy: h / 2, r: w / 2, 'class': 'filled' }, g); return;
      case 'end': case 'final':
        el('circle', { cx: w / 2, cy: h / 2, r: w / 2 - 1, 'class': 'ring' }, g);
        el('circle', { cx: w / 2, cy: h / 2, r: w / 2 - 6, 'class': 'filled' }, g); return;
      case 'history':
        el('circle', { cx: w / 2, cy: h / 2, r: w / 2 - 1, 'class': 'ring' }, g);
        txt(g, w / 2, h / 2 + 4, 'H', 'name', 'middle'); return;
      case 'fork': case 'join': el('rect', { width: w, height: h, rx: 2, 'class': 'bar' }, g); return;
      case 'decision': case 'merge': case 'choice':
        el('path', { d: 'M' + w / 2 + ',0 L' + w + ',' + h / 2 + ' L' + w / 2 + ',' + h + ' L0,' + h / 2 + ' Z', 'class': 'body' }, g);
        if (e.label) txt(g, w / 2, h / 2 + 4, name, 'meta', 'middle').setAttribute('style', 'font-size:12px;fill:var(--ink)');
        return;
      case 'actor': {
        var c = w / 2;
        el('circle', { cx: c, cy: 8, r: 7, 'class': 'body' }, g);
        el('path', { d: 'M' + c + ',15 V34 M' + (c - 12) + ',22 H' + (c + 12) + ' M' + c + ',34 L' + (c - 10) + ',48 M' + c + ',34 L' + (c + 10) + ',48', 'class': 'marker-line', style: 'stroke:var(--ink)' }, g);
        txt(g, c, 62, name, 'meta', 'middle').setAttribute('style', 'font-size:12px;fill:var(--ink)');
        return;
      }
      case 'database': {
        var ry = 7;
        el('path', { d: 'M0,' + ry + ' A' + w / 2 + ',' + ry + ' 0 0 1 ' + w + ',' + ry + ' V' + (h - ry) + ' A' + w / 2 + ',' + ry + ' 0 0 1 0,' + (h - ry) + ' Z', 'class': 'body' }, g);
        el('path', { d: 'M0,' + ry + ' A' + w / 2 + ',' + ry + ' 0 0 0 ' + w + ',' + ry, 'class': 'body', style: 'fill:none' }, g);
        txt(g, w / 2, h / 2 + 8, name, 'name', 'middle');
        return;
      }
      case 'queue': {
        var rx = 9;
        el('path', { d: 'M' + rx + ',0 H' + (w - rx) + ' A' + rx + ',' + h / 2 + ' 0 0 1 ' + (w - rx) + ',' + h + ' H' + rx + ' A' + rx + ',' + h / 2 + ' 0 0 1 ' + rx + ',0 Z', 'class': 'body' }, g);
        el('path', { d: 'M' + (w - rx) + ',0 A' + rx + ',' + h / 2 + ' 0 0 0 ' + (w - rx) + ',' + h, 'class': 'body', style: 'fill:none' }, g);
        txt(g, w / 2 - 4, h / 2 + 4, name, 'name', 'middle');
        return;
      }
      case 'note':
        el('path', { d: 'M0,0 H' + (w - 10) + ' L' + w + ',10 V' + h + ' H0 Z', 'class': 'body' }, g);
        txt(g, 12, h / 2 + 4, name, 'meta', 'start').setAttribute('style', 'font-size:12px;fill:var(--ink-2)');
        return;
      default: {
        var rr = (k === 'action' || k === 'state' || k === 'subflow' || k === 'composite') ? 12 : 4;
        el('rect', { width: w, height: h, rx: rr, 'class': 'body' }, g);
        if (k === 'component') { // UML component icon
          el('path', { d: 'M' + (w - 20) + ',7 h10 v12 h-10 z M' + (w - 23) + ',10 h6 M' + (w - 23) + ',15 h6', 'class': 'marker-line' }, g);
        }
        var yy = h / 2 + 5, mid = k === 'component' ? (w - 26) / 2 + 2 : w / 2;
        if (e.stereotype) { txt(g, mid, 18, '«' + e.stereotype + '»', 'stereo', 'middle'); yy = 36; }
        txt(g, mid, yy, name, 'name', 'middle');
      }
    }
  }

  function drawClassLike(d, e, g, w, h, open) {
    var st0 = stereoText(e);
    var head = 12 + (st0 ? 15 : 0) + 18;
    el('rect', { width: w, height: h, rx: 4, 'class': 'body' }, g);
    el('rect', { x: 1, y: 1, width: w - 2, height: head - 1, rx: 3, 'class': 'head' }, g);
    var y = 12;
    if (st0) { txt(g, w / 2, y + 9, st0, 'stereo', 'middle'); y += 15; }
    var nm = txt(g, w / 2, y + 13, label(e), 'name', 'middle');
    if (e.kind === 'abstract') nm.setAttribute('font-style', 'italic');
    if (!hasMembers(e)) return;
    var cy = head;
    if (!open) {
      el('line', { x1: 0, y1: cy, x2: w, y2: cy, 'class': 'sep' }, g);
      txt(g, 12, cy + 15, '▸ ' + plural(e.members.length, MEMBER_NOUN[d.type] || 'members'), 'toggle');
      return;
    }
    memberSections(d, e).forEach(function (sec) {
      el('line', { x1: 0, y1: cy, x2: w, y2: cy, 'class': 'sep' }, g);
      cy += 6;
      sec.forEach(function (mem) {
        var x = 12;
        if (d.type === 'er') {
          var b = mem.pk && mem.fk ? 'PF' : mem.pk ? 'PK' : mem.fk ? 'FK' : mem.unique ? 'UQ' : '';
          if (b) txt(g, x, cy + 13, b, 'member ' + (mem.pk ? 'pk' : 'fk'));
          x += BADGE_W;
        }
        var t = txt(g, x, cy + 13, memberText(d, mem), 'member' + (mem['static'] ? ' static' : '') + (mem['abstract'] ? ' abstract' : ''));
        var tip = [];
        if (mem.fk) tip.push('→ ' + mem.fk);
        if (mem.nullable === false) tip.push('NOT NULL');
        if (mem.note) tip.push(mem.note);
        if (tip.length) el('title', {}, t).textContent = tip.join('\n');
        cy += ROW;
      });
      cy += 4;
    });
  }

  function drawEdge(d, info, e, ox, oy, layer) {
    if (!info || !e.sections || !e.sections.length) return;
    var style = EDGE_STYLE[info.kind] || { end: 'm-arrow' };
    var g = el('g', { 'class': 'edge' + (style.dashed ? ' dashed' : '') }, layer);
    var pts = [];
    e.sections.forEach(function (s) {
      pts.push(s.startPoint);
      (s.bendPoints || []).forEach(function (p) { pts.push(p); });
      pts.push(s.endPoint);
    });
    var dstr = pts.map(function (p, i) { return (i ? 'L' : 'M') + (p.x + ox) + ',' + (p.y + oy); }).join(' ');
    var startM = style.start, endM = style.end;
    if (d.type === 'er') { startM = cardMarker(info.fromCard); endM = cardMarker(info.toCard); }
    el('path', { d: dstr, 'class': 'line', 'marker-start': startM ? 'url(#' + startM + ')' : null, 'marker-end': endM ? 'url(#' + endM + ')' : null }, g);
    if (info.count > 1) el('title', {}, g).textContent = info.count + ' ' + info.kind + ' relations';
    (e.labels || []).forEach(function (l) {
      var t = txt(g, l.x + ox + 3, l.y + oy + 11, l.text, info.count > 1 ? 'count' : '');
      t.setAttribute('class', info.count > 1 ? 'count' : '');
    });
    // Multiplicity text for class diagrams (ER uses crow's feet)
    if (d.type === 'class') {
      endLabel(g, pts, ox, oy, info.fromCard, true);
      endLabel(g, pts, ox, oy, info.toCard, false);
    } else if (d.type === 'er') {
      if (info.fromCard && !cardMarker(info.fromCard)) endLabel(g, pts, ox, oy, info.fromCard, true);
      if (info.toCard && !cardMarker(info.toCard)) endLabel(g, pts, ox, oy, info.toCard, false);
    }
  }
  function endLabel(g, pts, ox, oy, s, atStart) {
    if (!s || pts.length < 2) return;
    var a = atStart ? pts[0] : pts[pts.length - 1];
    var b = atStart ? pts[1] : pts[pts.length - 2];
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len; dy /= len;
    var x = a.x + ox + dx * 14 - dy * 10, y = a.y + oy + dy * 14 + dx * 10 + 4;
    txt(g, x, y, s, '', 'middle');
  }

  // ---------- sequence ----------
  function seqModel(d) {
    if (d._seq) return d._seq;
    var idx = {};
    d.participants.forEach(function (p, i) { idx[p.id] = i; });
    function assign(msgs, prefix) {
      msgs.forEach(function (msg, i) {
        msg._id = prefix + i;
        if (msg.children) assign(msg.children, msg._id + '.');
      });
    }
    assign(d.messages, 'm');
    d._seq = { idx: idx };
    return d._seq;
  }
  function seqInitialExpanded(d, set) {
    (function walk(msgs) { msgs.forEach(function (msg) { if (msg.expanded) set.add(msg._id); if (msg.children) walk(msg.children); }); })(d.messages);
  }
  function renderSequence(d, st, anchorId) {
    var sm = seqModel(d);
    var before = anchorId && current.positions ? current.positions[anchorId] : null;
    var P = d.participants;
    // visible rows
    var rows = [];
    (function walk(msgs, depth, parentRow) {
      msgs.forEach(function (msg) {
        var row = { msg: msg, depth: depth, parent: parentRow, last: null };
        rows.push(row);
        if (msg.children && msg.children.length && st.expanded.has(msg._id)) walk(msg.children, depth + 1, row);
        row.last = rows[rows.length - 1];
      });
    })(d.messages, 0, null);

    var widths = P.map(function (p) { return Math.max(96, tw(p.label || p.id, 13, 650) + 30); });
    var cx = [];
    widths.forEach(function (w, i) { cx[i] = i === 0 ? w / 2 + 24 : cx[i - 1] + widths[i - 1] / 2 + w / 2 + 36; });
    function msgText(msg) {
      var kids = msg.children && msg.children.length;
      var open = kids && st.expanded.has(msg._id);
      return (kids ? (open ? '▾ ' : '▸ ') : '') + msg.label + (kids && !open ? '  (+' + msg.children.length + ')' : '');
    }
    function shift(from, delta) { for (var j = from; j < cx.length; j++) cx[j] += delta; }
    for (var pass = 0; pass < 2; pass++) {
      rows.forEach(function (r) {
        var a = sm.idx[r.msg.from], b = sm.idx[r.msg.to];
        var need = tw(msgText(r.msg), 12) + 36;
        if (a === b) {
          if (a + 1 < cx.length && cx[a + 1] - cx[a] < need + 30) shift(a + 1, need + 30 - (cx[a + 1] - cx[a]));
          return;
        }
        var lo = Math.min(a, b), hi = Math.max(a, b);
        if (cx[hi] - cx[lo] < need) shift(hi, need - (cx[hi] - cx[lo]));
      });
    }
    var headH = 44, y = headH + 34, rowY = [];
    rows.forEach(function (r, i) {
      rowY[i] = y; r.y = y;
      y += (r.msg.from === r.msg.to ? 50 : 36) + (r.msg.note ? 26 : 0);
    });
    var totalH = y + 10;
    var maxX = cx[cx.length - 1] + widths[widths.length - 1] / 2 + 24;
    for (var q = 0; q < rows.length; q++) {
      var r0 = rows[q];
      if (r0.msg.from === r0.msg.to) maxX = Math.max(maxX, cx[sm.idx[r0.msg.from]] + tw(msgText(r0.msg), 12) + 60);
    }

    viewport.innerHTML = '';
    var gl = el('g', {}, viewport), ga = el('g', {}, viewport), gm = el('g', {}, viewport), gp = el('g', {}, viewport);
    P.forEach(function (p, i) {
      el('line', { x1: cx[i], y1: headH, x2: cx[i], y2: totalH, 'class': 'lifeline' }, gl);
      drawParticipant(gp, p, cx[i], widths[i], headH);
    });
    // activations
    var acts = [];
    rows.forEach(function (r) {
      var msg = r.msg;
      if (msg.kind === 'reply' || !msg.children || !msg.children.length || !st.expanded.has(msg._id)) return;
      acts.push({ p: sm.idx[msg.to], y1: r.y, y2: r.last.y + 10 });
    });
    acts.forEach(function (a) {
      var overlap = acts.filter(function (b) { return b !== a && b.p === a.p && b.y1 <= a.y1 && b.y2 >= a.y2 && acts.indexOf(b) < acts.indexOf(a); }).length;
      a.off = overlap * 5;
      el('rect', { x: cx[a.p] - 5 + a.off, y: a.y1, width: 10, height: Math.max(12, a.y2 - a.y1), 'class': 'activation' }, ga);
    });
    var positions = {};
    rows.forEach(function (r) {
      var msg = r.msg, a = sm.idx[msg.from], b = sm.idx[msg.to];
      var kids = msg.children && msg.children.length;
      var open = kids && st.expanded.has(msg._id);
      var g = el('g', { 'class': 'msg ' + (msg.kind || 'sync') + (kids ? ' expandable' : ''), 'data-id': msg._id }, gm);
      if (kids) {
        g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button');
        g.setAttribute('aria-expanded', open ? 'true' : 'false');
        g.setAttribute('aria-label', msg.label + (open ? ', expanded' : ', collapsed'));
      }
      var t = msgText(msg);
      var marker = msg.kind === 'async' || msg.kind === 'reply' ? 'url(#m-open)' : 'url(#m-arrow)';
      var x1 = cx[a], x2 = cx[b], yy = r.y;
      if (a === b) {
        el('rect', { x: x1 - 4, y: yy - 20, width: tw(t, 12) + 52, height: 44, rx: 4, 'class': 'hit' }, g);
        el('path', { d: 'M' + x1 + ',' + yy + ' h34 v16 h-29', 'marker-end': marker }, g);
        txt(g, x1 + 40, yy + 12, t);
      } else {
        var lo = Math.min(x1, x2), hi = Math.max(x1, x2);
        el('rect', { x: lo, y: yy - 20, width: hi - lo, height: 26, rx: 4, 'class': 'hit' }, g);
        var dir = x2 > x1 ? 1 : -1;
        el('line', { x1: x1 + dir * 5, y1: yy, x2: x2 - dir * 5, y2: yy, 'marker-end': marker }, g);
        txt(g, (x1 + x2) / 2, yy - 6, t, '', 'middle');
      }
      if (kids) g.querySelector('text').classList.add(open ? 'open' : 'toggle');
      if (msg.note) {
        var nx = Math.min(x1, x2) + 8, nw = tw(msg.note, 11) + 16;
        el('rect', { x: nx, y: yy + 8, width: nw, height: 20, rx: 3, 'class': 'note-box' }, g);
        txt(g, nx + 8, yy + 22, msg.note, 'note-text');
      }
      var tip = msg.source && msg.source.file ? msg.source.file + (msg.source.line ? ':' + msg.source.line : '') : null;
      if (tip) el('title', {}, g).textContent = tip;
      positions[msg._id] = { x: Math.min(x1, x2), y: yy, w: Math.abs(x2 - x1), h: 20 };
    });
    current.positions = positions;
    current.size = { w: maxX, h: totalH };
    if (!st.fitted) { fit(); st.fitted = true; }
    else if (before && positions[anchorId]) {
      st.view.y += (before.y - positions[anchorId].y) * st.view.k;
      applyView();
    } else applyView();
    return Promise.resolve();
  }
  function drawParticipant(g, p, cx, w, headH) {
    var k = p.kind || 'participant', name = p.label || p.id;
    var gg = el('g', { 'class': 'node k-' + k, transform: 'translate(' + (cx - w / 2) + ',0)' }, g);
    if (k === 'actor') {
      var c = w / 2;
      el('circle', { cx: c, cy: 7, r: 6, 'class': 'body' }, gg);
      el('path', { d: 'M' + c + ',13 V26 M' + (c - 10) + ',18 H' + (c + 10) + ' M' + c + ',26 L' + (c - 8) + ',34 M' + c + ',26 L' + (c + 8) + ',34', 'class': 'marker-line', style: 'stroke:var(--ink)' }, gg);
      txt(gg, c, 44, name, 'name', 'middle').setAttribute('style', 'font-size:12px');
      return;
    }
    if (k === 'database') {
      var ry = 6;
      el('path', { d: 'M0,' + ry + ' A' + w / 2 + ',' + ry + ' 0 0 1 ' + w + ',' + ry + ' V' + (headH - ry) + ' A' + w / 2 + ',' + ry + ' 0 0 1 0,' + (headH - ry) + ' Z', 'class': 'body' }, gg);
      el('path', { d: 'M0,' + ry + ' A' + w / 2 + ',' + ry + ' 0 0 0 ' + w + ',' + ry, 'class': 'body', style: 'fill:none' }, gg);
      txt(gg, w / 2, headH / 2 + 9, name, 'name', 'middle');
      return;
    }
    el('rect', { width: w, height: headH - 6, rx: 5, 'class': 'body' }, gg);
    var sub = k !== 'participant' ? '«' + k + '»' : null;
    if (sub) { txt(gg, w / 2, 15, sub, 'stereo', 'middle'); txt(gg, w / 2, 31, name, 'name', 'middle'); }
    else txt(gg, w / 2, headH / 2 + 2, name, 'name', 'middle');
  }

  // ---------- view: pan/zoom ----------
  function applyView() {
    var v = current.st.view;
    viewport.setAttribute('transform', 'translate(' + v.x + ',' + v.y + ') scale(' + v.k + ')');
  }
  function fit() {
    if (!current || !current.size) return;
    var r = svg.getBoundingClientRect();
    var W = r.width || 800, H = r.height || 600;
    var s = current.size;
    var k = Math.min((W - 40) / (s.w || 1), (H - 40) / (s.h || 1), 1.25);
    k = Math.max(k, 0.1);
    var v = current.st.view;
    v.k = k; v.x = (W - s.w * k) / 2; v.y = Math.max(20, (H - s.h * k) / 2);
    applyView();
  }
  function zoomAt(factor, px, py) {
    var v = current.st.view;
    var nk = Math.min(4, Math.max(0.08, v.k * factor));
    var f = nk / v.k;
    v.x = px - (px - v.x) * f; v.y = py - (py - v.y) * f; v.k = nk;
    applyView();
  }
  var pan = null, dragged = false;
  svg.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0) return;
    pan = { x: ev.clientX, y: ev.clientY, vx: current.st.view.x, vy: current.st.view.y, id: ev.pointerId };
    dragged = false;
  });
  svg.addEventListener('pointermove', function (ev) {
    if (!pan) return;
    var dx = ev.clientX - pan.x, dy = ev.clientY - pan.y;
    if (!dragged && Math.abs(dx) + Math.abs(dy) > 4) { dragged = true; svg.classList.add('panning'); svg.setPointerCapture(pan.id); }
    if (dragged) { current.st.view.x = pan.vx + dx; current.st.view.y = pan.vy + dy; applyView(); }
  });
  function endPan() { pan = null; svg.classList.remove('panning'); }
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', endPan);
  svg.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var r = svg.getBoundingClientRect();
    zoomAt(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });

  // ---------- interaction ----------
  function toggle(id) {
    var st = current.st;
    if (st.expanded.has(id)) st.expanded['delete'](id); else st.expanded.add(id);
    $('hint').hidden = true;
    render(id).then(function () {
      var n = viewport.querySelector('[data-id="' + cssEscape(id) + '"]');
      if (n && n.focus) { try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } }
    });
  }
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  svg.addEventListener('click', function (ev) {
    if (dragged) { dragged = false; return; }
    var t = ev.target.closest ? ev.target.closest('.expandable') : null;
    if (t && t.getAttribute('data-id')) toggle(t.getAttribute('data-id'));
  });
  svg.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if ((ev.key === 'Enter' || ev.key === ' ') && t.classList && t.classList.contains('expandable')) {
      ev.preventDefault(); toggle(t.getAttribute('data-id'));
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.target.tagName === 'INPUT') return;
    var r = svg.getBoundingClientRect();
    if (ev.key === '+' || ev.key === '=') zoomAt(1.2, r.width / 2, r.height / 2);
    else if (ev.key === '-') zoomAt(1 / 1.2, r.width / 2, r.height / 2);
    else if (ev.key === '0') fit();
  });
  $('zoom-in').onclick = function () { var r = svg.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); };
  $('zoom-out').onclick = function () { var r = svg.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); };
  $('fit').onclick = fit;
  $('collapse-all').onclick = function () { current.st.expanded.clear(); current.st.fitted = false; render(); };
  $('toggle-sidebar').onclick = function () { $('sidebar').classList.toggle('open'); };
  window.addEventListener('resize', function () { /* keep view; user can press Fit */ });

  // ---------- diagrams / navigation ----------
  function showError(msg) { var e = $('error'); e.textContent = msg; e.hidden = false; }
  function render(anchorId) {
    $('error').hidden = true;
    var d = current.d;
    return d.type === 'sequence' ? renderSequence(d, current.st, anchorId) : renderGraph(d, current.st, anchorId);
  }
  function stateFor(d) {
    if (!states[d.id]) {
      var set = new Set();
      if (d.type === 'sequence') { seqModel(d); seqInitialExpanded(d, set); }
      else d.elements.forEach(function (e) { if (e.expanded) set.add(e.id); });
      states[d.id] = { expanded: set, view: { x: 0, y: 0, k: 1 }, fitted: false };
    }
    return states[d.id];
  }
  function select(id) {
    var d = DATA.diagrams.filter(function (x) { return x.id === id; })[0] || DATA.diagrams[0];
    current = { d: d, st: stateFor(d), positions: null, size: null };
    $('diagram-title').textContent = d.title || d.id;
    $('diagram-desc').textContent = d.description || '';
    document.title = (d.title || d.id) + (DATA.title ? ' — ' + DATA.title : '');
    Array.prototype.forEach.call(document.querySelectorAll('#diagram-list button'), function (b) {
      b.setAttribute('aria-current', b.getAttribute('data-id') === d.id ? 'true' : 'false');
    });
    if (location.hash.slice(1) !== d.id) history.replaceState(null, '', '#' + encodeURIComponent(d.id));
    $('sidebar').classList.remove('open');
    render();
  }
  var TYPE_NAME = { 'class': 'Class', sequence: 'Sequence', activity: 'Activity', component: 'Component', state: 'State', er: 'ER' };
  function init() {
    buildMarkers();
    $('doc-title').textContent = DATA.title || 'Diagrams';
    var list = $('diagram-list');
    DATA.diagrams.forEach(function (d) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.setAttribute('data-id', d.id);
      var t1 = document.createElement('span'); t1.className = 'd-title'; t1.textContent = d.title || d.id;
      var t2 = document.createElement('span'); t2.className = 'd-type'; t2.textContent = TYPE_NAME[d.type] || d.type;
      b.appendChild(t1); b.appendChild(t2);
      b.onclick = function () { select(d.id); };
      li.appendChild(b); list.appendChild(li);
    });
    if (DATA.diagrams.length < 2) $('sidebar').style.display = 'none';
    var want = decodeURIComponent(location.hash.slice(1));
    select(want || DATA.diagrams[0].id);
  }

  // Test hooks (used by Iris's own browser tests)
  window.__iris = {
    toggle: function (id) { toggle(id); },
    select: function (id) { select(id); },
    visibleIds: function () {
      return Array.prototype.map.call(viewport.querySelectorAll('[data-id]'), function (n) { return n.getAttribute('data-id'); });
    }
  };

  try { init(); } catch (err) { showError('Iris could not start: ' + err.message); }
})();
