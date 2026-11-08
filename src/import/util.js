// Shared helpers for importers.

export function stripQuotes(s) {
  s = String(s ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, ' ');
}

export function safeId(s) {
  const id = String(s).trim().replace(/[^A-Za-z0-9_.:$/#@\-]/g, '_');
  return id || '_';
}

// Builds a graph diagram while de-duplicating elements by id.
export class GraphBuilder {
  constructor(type, id, title) {
    this.d = { id, type, title, elements: [], relations: [] };
    this.byId = new Map();
  }
  el(id, props = {}) {
    id = safeId(id);
    let e = this.byId.get(id);
    if (!e) {
      e = { id, kind: props.kind || 'action' };
      this.byId.set(id, e);
      this.d.elements.push(e);
    }
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'kind' && e.kind !== 'action' && e.kind !== 'class' && e.kind !== 'state' && e.kind !== 'component') continue;
      if (k === 'members') e.members = [...(e.members || []), ...v];
      else e[k] = v;
    }
    if (e.label === e.id) delete e.label;
    return e;
  }
  rel(from, to, kind, extra = {}) {
    const r = { from: safeId(from), to: safeId(to), kind };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== null && v !== '') r[k] = v;
    this.d.relations.push(r);
    return r;
  }
  build() {
    if (!this.d.relations.length) delete this.d.relations;
    return this.d;
  }
}

export function doc(title, diagram) {
  return { iris: '1.0', title, diagrams: [diagram] };
}

// Parse "name: Type", "Type name", "+method(args) Ret", "-int id$" into an Iris member.
export function parseMember(raw, style) {
  let s = raw.trim();
  if (!s) return null;
  const vis = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' }[s[0]];
  if (vis) s = s.slice(1).trim();
  const m = {};
  if (vis) m.visibility = vis;
  if (/\{static\}|\$$/.test(s)) { m.static = true; s = s.replace(/\{static\}|\$$/g, '').trim(); }
  if (/\{abstract\}|\*$/.test(s)) { m.abstract = true; s = s.replace(/\{abstract\}|\*$/g, '').trim(); }
  const fixGen = (t) => (t ? t.replace(/~([^~]+)~/g, '<$1>').trim() : t);
  const call = s.match(/^([\w$<>~]+)\s*\(([^)]*)\)\s*(?::\s*)?(.*)$/);
  if (call) {
    m.name = call[1];
    m.kind = 'method';
    if (call[2].trim()) m.params = fixGen(call[2].trim());
    if (call[3].trim()) m.type = fixGen(call[3].trim());
    return m;
  }
  const colon = s.match(/^([\w$]+)\s*:\s*(.+)$/);
  if (colon) { m.name = colon[1]; m.type = fixGen(colon[2]); m.kind = 'field'; return m; }
  const sp = s.match(/^(.+?)\s+([\w$]+)$/);
  if (sp && style !== 'plantuml-name-first') { m.name = sp[2]; m.type = fixGen(sp[1]); m.kind = 'field'; return m; }
  m.name = s; m.kind = 'field';
  return m;
}
