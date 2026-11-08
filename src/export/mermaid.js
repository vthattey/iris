// Export Iris diagrams to Mermaid. Mermaid is static, so the full (fully expanded) structure is written.

const VIS = { public: '+', private: '-', protected: '#', package: '~' };

// Words Mermaid parsers treat as keywords; never use them as raw ids.
const RESERVED = new Set(['end', 'graph', 'flowchart', 'subgraph', 'style', 'linkstyle', 'class', 'classdef', 'click', 'call', 'href', 'default', 'direction', 'state', 'note', 'namespace', 'participant', 'actor', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'rect', 'critical', 'break', 'activate', 'deactivate', 'as', 'title', 'accTitle', 'accDescr']);

function makeIds() {
  const map = new Map();
  const used = new Set();
  return (id) => {
    if (map.has(id)) return map.get(id);
    let base = String(id).replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(base)) base = 'n_' + base;
    if (RESERVED.has(base.toLowerCase())) base = base + '_';
    let s = base, i = 2;
    while (used.has(s)) s = `${base}_${i++}`;
    used.add(s);
    map.set(id, s);
    return s;
  };
}
// Text inside double quotes in Mermaid labels.
const q = (s) => String(s).replace(/"/g, '#quot;').replace(/\n/g, ' ');
// Free text after ":" in sequence/state/ER statements.
const free = (s) => String(s).replace(/[;#]/g, (c) => (c === ';' ? '#59;' : '#35;')).replace(/\n/g, ' ');
const generic = (s) => String(s || '').replace(/[<>]/g, '~');

function children(d) {
  const byParent = new Map();
  for (const e of d.elements) {
    const p = e.parent || null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(e);
  }
  return byParent;
}

// ---------- class ----------
function classDiagram(d) {
  const id = makeIds();
  const out = ['classDiagram'];
  if (d.direction) out.push(`  direction ${{ DOWN: 'TB', UP: 'BT', RIGHT: 'LR', LEFT: 'RL' }[d.direction]}`);
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  const pkgPath = (e) => {
    const parts = [];
    let cur = e.parent ? byId.get(e.parent) : null;
    while (cur) { parts.unshift(cur.label || cur.id); cur = cur.parent ? byId.get(cur.parent) : null; }
    return parts.join('.');
  };
  const groups = new Map();
  for (const e of d.elements) {
    if (e.kind === 'package') continue;
    const p = pkgPath(e);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(e);
  }
  const classBlock = (e, indent) => {
    const lines = [];
    const name = id(e.id);
    const lbl = e.label && e.label !== name ? `["${q(e.label)}"]` : (e.id !== name ? `["${q(e.id)}"]` : '');
    lines.push(`${indent}class ${name}${lbl} {`);
    const st = e.stereotype || ({ interface: 'interface', enum: 'enumeration', abstract: 'abstract', record: 'record', annotation: 'annotation' }[e.kind]);
    if (st) lines.push(`${indent}  <<${q(st)}>>`);
    for (const m of e.members || []) {
      const v = VIS[m.visibility] || '';
      const suffix = m.static ? '$' : m.abstract ? '*' : '';
      if (m.kind === 'method' || m.kind === 'constructor') {
        lines.push(`${indent}  ${v}${m.name}(${generic(m.params)})${suffix}${m.type ? ' ' + generic(m.type) : ''}`);
      } else if (m.kind === 'literal') {
        lines.push(`${indent}  ${m.name}`);
      } else {
        lines.push(`${indent}  ${v}${m.type ? generic(m.type) + ' ' : ''}${m.name}${suffix}`);
      }
    }
    lines.push(`${indent}}`);
    return lines;
  };
  for (const [pkg, items] of groups) {
    if (pkg) {
      out.push(`  namespace ${id('ns:' + pkg)} {`);
      items.forEach((e) => out.push(...classBlock(e, '    ')));
      out.push('  }');
    } else items.forEach((e) => out.push(...classBlock(e, '  ')));
  }
  for (const r of d.relations || []) {
    const a = byId.get(r.from), b = byId.get(r.to);
    if (!a || !b || a.kind === 'package' || b.kind === 'package') continue; // Mermaid cannot link namespaces
    const A = id(r.from), B = id(r.to);
    const fc = r.fromCard ? ` "${q(r.fromCard)}"` : '', tc = r.toCard ? `"${q(r.toCard)}" ` : '';
    const lbl = r.label ? ` : ${free(r.label)}` : '';
    switch (r.kind) {
      case 'inheritance': out.push(`  ${B} <|-- ${A}${lbl}`); break;
      case 'realization': out.push(`  ${B} <|.. ${A}${lbl}`); break;
      case 'composition': out.push(`  ${A}${fc} *-- ${tc}${B}${lbl}`); break;
      case 'aggregation': out.push(`  ${A}${fc} o-- ${tc}${B}${lbl}`); break;
      case 'dependency': out.push(`  ${A}${fc} ..> ${tc}${B}${lbl}`); break;
      default: out.push(`  ${A}${fc} --> ${tc}${B}${lbl}`);
    }
  }
  return out.join('\n');
}

// ---------- sequence ----------
function sequenceDiagram(d) {
  const id = makeIds();
  const out = ['sequenceDiagram'];
  for (const p of d.participants) {
    const kw = p.kind === 'actor' ? 'actor' : 'participant';
    out.push(`  ${kw} ${id(p.id)} as ${free(p.label || p.id)}`);
  }
  const arrow = { sync: '->>', async: '-)', reply: '-->>', create: '->>' };
  const walk = (msgs) => {
    for (const m of msgs) {
      const hasKids = m.children && m.children.length && m.kind !== 'reply';
      out.push(`  ${id(m.from)}${arrow[m.kind || 'sync']}${hasKids && m.from !== m.to ? '+' : ''}${id(m.to)}: ${free(m.label)}`);
      if (m.note) out.push(`  Note over ${id(m.to)}: ${free(m.note)}`);
      if (m.children) walk(m.children);
      if (hasKids && m.from !== m.to) {
        // Close the activation opened by "+" with an invisible-ish deactivate
        out.push(`  deactivate ${id(m.to)}`);
      }
    }
  };
  walk(d.messages);
  return out.join('\n');
}

// ---------- activity / component (flowchart) ----------
function flowchart(d) {
  const id = makeIds();
  const dir = { DOWN: 'TD', UP: 'BT', RIGHT: 'LR', LEFT: 'RL' }[d.direction || (d.type === 'component' ? 'RIGHT' : 'DOWN')];
  const out = [`flowchart ${dir}`];
  const kids = children(d);
  const shape = (e) => {
    const L = q(e.label || e.id);
    switch (e.kind) {
      case 'start': return `(( ))`;
      case 'end': return `((( )))`;
      case 'decision': case 'merge': return `{"${e.label ? L : ' '}"}`;
      case 'fork': case 'join': return `[" "]`;
      case 'subflow': return `[["${L}"]]`;
      case 'note': return `>"${L}"]`;
      case 'action': return `("${L}")`;
      case 'database': return `[("${L}")]`;
      case 'queue': return `[/"${L}"/]`;
      case 'actor': return `(["${L}"])`;
      case 'component': return `["${e.stereotype ? '«' + q(e.stereotype) + '»<br/>' : ''}${L}"]`;
      default: return `["${L}"]`;
    }
  };
  const classes = { bar: [], external: [] };
  const emit = (parent, indent) => {
    for (const e of kids.get(parent) || []) {
      if (kids.has(e.id)) {
        out.push(`${indent}subgraph ${id(e.id)}["${q(e.label || e.id)}"]`);
        emit(e.id, indent + '  ');
        out.push(`${indent}end`);
      } else {
        out.push(`${indent}${id(e.id)}${shape(e)}`);
        if (e.kind === 'fork' || e.kind === 'join') classes.bar.push(id(e.id));
        if (e.kind === 'external') classes.external.push(id(e.id));
      }
    }
  };
  emit(null, '  ');
  for (const r of d.relations || []) {
    const dashed = r.kind === 'publishes' || r.kind === 'subscribes';
    const lbl = r.label ? `|"${q(r.label)}"|` : '';
    out.push(`  ${id(r.from)} ${dashed ? '-.->' : '-->'}${lbl} ${id(r.to)}`);
  }
  if (classes.bar.length) out.push('  classDef bar fill:#222,stroke:#222,color:#222', `  class ${classes.bar.join(',')} bar`);
  if (classes.external.length) out.push('  classDef external stroke-dasharray:5 3', `  class ${classes.external.join(',')} external`);
  return out.join('\n');
}

// ---------- state ----------
function stateDiagram(d) {
  const id = makeIds();
  const out = ['stateDiagram-v2'];
  if (d.direction === 'RIGHT') out.push('  direction LR');
  const kids = children(d);
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  const ref = (e) => (e.kind === 'initial' || e.kind === 'final' ? '[*]' : id(e.id));
  // Transitions are written inside the block of the innermost container holding both ends,
  // so [*] keeps its meaning.
  const ancestors = (e) => { const a = []; let c = e.parent ? byId.get(e.parent) : null; while (c) { a.push(c.id); c = c.parent ? byId.get(c.parent) : null; } return a; };
  const scopeOf = (r) => {
    const a = byId.get(r.from), b = byId.get(r.to);
    const pa = [a.parent || null, ...ancestors(a).slice(1)];
    const pb = new Set([b.parent || null, ...ancestors(b).slice(1), null]);
    return pa.find((x) => pb.has(x)) ?? null;
  };
  const relsByScope = new Map();
  for (const r of d.relations || []) {
    if (!byId.has(r.from) || !byId.has(r.to)) continue;
    const s = scopeOf(r);
    if (!relsByScope.has(s)) relsByScope.set(s, []);
    relsByScope.get(s).push(r);
  }
  const emit = (parent, indent) => {
    for (const e of kids.get(parent) || []) {
      if (e.kind === 'initial' || e.kind === 'final') continue;
      const name = id(e.id);
      if (e.label && e.label !== name) out.push(`${indent}state "${q(e.label)}" as ${name}`);
      else if (e.id !== name) out.push(`${indent}state "${q(e.id)}" as ${name}`);
      if (e.kind === 'choice') out.push(`${indent}state ${name} <<choice>>`);
      if (kids.has(e.id)) {
        out.push(`${indent}state ${name} {`);
        emit(e.id, indent + '  ');
        out.push(`${indent}}`);
      }
    }
    for (const r of relsByScope.get(parent) || []) {
      out.push(`${indent}${ref(byId.get(r.from))} --> ${ref(byId.get(r.to))}${r.label ? ' : ' + free(r.label) : ''}`);
    }
  };
  emit(null, '  ');
  return out.join('\n');
}

// ---------- ER ----------
const LEFT = { '1': '||', '1..1': '||', '0..1': '|o', '*': '}o', '0..*': '}o', 'n': '}o', '1..*': '}|', '1..n': '}|' };
const RIGHT = { '1': '||', '1..1': '||', '0..1': 'o|', '*': 'o{', '0..*': 'o{', 'n': 'o{', '1..*': '|{', '1..n': '|{' };
function erDiagram(d) {
  const id = makeIds();
  const out = ['erDiagram'];
  for (const e of d.elements) {
    if (e.kind === 'schema') continue;
    const name = id(e.id);
    const alias = e.label && e.label !== name ? `["${q(e.label)}"]` : (e.id !== name ? `["${q(e.id)}"]` : '');
    out.push(`  ${name}${alias} {`);
    for (const m of e.members || []) {
      const type = String(m.type || 'string').replace(/[^A-Za-z0-9_\-[\]()]/g, '_');
      const keys = [m.pk && 'PK', m.fk && 'FK', m.unique && !m.pk && 'UK'].filter(Boolean).join(', ');
      const comment = m.note ? ` "${q(m.note)}"` : (m.fk ? ` "${q('→ ' + m.fk)}"` : '');
      out.push(`    ${type} ${String(m.name).replace(/[^A-Za-z0-9_\-[\]]/g, '_')}${keys ? ' ' + keys : ''}${comment}`);
    }
    out.push('  }');
  }
  for (const r of d.relations || []) {
    const l = LEFT[String(r.fromCard || '*').toLowerCase()] || '}o';
    const rt = RIGHT[String(r.toCard || '1').toLowerCase()] || '||';
    out.push(`  ${id(r.from)} ${l}--${rt} ${id(r.to)} : "${q(r.label || '')}"`);
  }
  return out.join('\n');
}

export function toMermaid(diagram) {
  switch (diagram.type) {
    case 'class': return classDiagram(diagram);
    case 'sequence': return sequenceDiagram(diagram);
    case 'activity': case 'component': return flowchart(diagram);
    case 'state': return stateDiagram(diagram);
    case 'er': return erDiagram(diagram);
    default: throw new Error(`Unsupported diagram type: ${diagram.type}`);
  }
}

/** Export every diagram; returns [{ id, title, type, mermaid }]. */
export function exportMermaid(doc) {
  return doc.diagrams.map((d) => ({ id: d.id, title: d.title || d.id, type: d.type, mermaid: toMermaid(d) }));
}

/** One Markdown document with a fenced ```mermaid block per diagram. */
export function mermaidMarkdown(doc) {
  const parts = [`# ${doc.title || 'Diagrams'}`, '', '_Generated by Iris. Mermaid is static, so every level is shown expanded._', ''];
  for (const x of exportMermaid(doc)) parts.push(`## ${x.title}`, '', '```mermaid', x.mermaid, '```', '');
  return parts.join('\n');
}
