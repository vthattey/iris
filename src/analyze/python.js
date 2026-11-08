// Python extractor: classes, dataclasses, enums, SQLAlchemy/Django models, decorators and calls.
import { stripQuotes } from './common.js';

const line = (n) => n.startPosition.row + 1;

function decoratorInfo(d) {
  // @app.get("/x", ...)  /  @dataclass  /  @staticmethod
  const e = d.namedChildren[0];
  if (!e) return null;
  if (e.type === 'call') {
    const fn = e.childForFieldName('function');
    const out = { name: fn.text.split('.').pop(), target: fn.text, args: {} };
    for (const a of e.childForFieldName('arguments')?.namedChildren || []) {
      if (a.type === 'keyword_argument') out.args[a.childForFieldName('name').text] = stripQuotes(a.childForFieldName('value').text);
      else if (out.args.value === undefined) out.args.value = stripQuotes(a.text);
    }
    return out;
  }
  return { name: e.text.split('.').pop(), target: e.text, args: {} };
}

function paramsOf(node) {
  const out = [];
  for (const p of node?.namedChildren || []) {
    if (p.type === 'identifier') out.push({ name: p.text });
    else if (p.type === 'typed_parameter') out.push({ name: p.namedChildren.find((c) => c.type === 'identifier')?.text || p.text, type: p.childForFieldName('type')?.text });
    else if (p.type === 'default_parameter') out.push({ name: p.childForFieldName('name').text });
    else if (p.type === 'typed_default_parameter') out.push({ name: p.childForFieldName('name').text, type: p.childForFieldName('type')?.text });
  }
  return out;
}

function vis(name) { return name.startsWith('__') && !name.endsWith('__') ? 'private' : name.startsWith('_') && !name.startsWith('__') ? 'protected' : 'public'; }

function walk(node) {
  const all = [];
  const st = [node];
  while (st.length) {
    const n = st.pop();
    all.push(n);
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i);
      // do not descend into nested defs/classes
      if (c.type === 'function_definition' || c.type === 'class_definition') continue;
      st.push(c);
    }
  }
  return all;
}

function typeFromValue(v, params) {
  if (!v) return undefined;
  if (v.type === 'call') { const f = v.childForFieldName('function').text; return /^[A-Z]/.test(f.split('.').pop()) ? f.split('.').pop() : undefined; }
  if (v.type === 'identifier') return params.get(v.text);
  if (v.type === 'boolean_operator') return typeFromValue(v.childForFieldName('left'), params) || typeFromValue(v.childForFieldName('right'), params);
  return undefined;
}

function collectCalls(body, params, moduleVars) {
  const calls = [];
  const locals = new Map(params.filter((p) => p.name !== 'self' && p.name !== 'cls').map((p) => [p.name, p.type]));
  if (!body) return calls;
  const all = walk(body);
  for (const n of all) {
    if (n.type === 'assignment' && n.childForFieldName('left')?.type === 'identifier') {
      const t = n.childForFieldName('type')?.text || typeFromValue(n.childForFieldName('right'), locals);
      if (!locals.has(n.childForFieldName('left').text)) locals.set(n.childForFieldName('left').text, t);
    }
  }
  for (const n of all) {
    if (n.type !== 'call') continue;
    const fn = n.childForFieldName('function');
    const args = n.childForFieldName('arguments');
    const call = { args: args ? args.text.slice(1, -1) : '', line: line(n) };
    const a0 = args?.namedChildren[0];
    if (a0 && /string|concatenated/.test(a0.type)) call.firstArg = a0.text;
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object');
      call.name = fn.childForFieldName('attribute').text;
      if (obj.type === 'identifier' && (obj.text === 'self' || obj.text === 'cls')) call.recv = { kind: 'self' };
      else if (obj.type === 'call' && obj.childForFieldName('function').text === 'super') call.recv = { kind: 'super' };
      else if (obj.type === 'attribute' && obj.childForFieldName('object').text === 'self') call.recv = { kind: 'field', name: obj.childForFieldName('attribute').text };
      else if (obj.type === 'identifier') {
        const v = obj.text;
        if (locals.has(v)) call.recv = { kind: 'var', name: v, type: locals.get(v) };
        else if (moduleVars.has(v)) call.recv = { kind: 'var', name: v, type: moduleVars.get(v) };
        else if (/^[A-Z]/.test(v)) call.recv = { kind: 'static', type: v };
        else call.recv = { kind: 'module', name: v };
      } else call.recv = { kind: 'expr', text: obj.text.slice(0, 60) };
    } else if (fn.type === 'identifier') {
      call.name = fn.text;
      if (/^[A-Z]/.test(fn.text)) continue; // constructor call
      call.recv = { kind: 'function' };
    } else continue;
    calls.push(call);
  }
  return calls;
}

export function extractPython(tree, file, rel) {
  const modPath = rel.replace(/\.pyi?$/, '').replace(/\/__init__$/, '').replace(/\//g, '.');
  const pkg = modPath;
  const types = [];
  const imports = {};
  const moduleVars = new Map();
  const mod = { id: modPath, name: modPath.split('.').pop(), simpleName: modPath.split('.').pop(), pkg, file, line: 1, lang: 'python', kind: 'module',
    annotations: [], extends: [], implements: [], fields: [], methods: [], constants: [], imports };

  const root = tree.rootNode;
  for (const c of root.namedChildren) {
    if (c.type === 'import_from_statement') {
      const from = c.childForFieldName('module_name')?.text;
      for (const nm of c.namedChildren.filter((x) => x.type === 'dotted_name' && x !== c.childForFieldName('module_name'))) imports[nm.text] = `${from}.${nm.text}`;
      for (const al of c.namedChildren.filter((x) => x.type === 'aliased_import')) imports[al.childForFieldName('alias').text] = `${from}.${al.childForFieldName('name').text}`;
    }
    if (c.type === 'expression_statement' && c.namedChildren[0]?.type === 'assignment') {
      const a = c.namedChildren[0];
      if (a.childForFieldName('left')?.type === 'identifier') {
        const t = a.childForFieldName('type')?.text || typeFromValue(a.childForFieldName('right'), new Map());
        moduleVars.set(a.childForFieldName('left').text, t);
        if (t) mod.fields.push({ name: a.childForFieldName('left').text, type: t, line: line(a) });
      }
    }
  }

  function fnDef(n, decorators, owner) {
    const ps = paramsOf(n.childForFieldName('parameters'));
    const name = n.childForFieldName('name').text;
    const isStatic = decorators.some((d) => d.name === 'staticmethod' || d.name === 'classmethod');
    return {
      name, kind: name === '__init__' ? 'constructor' : 'method',
      params: ps.filter((p, i) => !(i === 0 && (p.name === 'self' || p.name === 'cls'))),
      type: n.childForFieldName('return_type')?.text, visibility: vis(name), static: isStatic,
      abstract: decorators.some((d) => d.name === 'abstractmethod'), annotations: decorators, line: line(n),
      calls: collectCalls(n.childForFieldName('body'), ps, moduleVars),
      _ps: ps, _owner: owner,
    };
  }

  function classDef(n, decorators) {
    const name = n.childForFieldName('name').text;
    const supers = (n.childForFieldName('superclasses')?.namedChildren || []).filter((x) => x.type !== 'keyword_argument').map((x) => x.text);
    let kind = 'class';
    if (supers.some((s) => /(^|\.)(Enum|IntEnum|StrEnum|Flag)$/.test(s))) kind = 'enum';
    else if (supers.some((s) => /(^|\.)(Protocol)$/.test(s))) kind = 'interface';
    else if (supers.some((s) => /(^|\.)(ABC)$/.test(s))) kind = 'abstract';
    const t = { id: `${modPath}.${name}`, name, simpleName: name, pkg, file, line: line(n), lang: 'python', kind, annotations: decorators,
      extends: supers.filter((s) => !/^(object|ABC|Protocol|Enum|IntEnum|StrEnum|Generic(\[.*\])?)$/.test(s)), implements: [], fields: [], methods: [], constants: [], imports };
    types.push(t);
    const seen = new Set();
    for (let c of n.childForFieldName('body')?.namedChildren || []) {
      let decs = [];
      if (c.type === 'decorated_definition') { decs = c.namedChildren.filter((x) => x.type === 'decorator').map(decoratorInfo).filter(Boolean); c = c.childForFieldName('definition'); }
      if (c.type === 'function_definition') {
        const m = fnDef(c, decs, t);
        if (decs.some((d) => d.name === 'property')) { if (!seen.has(m.name)) { seen.add(m.name); t.fields.push({ name: m.name, type: m.type, visibility: m.visibility, line: m.line }); } continue; }
        t.methods.push(m);
        if (m.name === '__init__') {
          const pmap = new Map(m._ps.map((p) => [p.name, p.type]));
          for (const x of walk(c.childForFieldName('body'))) {
            if (x.type !== 'assignment') continue;
            const left = x.childForFieldName('left');
            if (left?.type !== 'attribute' || left.childForFieldName('object').text !== 'self') continue;
            const fname = left.childForFieldName('attribute').text;
            if (seen.has(fname)) continue;
            seen.add(fname);
            const type = x.childForFieldName('type')?.text || typeFromValue(x.childForFieldName('right'), pmap);
            t.fields.push({ name: fname, type, visibility: vis(fname), line: line(x), injected: true });
          }
        }
      } else if (c.type === 'class_definition') {
        classDef(c, decs);
      } else if (c.type === 'expression_statement' && c.namedChildren[0]?.type === 'assignment') {
        const a = c.namedChildren[0];
        const left = a.childForFieldName('left');
        if (left?.type !== 'identifier') continue;
        if (kind === 'enum') { t.constants.push(left.text); continue; }
        if (seen.has(left.text)) continue;
        seen.add(left.text);
        const v = a.childForFieldName('right');
        t.fields.push({ name: left.text, type: a.childForFieldName('type')?.text || typeFromValue(v, new Map()), visibility: vis(left.text),
          static: !a.childForFieldName('type') && !!v && !/dataclass/.test(decorators.map((d) => d.name).join()), line: line(a), value: v?.text?.slice(0, 200) });
      }
    }
    for (const m of t.methods) { delete m._ps; delete m._owner; }
  }

  for (let c of root.namedChildren) {
    let decs = [];
    if (c.type === 'decorated_definition') { decs = c.namedChildren.filter((x) => x.type === 'decorator').map(decoratorInfo).filter(Boolean); c = c.childForFieldName('definition'); }
    if (c.type === 'class_definition') classDef(c, decs);
    else if (c.type === 'function_definition') { const m = fnDef(c, decs, mod); delete m._ps; delete m._owner; mod.methods.push(m); }
  }
  if (mod.methods.length) types.push(mod);
  return types;
}
