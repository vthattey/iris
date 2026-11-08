// PlantUML → Iris. Supports class, sequence, activity (new syntax), state, component/deployment and IE/ER entity diagrams.
import { GraphBuilder, doc, stripQuotes, safeId, parseMember } from './util.js';

function cleanLines(text) {
  return text
    .replace(/\/'[\s\S]*?'\//g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*'.*$/, '').trim())
    .filter((l) => l && !/^@(start|end)\w*/.test(l) && !/^(skinparam|hide|show|left to right|top to bottom|title|caption|header|footer|legend|endlegend|scale|!|autonumber|newpage|allowmixing)/i.test(l));
}

export function importPlantUml(text, name = 'diagram') {
  const all = text;
  const ls = cleanLines(text);
  const dir = /left to right direction/i.test(all) ? 'RIGHT' : undefined;
  const type = detect(ls, all);
  let d;
  switch (type) {
    case 'sequence': d = sequence(ls, name); break;
    case 'activity': d = activity(ls, name); break;
    case 'state': d = state(ls, name); break;
    case 'er': d = er(ls, name); break;
    case 'component': d = component(ls, name); break;
    default: d = classes(ls, name);
  }
  if (dir && d.type !== 'sequence') d.direction = dir;
  return doc(name, d);
}

function detect(ls, all) {
  const t = ls.join('\n');
  if (/^@startuml[\s\S]*^(start|:[^;]+;)\s*$/m.test(all) || /^(start|stop)$/m.test(t) || /^:[^\n]+;$/m.test(t)) return 'activity';
  if (/^(participant|actor|boundary|control|entity|database|collections|queue)\s/m.test(t) && /(->|-->>?)/.test(t) && !/^(class|interface)\s/m.test(t) && !/^entity\s+\S+\s*\{/m.test(t)) {
    if (!/^(component|\[)/m.test(t) && !/^(node|package|rectangle|cloud)\s/m.test(t)) return 'sequence';
  }
  if (/^entity\s+\S+.*\{/m.test(t) || /\|\|--|\}o--|\}\|--|--o\{|--\|\{/.test(t)) return 'er';
  if (/^\[\*\]\s*-->/m.test(t) || /^state\s/m.test(t)) return 'state';
  if (/^(class|interface|abstract|enum|annotation)\s/m.test(t)) return 'class';
  if (/^(component|\[[^\]]+\]|database|queue|node|cloud|rectangle|frame|artifact)\b/m.test(t)) return 'component';
  if (/(->|-->)/.test(t) && /^\w+\s*->/m.test(t)) return 'sequence';
  return 'class';
}

// ---------- class ----------
const ARROWS = [
  ['<|--', 'inheritance', true], ['--|>', 'inheritance', false], ['<|..', 'realization', true], ['..|>', 'realization', false],
  ['*--', 'composition', false], ['--*', 'composition', true], ['o--', 'aggregation', false], ['--o', 'aggregation', true],
  ['..>', 'dependency', false], ['<..', 'dependency', true], ['-->', 'association', false], ['<--', 'association', true],
  ['->', 'association', false], ['--', 'association', false], ['..', 'dependency', false],
];
function relLine(l, arrows) {
  for (const [tok, kind, rev] of arrows) {
    // allow direction hints like -up-|> or -[#red]->
    const core = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/(--|\\\.\\\.)/, '$1');
    const re = new RegExp(`^"?([\\w$.]+)"?\\s*(?:"([^"]*)")?\\s*${core.replace(/^(\\?[<*o]?\\?\|?)(-|\\\.)/, '$1$2(?:(?:up|down|left|right|\\[[^\\]]*\\])?$2?)?')}\\s*(?:"([^"]*)")?\\s*"?([\\w$.]+)"?\\s*(?::\\s*(.+))?$`);
    const m = l.match(re);
    if (m) return { a: m[1], ca: m[2], cb: m[3], b: m[4], label: m[5]?.trim(), kind, rev };
  }
  return null;
}
function classes(ls, name) {
  const g = new GraphBuilder('class', 'imported-class', name);
  const pk = [];
  let cls = null;
  for (const l of ls) {
    let m;
    if (cls) {
      if (l === '}') { cls = null; continue; }
      if (/^(--|==|\.\.|__)/.test(l)) continue;
      const mem = parseMember(l.replace(/^\{(static|abstract)\}\s*/, (x, k) => `{${k}}`));
      if (mem) {
        if (cls.kind === 'enum' && !mem.type && mem.kind === 'field') mem.kind = 'literal';
        cls.members = [...(cls.members || []), mem];
      }
      continue;
    }
    if ((m = l.match(/^(package|namespace)\s+"?([^"{]+?)"?\s*(?:as\s+(\S+))?\s*(?:<<[^>]+>>)?\s*\{$/))) {
      pk.push(g.el(m[3] || m[2].trim(), { kind: 'package', label: m[3] ? m[2].trim() : undefined, parent: pk[pk.length - 1]?.id })); continue;
    }
    if (l === '}' && pk.length) { pk.pop(); continue; }
    if ((m = l.match(/^(abstract\s+class|abstract|class|interface|enum|annotation|record|entity)\s+"?([\w$.<>,\s]+?)"?\s*(?:as\s+(\S+))?\s*(<<\s*([^>]+?)\s*>>)?\s*(\{)?\s*$/))) {
      const kind = /^abstract/.test(m[1]) ? 'abstract' : m[1] === 'entity' ? 'class' : m[1];
      const id = m[3] || m[2].replace(/<.*>/, '').trim();
      const e = g.el(id, { kind, label: m[3] || /</.test(m[2]) ? m[2].trim() : undefined, parent: pk[pk.length - 1]?.id, stereotype: m[5] });
      e.kind = kind;
      if (m[6]) cls = e;
      continue;
    }
    if ((m = l.match(/^"?([\w$.]+)"?\s*:\s*(.+)$/)) && !/--|\.\./.test(l)) {
      const e = g.el(m[1], { kind: 'class' });
      const mem = parseMember(m[2]);
      if (mem) e.members = [...(e.members || []), mem];
      continue;
    }
    const r = relLine(l, ARROWS);
    if (r) {
      g.el(r.a, { kind: 'class' }); g.el(r.b, { kind: 'class' });
      const [from, to, fc, tc] = r.rev ? [r.b, r.a, r.cb, r.ca] : [r.a, r.b, r.ca, r.cb];
      g.rel(from, to, r.kind, { label: r.label, fromCard: fc, toCard: tc });
    }
  }
  return g.build();
}

// ---------- sequence ----------
const P_KINDS = { participant: 'participant', actor: 'actor', boundary: 'boundary', control: 'control', entity: 'entity', database: 'database', collections: 'entity', queue: 'queue' };
function sequence(ls, name) {
  const d = { id: 'imported-sequence', type: 'sequence', title: name, participants: [], messages: [] };
  const ids = new Set();
  const addP = (id, label, kind) => {
    id = safeId(stripQuotes(id));
    if (ids.has(id)) {
      const p = d.participants.find((x) => x.id === id);
      if (label && !p.label) p.label = label;
      if (kind && kind !== 'participant') p.kind = kind;
      return id;
    }
    ids.add(id);
    const p = { id };
    if (label && label !== id) p.label = label;
    if (kind && kind !== 'participant') p.kind = kind;
    d.participants.push(p);
    return id;
  };
  const stack = [];
  const target = () => (stack.length ? (stack[stack.length - 1].msg.children ||= []) : d.messages);
  let lastSync = null;
  for (const l of ls) {
    let m;
    if ((m = l.match(/^(participant|actor|boundary|control|entity|database|collections|queue)\s+("[^"]+"|\S+)(?:\s+as\s+(\S+))?/))) {
      const a = stripQuotes(m[2]);
      if (m[3]) addP(m[3], a, P_KINDS[m[1]]); else addP(a, undefined, P_KINDS[m[1]]);
      continue;
    }
    if ((m = l.match(/^activate\s+(\S+)/))) {
      const arr = target();
      const last = arr[arr.length - 1];
      if (last) stack.push({ participant: safeId(m[1]), msg: last });
      continue;
    }
    if ((m = l.match(/^deactivate\s+(\S+)/))) { pop(stack, safeId(m[1])); continue; }
    if ((m = l.match(/^return\s*(.*)$/))) {
      const top = stack[stack.length - 1];
      if (top) { target().push({ from: top.participant, to: top.msg.from, label: m[1] || 'return', kind: 'reply' }); stack.pop(); }
      continue;
    }
    if ((m = l.match(/^note\s+(?:over|left of|right of|left|right)\b[^:]*:\s*(.+)$/i))) {
      const arr = target(); const last = arr[arr.length - 1];
      if (last) last.note = m[1].trim();
      continue;
    }
    if (/^(alt|else|opt|loop|par|break|critical|group|end|ref|box|end box|==|\.\.\.|\|\|\|)/.test(l)) continue;
    if ((m = l.match(/^("[^"]+"|[\w$.]+)\s*(<?-[-]?>>?|<?-[-]?\\\\?|->x|-->x|<<--|<-)\s*(\+\+|--|\*\*|!!)?\s*("[^"]+"|[\w$.]+)\s*(\+\+|--)?\s*(?::\s*(.*))?$/))) {
      let [ , a, arrow, , b, act2, label] = m;
      let from = stripQuotes(a), to = stripQuotes(b);
      if (arrow.startsWith('<')) [from, to] = [to, from];
      const f = addP(from), t = addP(to);
      const kind = arrow.includes('--') ? 'reply' : arrow.endsWith('>>') ? 'async' : 'sync';
      const msg = { from: f, to: t, label: (label || '').trim() || ' ' };
      if (kind !== 'sync') msg.kind = kind;
      target().push(msg);
      const act = m[3] || act2;
      if (act === '++') stack.push({ participant: t, msg });
      else if (act === '--') pop(stack, f);
      if (kind === 'sync') lastSync = msg;
      continue;
    }
  }
  void lastSync;
  return d;
}
function pop(stack, p) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].participant === p) { stack.splice(i, 1); return; } }

// ---------- activity (new syntax) ----------
function activity(ls, name) {
  const g = new GraphBuilder('activity', 'imported-activity', name);
  let n = 0;
  const nid = (p) => `${p}${++n}`;
  // Each frame tracks the "open ends" waiting to connect to the next node.
  let ends = [];          // [{ id, label }]
  const ctl = [];         // if/while/fork frames
  const parts = [];       // partition stack
  const connect = (id) => { for (const e of ends) g.rel(e.id, id, 'flow', { label: e.label }); ends = [{ id }]; };
  for (const l of ls) {
    let m;
    const parent = parts[parts.length - 1];
    if (l === 'start') { const id = nid('start'); g.el(id, { kind: 'start', parent }); connect(id); continue; }
    if (l === 'stop' || l === 'end') { const id = nid('end'); g.el(id, { kind: 'end', parent }); connect(id); ends = []; continue; }
    if (l === 'kill' || l === 'detach') { ends = []; continue; }
    if ((m = l.match(/^:([\s\S]*?)[;|<>\]/}]$/))) { const id = nid('a'); g.el(id, { kind: 'action', label: m[1].trim(), parent }); connect(id); continue; }
    if ((m = l.match(/^(partition|group|package|rectangle|card)\s+"?([^"{]+?)"?\s*\{$/))) {
      const id = nid('p'); g.el(id, { kind: 'subflow', label: m[2].trim(), parent });
      parts.push(id); continue;
    }
    if (l === '}' && parts.length) { parts.pop(); continue; }
    if ((m = l.match(/^if\s*\((.*?)\)\s*(?:then|is)?\s*(?:\((.*?)\))?$/))) {
      const id = nid('d'); g.el(id, { kind: 'decision', label: m[1].trim(), parent }); connect(id);
      ctl.push({ type: 'if', id, outs: [] });
      ends = [{ id, label: m[2] }];
      continue;
    }
    if ((m = l.match(/^(?:elseif|else\s+if)\s*\((.*?)\)\s*(?:then)?\s*(?:\((.*?)\))?$/))) {
      const f = ctl[ctl.length - 1]; if (!f) continue;
      f.outs.push(...ends);
      const id = nid('d'); g.el(id, { kind: 'decision', label: m[1].trim(), parent });
      g.rel(f.lastDecision || f.id, id, 'flow', { label: f.elseLabel || 'no' });
      f.lastDecision = id;
      ends = [{ id, label: m[2] }];
      continue;
    }
    if ((m = l.match(/^else\s*(?:\((.*?)\))?$/))) {
      const f = ctl[ctl.length - 1]; if (!f) continue;
      f.outs.push(...ends);
      ends = [{ id: f.lastDecision || f.id, label: m[1] }];
      f.hadElse = true;
      continue;
    }
    if (l === 'endif' || l === 'end if') {
      const f = ctl.pop(); if (!f) continue;
      if (!f.hadElse) f.outs.push({ id: f.lastDecision || f.id });
      ends = [...f.outs, ...ends];
      continue;
    }
    if ((m = l.match(/^while\s*\((.*?)\)\s*(?:is\s*)?(?:\((.*?)\))?$/))) {
      const id = nid('d'); g.el(id, { kind: 'decision', label: m[1].trim(), parent }); connect(id);
      ctl.push({ type: 'while', id });
      ends = [{ id, label: m[2] }];
      continue;
    }
    if ((m = l.match(/^endwhile\s*(?:\((.*?)\))?$/))) {
      const f = ctl.pop(); if (!f) continue;
      for (const e of ends) g.rel(e.id, f.id, 'flow', { label: e.label });
      ends = [{ id: f.id, label: m[1] }];
      continue;
    }
    if (l === 'repeat') { const id = nid('m'); g.el(id, { kind: 'merge', parent }); connect(id); ctl.push({ type: 'repeat', id }); continue; }
    if ((m = l.match(/^repeat\s*while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?\s*(?:not\s*\((.*?)\))?$/))) {
      const f = ctl.pop(); if (!f) continue;
      const id = nid('d'); g.el(id, { kind: 'decision', label: m[1].trim(), parent }); connect(id);
      g.rel(id, f.id, 'flow', { label: m[2] || 'yes' });
      ends = [{ id, label: m[3] || 'no' }];
      continue;
    }
    if (l === 'fork' || l === 'split') { const id = nid('f'); g.el(id, { kind: 'fork', parent }); connect(id); ctl.push({ type: 'fork', id, outs: [] }); continue; }
    if (l === 'fork again' || l === 'split again') { const f = ctl[ctl.length - 1]; if (!f) continue; f.outs.push(...ends); ends = [{ id: f.id }]; continue; }
    if (/^end\s*(fork|split|merge)/.test(l)) {
      const f = ctl.pop(); if (!f) continue;
      f.outs.push(...ends);
      const id = nid('j'); g.el(id, { kind: 'join', parent });
      for (const e of f.outs) g.rel(e.id, id, 'flow', { label: e.label });
      ends = [{ id }];
      continue;
    }
    if ((m = l.match(/^note\s+(?:left|right)\s*:\s*(.+)$/))) { const id = nid('n'); g.el(id, { kind: 'note', label: m[1].trim(), parent }); continue; }
  }
  return g.build();
}

// ---------- state ----------
function state(ls, name) {
  const g = new GraphBuilder('state', 'imported-state', name);
  const scopes = [];
  const ps = (kind) => {
    const s = scopes[scopes.length - 1];
    return g.el(`${s ? s + '.' : ''}${kind === 'initial' ? '__start' : '__end'}`, { kind, parent: s }).id;
  };
  for (const l of ls) {
    let m;
    if ((m = l.match(/^state\s+"([^"]+)"\s+as\s+([\w$.]+)\s*(<<\w+>>)?\s*(\{)?$/)) || (m = l.match(/^state\s+([\w$.]+)\s*(?:as\s+"([^"]+)")?\s*(<<\w+>>)?\s*(\{)?$/))) {
      const isQuotedFirst = /^state\s+"/.test(l);
      const id = isQuotedFirst ? m[2] : m[1];
      const lbl = isQuotedFirst ? m[1] : m[2];
      const kind = m[3] && /choice/.test(m[3]) ? 'choice' : m[4] ? 'composite' : 'state';
      const e = g.el(id, { kind, label: lbl, parent: scopes[scopes.length - 1] });
      if (m[4]) { e.kind = 'composite'; scopes.push(e.id); }
      continue;
    }
    if (l === '}') { scopes.pop(); continue; }
    if ((m = l.match(/^(\[\*\]|[\w$.]+)\s*-[\w[\]#]*->\s*(\[\*\]|[\w$.]+)\s*(?::\s*(.+))?$/))) {
      const s = scopes[scopes.length - 1];
      const a = m[1] === '[*]' ? ps('initial') : g.el(m[1], { kind: 'state', parent: g.byId.get(m[1])?.parent ?? s }).id;
      const b = m[2] === '[*]' ? ps('final') : g.el(m[2], { kind: 'state', parent: g.byId.get(m[2])?.parent ?? s }).id;
      g.rel(a, b, 'transition', { label: m[3]?.trim() });
      continue;
    }
    if ((m = l.match(/^([\w$.]+)\s*:\s*(.+)$/))) { const e = g.el(m[1], { kind: 'state', parent: scopes[scopes.length - 1] }); e.note = (e.note ? e.note + '\n' : '') + m[2].trim(); }
  }
  return g.build();
}

// ---------- ER (IE notation) ----------
const L = { '||': '1', '|o': '0..1', 'o|': '0..1', '}o': '*', 'o{': '*', '}|': '1..*', '|{': '1..*' };
function er(ls, name) {
  const g = new GraphBuilder('er', 'imported-er', name);
  let ent = null;
  for (const l of ls) {
    let m;
    if (ent) {
      if (l === '}') { ent = null; continue; }
      if (/^(--|==|\.\.)/.test(l)) continue;
      if ((m = l.match(/^([*+#-]?)\s*"?([\w$]+)"?\s*:\s*([^<]+?)\s*(<<\s*(\w+)\s*>>)?\s*(<<\s*(\w+)\s*>>)?$/))) {
        const mem = { name: m[2], kind: 'column', type: m[3].trim() };
        const tags = [m[5], m[7]].filter(Boolean).map((x) => x.toUpperCase());
        if (tags.includes('PK')) mem.pk = true;
        if (tags.includes('FK')) mem.fk = '?';
        if (m[1] === '*' && !mem.pk) mem.nullable = false;
        if (mem.fk === '?') delete mem.fk, (mem.note = 'foreign key');
        ent.members = [...(ent.members || []), mem];
      }
      continue;
    }
    if ((m = l.match(/^(entity|table)\s+"?([^"{]+?)"?\s*(?:as\s+(\S+))?\s*\{$/))) { ent = g.el(m[3] || m[2].trim(), { kind: 'table', label: m[3] ? m[2].trim() : undefined }); continue; }
    if ((m = l.match(/^(entity|table)\s+"?([^"{]+?)"?\s*(?:as\s+(\S+))?$/))) { g.el(m[3] || m[2].trim(), { kind: 'table' }); continue; }
    if ((m = l.match(/^"?([\w$.]+)"?\s*(\|\||\|o|o\||\}o|\}\|)[-.]+(\|\||o\||\|o|o\{|\|\{)\s*"?([\w$.]+)"?\s*(?::\s*(.+))?$/))) {
      g.el(m[1], { kind: 'table' }); g.el(m[4], { kind: 'table' });
      g.rel(m[1], m[4], 'relationship', { fromCard: L[m[2]], toCard: L[m[3]], label: m[5] && stripQuotes(m[5]) });
    }
  }
  return g.build();
}

// ---------- component / deployment ----------
const C_KINDS = { component: 'component', database: 'database', queue: 'queue', actor: 'actor', node: 'node', cloud: 'external',
  rectangle: 'container', frame: 'container', package: 'container', folder: 'container', artifact: 'component', interface: 'component', boundary: 'component', collections: 'component' };
function component(ls, name) {
  const g = new GraphBuilder('component', 'imported-component', name);
  const scopes = [];
  const alias = new Map();
  const ref = (s) => {
    s = s.trim();
    const br = s.match(/^\[([^\]]+)\]$/);
    if (br) { const id = alias.get(br[1]) || safeId(br[1].replace(/\s+/g, '_')); if (!g.byId.has(id)) g.el(id, { kind: 'component', label: br[1], parent: scopes[scopes.length - 1] }); return id; }
    s = stripQuotes(s);
    return alias.get(s) || safeId(s);
  };
  for (const l of ls) {
    let m;
    if ((m = l.match(/^(component|database|queue|actor|node|cloud|rectangle|frame|package|folder|artifact|interface|collections)\s+("[^"]+"|\[[^\]]+\]|[\w$.]+)(?:\s+as\s+([\w$.]+))?\s*(<<\s*([^>]+)\s*>>)?\s*(\{)?$/))) {
      const raw = m[2].replace(/^\[|\]$/g, '');
      const lbl = stripQuotes(raw);
      const id = safeId(m[3] || lbl.replace(/\s+/g, '_'));
      alias.set(lbl, id);
      const kind = m[6] && C_KINDS[m[1]] === 'node' ? 'node' : m[6] ? (m[1] === 'component' ? 'component' : (C_KINDS[m[1]] === 'node' ? 'node' : 'container')) : C_KINDS[m[1]];
      const e = g.el(id, { kind, label: lbl !== id ? lbl : undefined, parent: scopes[scopes.length - 1], stereotype: m[5] });
      e.kind = kind;
      if (m[6]) scopes.push(e.id);
      continue;
    }
    if ((m = l.match(/^\[([^\]]+)\](?:\s+as\s+([\w$.]+))?\s*(<<\s*([^>]+)\s*>>)?$/))) {
      const id = safeId(m[2] || m[1].replace(/\s+/g, '_'));
      alias.set(m[1], id);
      g.el(id, { kind: 'component', label: m[1] !== id ? m[1] : undefined, parent: scopes[scopes.length - 1], stereotype: m[4] });
      continue;
    }
    if (l === '}') { scopes.pop(); continue; }
    if ((m = l.match(/^(\[[^\]]+\]|"[^"]+"|[\w$.]+)\s*([-.]+(?:\[[^\]]*\]|up|down|left|right)?[-.]*>?|<[-.]+)\s*(\[[^\]]+\]|"[^"]+"|[\w$.]+)\s*(?::\s*(.+))?$/))) {
      let a = ref(m[1]), b = ref(m[3]);
      if (m[2].startsWith('<')) [a, b] = [b, a];
      for (const id of [a, b]) if (!g.byId.has(id)) g.el(id, { kind: 'component' });
      g.rel(a, b, m[2].includes('.') ? 'uses' : 'calls', { label: m[4]?.trim() });
    }
  }
  return g.build();
}
