// TypeScript / TSX extractor: classes, interfaces, enums, decorators (NestJS, TypeORM, Angular) and calls.
import { stripQuotes } from './common.js';

const line = (n) => n.startPosition.row + 1;
const typeText = (n) => (n ? n.text.replace(/^:\s*/, '').trim() : undefined);

function decorator(d) {
  // @Get(':id')  /  @Injectable()  /  @Input
  const e = d.namedChildren[0];
  if (!e) return null;
  if (e.type === 'call_expression') {
    const fn = e.childForFieldName('function');
    const args = e.childForFieldName('arguments');
    const out = { name: fn.text.split('.').pop(), args: {} };
    const first = args?.namedChildren[0];
    if (first) {
      if (first.type === 'string' || first.type === 'template_string') out.args.value = stripQuotes(first.text);
      else if (first.type === 'object') {
        for (const p of first.namedChildren) if (p.type === 'pair') out.args[stripQuotes(p.childForFieldName('key').text)] = stripQuotes(p.childForFieldName('value').text);
      } else out.args.value = first.text;
    }
    return out;
  }
  return { name: e.text.split('.').pop(), args: {} };
}

function paramsOf(node) {
  const out = [];
  if (!node) return out;
  for (const p of node.namedChildren) {
    if (!/parameter/.test(p.type)) continue;
    const pat = p.childForFieldName('pattern');
    out.push({
      name: pat ? pat.text : p.text, type: typeText(p.childForFieldName('type')),
      access: p.namedChildren.find((c) => c.type === 'accessibility_modifier')?.text || (p.children.some((c) => c.type === 'readonly') ? 'public' : undefined),
      decorators: p.namedChildren.filter((c) => c.type === 'decorator').map(decorator).filter(Boolean),
    });
  }
  return out;
}

function collectCalls(body, params) {
  const calls = [];
  const locals = new Map(params.map((p) => [p.name, p.type]));
  if (!body) return calls;
  const all = [];
  const st = [body];
  while (st.length) { const n = st.pop(); all.push(n); for (let i = n.namedChildCount - 1; i >= 0; i--) st.push(n.namedChild(i)); }
  for (const n of all) {
    if (n.type !== 'variable_declarator') continue;
    const nm = n.childForFieldName('name')?.text;
    let t = typeText(n.childForFieldName('type'));
    const v = n.childForFieldName('value');
    if (!t && v?.type === 'new_expression') t = v.childForFieldName('constructor')?.text;
    if (nm) locals.set(nm, t);
  }
  for (const n of all) {
    if (n.type !== 'call_expression') continue;
    const fn = n.childForFieldName('function');
    const args = n.childForFieldName('arguments');
    const call = { args: args ? args.text.slice(1, -1) : '', line: line(n) };
    const a0 = args?.namedChildren[0];
    if (a0 && /string|template/.test(a0.type)) call.firstArg = a0.text;
    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object');
      call.name = fn.childForFieldName('property').text;
      if (obj.type === 'this') call.recv = { kind: 'self' };
      else if (obj.type === 'super') call.recv = { kind: 'super' };
      else if (obj.type === 'member_expression' && obj.childForFieldName('object').type === 'this') call.recv = { kind: 'field', name: obj.childForFieldName('property').text };
      else if (obj.type === 'identifier') {
        const v = obj.text;
        call.recv = locals.has(v) ? { kind: 'var', name: v, type: locals.get(v) } : /^[A-Z]/.test(v) ? { kind: 'static', type: v } : { kind: 'module', name: v };
      } else call.recv = { kind: 'expr', text: obj.text.slice(0, 60) };
    } else if (fn.type === 'identifier') {
      call.name = fn.text;
      call.recv = { kind: 'function' };
    } else continue;
    calls.push(call);
  }
  return calls;
}

export function extractTypeScript(tree, file, rel) {
  const types = [];
  const dir = rel.replace(/\/[^/]*$/, '').replace(/^[^/]*$/, '');
  const stem = rel.split('/').pop().replace(/\.(d\.)?[cm]?tsx?$/, '');
  const pkg = dir.replace(/\//g, '.');
  const imports = {};
  const moduleFns = { id: `${pkg ? pkg + '.' : ''}${stem}`, name: stem, simpleName: stem, pkg, file, line: 1, lang: 'ts', kind: 'module',
    annotations: [], extends: [], implements: [], fields: [], methods: [], constants: [], imports };

  function visit(n, decorators) {
    switch (n.type) {
      case 'export_statement': {
        const decs = n.namedChildren.filter((c) => c.type === 'decorator').map(decorator).filter(Boolean);
        const decl = n.childForFieldName('declaration') || n.namedChildren.find((c) => /declaration/.test(c.type));
        if (decl) visit(decl, decs);
        return;
      }
      case 'import_statement': {
        const src = stripQuotes(n.childForFieldName('source')?.text || '');
        for (const s of n.descendantsOfType ? n.descendantsOfType('import_specifier') : []) {
          const nm = (s.childForFieldName('alias') || s.childForFieldName('name'))?.text;
          if (nm) imports[nm] = src;
        }
        return;
      }
      case 'class_declaration': case 'abstract_class_declaration': case 'class':
        return classDecl(n, [...(decorators || []), ...n.namedChildren.filter((c) => c.type === 'decorator').map(decorator).filter(Boolean)]);
      case 'interface_declaration': return interfaceDecl(n);
      case 'enum_declaration': return enumDecl(n);
      case 'function_declaration': case 'generator_function_declaration': {
        const ps = paramsOf(n.childForFieldName('parameters'));
        moduleFns.methods.push({ name: n.childForFieldName('name').text, kind: 'method', params: ps, type: typeText(n.childForFieldName('return_type')),
          visibility: 'public', annotations: decorators || [], line: line(n), calls: collectCalls(n.childForFieldName('body'), ps) });
        return;
      }
      case 'lexical_declaration': {
        for (const d of n.namedChildren.filter((c) => c.type === 'variable_declarator')) {
          const v = d.childForFieldName('value');
          if (v && (v.type === 'arrow_function' || v.type === 'function_expression' || v.type === 'function')) {
            const ps = paramsOf(v.childForFieldName('parameters'));
            moduleFns.methods.push({ name: d.childForFieldName('name').text, kind: 'method', params: ps, visibility: 'public', annotations: [], line: line(d),
              calls: collectCalls(v.childForFieldName('body'), ps) });
          } else if (v?.type === 'new_expression') {
            moduleFns.fields.push({ name: d.childForFieldName('name').text, type: v.childForFieldName('constructor')?.text, line: line(d) });
          }
        }
        return;
      }
      default: return;
    }
  }

  function base(name, kind, n, decorators) {
    const t = { id: `${pkg ? pkg + '.' : ''}${name}`, name, simpleName: name, pkg, file, line: line(n), lang: 'ts', kind,
      annotations: decorators || [], extends: [], implements: [], fields: [], methods: [], constants: [], imports };
    types.push(t);
    return t;
  }

  function classDecl(n, decorators) {
    const name = n.childForFieldName('name')?.text;
    if (!name) return;
    const t = base(name, n.type === 'abstract_class_declaration' ? 'abstract' : 'class', n, decorators);
    const her = n.namedChildren.find((c) => c.type === 'class_heritage');
    if (her) {
      for (const c of her.namedChildren) {
        if (c.type === 'extends_clause') t.extends.push(...c.namedChildren.filter((x) => x.type !== 'type_arguments').map((x) => x.text));
        if (c.type === 'implements_clause') t.implements.push(...c.namedChildren.map((x) => x.text));
      }
    }
    let pending = [];
    for (const c of n.childForFieldName('body')?.namedChildren || []) {
      if (c.type === 'decorator') { pending.push(decorator(c)); continue; }
      const decs = [...pending, ...c.namedChildren.filter((x) => x.type === 'decorator').map(decorator)].filter(Boolean);
      pending = [];
      const access = c.namedChildren.find((x) => x.type === 'accessibility_modifier')?.text;
      const isStatic = c.children.some((x) => x.type === 'static');
      if (c.type === 'public_field_definition' || c.type === 'property_signature') {
        let type = typeText(c.childForFieldName('type'));
        const v = c.childForFieldName('value');
        if (!type && v?.type === 'new_expression') type = v.childForFieldName('constructor')?.text;
        t.fields.push({ name: c.childForFieldName('name').text, type, visibility: access || 'public', static: isStatic, annotations: decs, line: line(c),
          value: v?.text?.slice(0, 120) });
      } else if (c.type === 'method_definition' || c.type === 'abstract_method_signature' || c.type === 'method_signature') {
        const name2 = c.childForFieldName('name').text;
        const ps = paramsOf(c.childForFieldName('parameters'));
        if (name2 === 'constructor') {
          for (const p of ps) if (p.access) t.fields.push({ name: p.name, type: p.type, visibility: p.access, annotations: p.decorators, line: line(c), injected: true });
        }
        t.methods.push({ name: name2, kind: name2 === 'constructor' ? 'constructor' : 'method', params: ps.map(({ name: pn, type: pt }) => ({ name: pn, type: pt })),
          type: typeText(c.childForFieldName('return_type')), visibility: access || (name2.startsWith('#') ? 'private' : 'public'),
          static: isStatic, abstract: c.type === 'abstract_method_signature', annotations: decs, line: line(c),
          calls: collectCalls(c.childForFieldName('body'), ps) });
      }
    }
  }

  function interfaceDecl(n) {
    const t = base(n.childForFieldName('name').text, 'interface', n, []);
    const ext = n.namedChildren.find((c) => c.type === 'extends_type_clause');
    if (ext) t.extends.push(...ext.namedChildren.map((x) => x.text));
    for (const c of n.childForFieldName('body')?.namedChildren || []) {
      if (c.type === 'property_signature') t.fields.push({ name: c.childForFieldName('name').text, type: typeText(c.childForFieldName('type')), visibility: 'public', line: line(c) });
      if (c.type === 'method_signature') t.methods.push({ name: c.childForFieldName('name').text, kind: 'method', params: paramsOf(c.childForFieldName('parameters')).map(({ name, type }) => ({ name, type })),
        type: typeText(c.childForFieldName('return_type')), visibility: 'public', abstract: true, annotations: [], line: line(c), calls: [] });
    }
  }

  function enumDecl(n) {
    const t = base(n.childForFieldName('name').text, 'enum', n, []);
    for (const c of n.childForFieldName('body')?.namedChildren || []) {
      if (c.type === 'property_identifier') t.constants.push(c.text);
      else if (c.type === 'enum_assignment') t.constants.push(c.childForFieldName('name').text);
    }
  }

  for (const c of tree.rootNode.namedChildren) visit(c, null);
  if (moduleFns.methods.length || moduleFns.fields.length) types.push(moduleFns);
  return types;
}
