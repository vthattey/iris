// Mermaid → Iris. Supports classDiagram, sequenceDiagram, flowchart/graph, stateDiagram(-v2), erDiagram.
import { GraphBuilder, doc, stripQuotes, safeId, parseMember } from './util.js';

function lines(text) {
  return text
    .replace(/%%.*$/gm, '')
    .split(/\r?\n|;(?=\s*$)/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function importMermaid(text, name = 'diagram') {
  const ls = lines(text).filter((l) => !/^---|^title:|^config:/.test(l));
  const head = (ls[0] || '').toLowerCase();
  if (head.startsWith('classdiagram')) return doc(name, classDiagram(ls.slice(1), name));
  if (head.startsWith('sequencediagram')) return doc(name, sequenceDiagram(ls.slice(1), name));
  if (head.startsWith('flowchart') || head.startsWith('graph')) return doc(name, flowchart(ls, name));
  if (head.startsWith('statediagram')) return doc(name, stateDiagram(ls.slice(1), name));
  if (head.startsWith('erdiagram')) return doc(name, erDiagram(ls.slice(1), name));
  throw new Error(`Unsupported Mermaid diagram "${ls[0] || ''}". Supported: classDiagram, sequenceDiagram, flowchart, stateDiagram, erDiagram.`);
}

const DIRS = { TB: 'DOWN', TD: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' };

// ---------- class ----------
const CLASS_ARROWS = [
  ['<|--', 'inheritance', true], ['--|>', 'inheritance', false],
  ['<|..', 'realization', true], ['..|>', 'realization', false],
  ['*--', 'composition', false], ['--*', 'composition', true],
  ['o--', 'aggregation', false], ['--o', 'aggregation', true],
  ['..>', 'dependency', false], ['<..', 'dependency', true],
  ['-->', 'association', false], ['<--', 'association', true],
  ['--', 'association', false], ['..', 'dependency', false],
];
function classDiagram(ls, name) {
  const g = new GraphBuilder('class', 'imported-class', name);
  let ns = null, cls = null;
  for (const l of ls) {
    let m;
    if ((m = l.match(/^direction\s+(\w+)/))) { g.d.direction = DIRS[m[1].toUpperCase()]; continue; }
    if (cls) {
      if (l === '}') { cls = null; continue; }
      if ((m = l.match(/^<<(.+)>>$/))) { setStereo(cls, m[1]); continue; }
      const mem = parseMember(l);
      if (mem) cls.members = [...(cls.members || []), mem];
      continue;
    }
    if ((m = l.match(/^namespace\s+([\w.]+)\s*\{$/))) { ns = g.el(m[1], { kind: 'package' }); continue; }
    if (l === '}' && ns) { ns = null; continue; }
    if ((m = l.match(/^class\s+([\w$.]+)(?:~([^~]+)~)?(?:\["([^"]+)"\])?\s*(\{)?\s*$/))) {
      const e = g.el(m[1], { kind: 'class', label: m[3] || (m[2] ? `${m[1]}<${m[2]}>` : undefined), parent: ns?.id });
      if (m[4]) cls = e;
      continue;
    }
    if ((m = l.match(/^<<(.+)>>\s+([\w$.]+)$/))) { setStereo(g.el(m[2], { kind: 'class' }), m[1]); continue; }
    if ((m = l.match(/^([\w$.]+)\s*:\s*(.+)$/)) && !/--|\.\./.test(l)) {
      const e = g.el(m[1], { kind: 'class', parent: ns?.id });
      const mem = parseMember(m[2]);
      if (mem) e.members = [...(e.members || []), mem];
      continue;
    }
    const rel = parseRelation(l, CLASS_ARROWS);
    if (rel) {
      g.el(rel.a, { kind: 'class' }); g.el(rel.b, { kind: 'class' });
      const [from, to, fc, tc] = rel.rev ? [rel.b, rel.a, rel.cb, rel.ca] : [rel.a, rel.b, rel.ca, rel.cb];
      g.rel(from, to, rel.kind, { label: rel.label, fromCard: fc, toCard: tc });
    }
  }
  return g.build();
}
function setStereo(e, s) {
  const k = s.trim().toLowerCase();
  if (k === 'interface') e.kind = 'interface';
  else if (k === 'enumeration' || k === 'enum') e.kind = 'enum';
  else if (k === 'abstract') e.kind = 'abstract';
  else e.stereotype = s.trim();
  if (e.kind === 'enum' && e.members) e.members.forEach((m) => { if (!m.type) m.kind = 'literal'; });
}
function parseRelation(l, arrows) {
  for (const [tok, kind, rev] of arrows) {
    const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^([\\w$.]+)\\s*(?:"([^"]*)")?\\s*${esc}\\s*(?:"([^"]*)")?\\s*([\\w$.]+)\\s*(?::\\s*(.+))?$`);
    const m = l.match(re);
    if (m) return { a: m[1], ca: m[2], cb: m[3], b: m[4], label: m[5]?.trim(), kind, rev };
  }
  return null;
}

// ---------- sequence ----------
function sequenceDiagram(ls, name) {
  const d = { id: 'imported-sequence', type: 'sequence', title: name, participants: [], messages: [] };
  const pIds = new Set();
  const addP = (id, label, kind) => {
    id = safeId(id);
    if (pIds.has(id)) return id;
    pIds.add(id);
    const p = { id };
    if (label && label !== id) p.label = label;
    if (kind && kind !== 'participant') p.kind = kind;
    d.participants.push(p);
    return id;
  };
  // Nesting follows activations: messages sent while B is active become children of the message that activated B.
  const stack = []; // { participant, msg }
  const target = () => (stack.length ? (stack[stack.length - 1].msg.children ||= []) : d.messages);
  const ARROWS = [['-->>', 'reply'], ['->>', 'sync'], ['--)', 'async'], ['-)', 'async'], ['--x', 'reply'], ['-x', 'sync'], ['-->', 'reply'], ['->', 'sync']];
  for (const l of ls) {
    let m;
    if ((m = l.match(/^(participant|actor)\s+([^\s@]+)(?:@\{[^}]*"type"\s*:\s*"(\w+)"[^}]*\})?(?:\s+as\s+(.+))?$/))) {
      addP(m[2], m[4] && stripQuotes(m[4]), m[1] === 'actor' ? 'actor' : m[3]); continue;
    }
    if ((m = l.match(/^activate\s+(\S+)/))) {
      const last = lastMsg(target(), d.messages);
      if (last) stack.push({ participant: safeId(m[1]), msg: last });
      continue;
    }
    if ((m = l.match(/^deactivate\s+(\S+)/))) { popFor(stack, safeId(m[1])); continue; }
    if ((m = l.match(/^note\s+(?:over|left of|right of)\s+([^:]+):\s*(.+)$/i))) {
      const last = lastMsg(target(), d.messages);
      if (last) last.note = m[2].trim();
      continue;
    }
    if (/^(loop|alt|else|opt|par|and|critical|break|rect|end|autonumber|box)\b/.test(l)) continue;
    for (const [tok, kind] of ARROWS) {
      const i = l.indexOf(tok);
      if (i <= 0) continue;
      const from = l.slice(0, i).trim();
      let rest = l.slice(i + tok.length);
      const colon = rest.indexOf(':');
      if (colon < 0) break;
      let to = rest.slice(0, colon).trim();
      const label = rest.slice(colon + 1).trim().replace(/#59;/g, ';').replace(/#35;/g, '#');
      let act = 0;
      if (to.startsWith('+')) { act = 1; to = to.slice(1); }
      else if (to.startsWith('-')) { act = -1; to = to.slice(1); }
      const f = addP(from), t = addP(to);
      const msg = { from: f, to: t, label: label || ' ' };
      if (kind !== 'sync') msg.kind = kind;
      target().push(msg);
      if (act === 1) stack.push({ participant: t, msg });
      if (act === -1) popFor(stack, f);
      break;
    }
  }
  return d;
}
function lastMsg(arr, root) { return arr[arr.length - 1] || root[root.length - 1] || null; }
function popFor(stack, p) {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].participant === p) { stack.splice(i, 1); return; }
}

// ---------- flowchart → activity ----------
const SHAPES = [
  [/^\(\(\((.*)\)\)\)$/, 'end'], [/^\(\((.*)\)\)$/, 'action'], [/^\(\[(.*)\]\)$/, 'action'],
  [/^\[\[(.*)\]\]$/, 'subflow'], [/^\[\((.*)\)\]$/, 'action'], [/^\{\{(.*)\}\}$/, 'action'],
  [/^\{(.*)\}$/, 'decision'], [/^\[\/(.*)\/\]$/, 'action'], [/^\[\\(.*)\\\]$/, 'action'],
  [/^>(.*)\]$/, 'note'], [/^\((.*)\)$/, 'action'], [/^\[(.*)\]$/, 'action'],
];
function nodeRef(g, raw, parent) {
  raw = raw.trim().replace(/:::\w+$/, '');
  const m = raw.match(/^([\w$.\-]+)(.*)$/);
  if (!m) return null;
  const id = m[1], shapeTxt = m[2].trim();
  const props = { parent };
  if (shapeTxt) {
    for (const [re, kind] of SHAPES) {
      const s = shapeTxt.match(re);
      if (s) {
        const lbl = stripQuotes(s[1]).trim();
        props.kind = kind;
        if (kind === 'action' && lbl === '' && /^\(\(/.test(shapeTxt)) props.kind = 'start';
        if (kind === 'end') props.label = undefined; else if (lbl) props.label = lbl;
        break;
      }
    }
  }
  const existing = g.byId.get(safeId(id));
  if (existing && !shapeTxt) return existing.id;
  if (existing && existing.parent && !props.parent) props.parent = existing.parent;
  return g.el(id, props).id;
}
function flowchart(ls, name) {
  const g = new GraphBuilder('activity', 'imported-flow', name);
  const head = ls[0].split(/\s+/);
  if (head[1]) g.d.direction = DIRS[head[1].toUpperCase()];
  const groups = [];
  const EDGE = /\s*(<?(?:-->|-\.->|==>|---|-\.-|===|--[ox]|-\.-[ox]|==[ox]))(?:\|([^|]*)\|)?\s*|\s*--\s+([^-]+?)\s+-->\s*|\s*-\.\s+([^.]+?)\s+\.->\s*/;
  for (const l of ls.slice(1)) {
    let m;
    if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(l)) continue;
    if ((m = l.match(/^subgraph\s+([\w$.\-]+)\s*(?:\[(.+)\])?\s*$/)) || (m = l.match(/^subgraph\s+(.+)$/))) {
      const id = safeId(m[1].trim().replace(/\s+/g, '_'));
      const e = g.el(id, { kind: 'subflow', label: m[2] ? stripQuotes(m[2]) : (m[1].includes(' ') ? m[1].trim() : undefined), parent: groups[groups.length - 1] });
      groups.push(e.id);
      continue;
    }
    if (l === 'end') { groups.pop(); continue; }
    const parent = groups[groups.length - 1];
    const parts = [];
    let rest = l;
    while (rest) {
      const em = rest.match(EDGE);
      if (!em) { parts.push({ node: rest }); break; }
      parts.push({ node: rest.slice(0, em.index) });
      parts.push({ edge: em[1] || '-->', label: em[2] || em[3] || em[4] });
      rest = rest.slice(em.index + em[0].length);
    }
    let prev = null, pending = null;
    for (const p of parts) {
      if (p.edge) { pending = p; continue; }
      const ids = p.node.split(/\s*&\s*/).map((n) => nodeRef(g, n, parent)).filter(Boolean);
      if (prev && pending) for (const a of prev) for (const b of ids) g.rel(a, b, 'flow', { label: pending.label && stripQuotes(pending.label) });
      prev = ids; pending = null;
    }
  }
  // Mermaid start/end circles: give a lone circle with no incoming edges the start kind.
  const incoming = new Set((g.d.relations || []).map((r) => r.to));
  for (const e of g.d.elements) if (e.kind === 'start' && incoming.has(e.id)) e.kind = 'action';
  return g.build();
}

// ---------- state ----------
function stateDiagram(ls, name) {
  const g = new GraphBuilder('state', 'imported-state', name);
  const scopes = [];
  let starts = 0, ends = 0;
  const pseudo = (kind) => {
    const scope = scopes[scopes.length - 1];
    const id = `${scope ? scope + '.' : ''}${kind === 'initial' ? '__start' : '__end'}`;
    if (kind === 'initial') starts++; else ends++;
    return g.el(id, { kind, parent: scope }).id;
  };
  for (const l of ls) {
    let m;
    if ((m = l.match(/^direction\s+(\w+)/))) { g.d.direction = DIRS[m[1].toUpperCase()]; continue; }
    if ((m = l.match(/^state\s+"([^"]+)"\s+as\s+([\w$.\-]+)\s*(\{)?$/))) {
      const e = g.el(m[2], { kind: 'state', label: m[1], parent: scopes[scopes.length - 1] });
      if (m[3]) { e.kind = 'composite'; scopes.push(e.id); }
      continue;
    }
    if ((m = l.match(/^state\s+([\w$.\-]+)\s*<<(choice|fork|join|history)>>/))) {
      g.el(m[1], { kind: m[2] === 'choice' ? 'choice' : m[2] === 'history' ? 'history' : 'choice', parent: scopes[scopes.length - 1] });
      continue;
    }
    if ((m = l.match(/^state\s+([\w$.\-]+)\s*\{$/))) {
      const e = g.el(m[1], { kind: 'composite', parent: scopes[scopes.length - 1] });
      e.kind = 'composite';
      scopes.push(e.id);
      continue;
    }
    if (l === '}') { scopes.pop(); continue; }
    if (l === '--' || /^note\b/.test(l) || /^classDef|^class\b/.test(l)) continue;
    if ((m = l.match(/^(\[\*\]|[\w$.\-]+)\s*-->\s*(\[\*\]|[\w$.\-]+)\s*(?::\s*(.+))?$/))) {
      const scope = scopes[scopes.length - 1];
      const a = m[1] === '[*]' ? pseudo('initial') : g.el(m[1], { kind: 'state', parent: g.byId.get(m[1])?.parent ?? scope }).id;
      const b = m[2] === '[*]' ? pseudo('final') : g.el(m[2], { kind: 'state', parent: g.byId.get(m[2])?.parent ?? scope }).id;
      g.rel(a, b, 'transition', { label: m[3]?.trim() });
      continue;
    }
    if ((m = l.match(/^([\w$.\-]+)\s*:\s*(.+)$/))) g.el(m[1], { kind: 'state', label: m[2].trim(), parent: scopes[scopes.length - 1] });
  }
  void starts; void ends;
  return g.build();
}

// ---------- ER ----------
const CARD_L = { '||': '1', '|o': '0..1', 'o|': '0..1', '}o': '*', 'o{': '*', '}|': '1..*', '|{': '1..*' };
function erDiagram(ls, name) {
  const g = new GraphBuilder('er', 'imported-er', name);
  let ent = null;
  for (const l of ls) {
    let m;
    if (ent) {
      if (l === '}') { ent = null; continue; }
      if ((m = l.match(/^([\w\-()[\],]+)\s+([\w\-[\]]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/))) {
        const keys = (m[3] || '').split(/\s*,\s*/);
        const mem = { name: m[2], kind: 'column', type: m[1] };
        if (keys.includes('PK')) mem.pk = true;
        if (keys.includes('UK')) mem.unique = true;
        if (keys.includes('FK')) mem.fk = (m[4] && m[4].replace(/^→\s*/, '').match(/^[\w.]+$/)) ? m[4].replace(/^→\s*/, '') : '?';
        if (m[4] && !(mem.fk && m[4].includes(mem.fk))) mem.note = m[4];
        if (mem.fk === '?') delete mem.fk;
        ent.members = [...(ent.members || []), mem];
      }
      continue;
    }
    if ((m = l.match(/^([\w\-]+)(?:\["?([^"\]]+)"?\])?\s*\{$/))) { ent = g.el(m[1], { kind: 'table', label: m[2] }); continue; }
    if ((m = l.match(/^([\w\-]+)\s+(\|\||\|o|o\||\}o|\}\|)(--|\.\.)(\|\||o\||\|o|o\{|\|\{)\s+([\w\-]+)\s*:\s*(.*)$/))) {
      g.el(m[1], { kind: 'table' }); g.el(m[5], { kind: 'table' });
      g.rel(m[1], m[5], 'relationship', { fromCard: CARD_L[m[2]], toCard: CARD_L[m[4]], label: stripQuotes(m[6]) });
      continue;
    }
    if ((m = l.match(/^([\w\-]+)$/))) g.el(m[1], { kind: 'table' });
  }
  return g.build();
}
