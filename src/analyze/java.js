// Java (8–21) extractor: tree-sitter syntax tree → language-neutral type model.
import { stripQuotes } from './common.js';

const TYPE_DECL = {
  class_declaration: 'class', interface_declaration: 'interface', enum_declaration: 'enum',
  annotation_type_declaration: 'annotation', record_declaration: 'record',
};
const VIS = ['public', 'private', 'protected'];

function annotationValue(v) {
  if (!v) return undefined;
  if (v.type === 'string_literal') return stripQuotes(v.text);
  if (v.type === 'element_value_array_initializer') return v.namedChildren.map(annotationValue).filter((x) => x !== undefined).join(', ');
  return v.text;
}

function parseModifiers(node) {
  const out = { annotations: [], visibility: undefined, static: false, abstract: false, final: false, default: false };
  if (!node) return out;
  for (const c of node.children) {
    if (c.type === 'marker_annotation' || c.type === 'annotation') {
      const nameNode = c.childForFieldName('name');
      const name = (nameNode ? nameNode.text : c.text.replace(/^@/, '')).split('.').pop();
      const args = {};
      const argList = c.childForFieldName('arguments');
      if (argList) {
        for (const a of argList.namedChildren) {
          if (a.type === 'element_value_pair') args[a.childForFieldName('key').text] = annotationValue(a.childForFieldName('value'));
          else if (args.value === undefined) args.value = annotationValue(a);
        }
      }
      out.annotations.push({ name, args });
    } else if (VIS.includes(c.type)) out.visibility = c.type;
    else if (c.type === 'static') out.static = true;
    else if (c.type === 'abstract') out.abstract = true;
    else if (c.type === 'final') out.final = true;
    else if (c.type === 'default') out.default = true;
  }
  return out;
}

const modsOf = (n) => parseModifiers(n.namedChildren.find((c) => c.type === 'modifiers'));
const line = (n) => n.startPosition.row + 1;

function params(node) {
  const out = [];
  if (!node) return out;
  for (const p of node.namedChildren) {
    if (p.type !== 'formal_parameter' && p.type !== 'spread_parameter') continue;
    const t = p.childForFieldName('type') || p.namedChildren.find((x) => /type/.test(x.type));
    const nm = p.childForFieldName('name') || p.namedChildren.find((x) => x.type === 'variable_declarator')?.childForFieldName('name') || p.namedChildren[p.namedChildren.length - 1];
    out.push({ name: nm ? nm.text : '?', type: t ? t.text + (p.type === 'spread_parameter' ? '...' : '') : undefined });
  }
  return out;
}

function collectCalls(body, paramList, fieldNames) {
  const calls = [];
  const locals = new Map(paramList.map((p) => [p.name, p.type]));
  if (!body) return { calls, locals };
  const stack = [body];
  const visit = [];
  while (stack.length) { const n = stack.pop(); visit.push(n); for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i)); }
  // locals first (source order), so receivers declared later in the method still resolve
  for (const n of visit) {
    if (n.type === 'local_variable_declaration') {
      const t = n.childForFieldName('type')?.text;
      for (const d of n.namedChildren.filter((c) => c.type === 'variable_declarator')) {
        const nm = d.childForFieldName('name')?.text;
        let ty = t;
        if (t === 'var') { const v = d.childForFieldName('value'); if (v?.type === 'object_creation_expression') ty = v.childForFieldName('type')?.text; }
        if (nm) locals.set(nm, ty);
      }
    } else if (n.type === 'enhanced_for_statement') {
      const nm = n.childForFieldName('name')?.text, t = n.childForFieldName('type')?.text;
      if (nm) locals.set(nm, t);
    } else if (n.type === 'catch_formal_parameter') {
      const nm = n.childForFieldName('name')?.text;
      if (nm) locals.set(nm, n.namedChildren.find((c) => c.type === 'catch_type')?.text);
    }
  }
  for (const n of visit) {
    if (n.type !== 'method_invocation') continue;
    const obj = n.childForFieldName('object');
    const name = n.childForFieldName('name')?.text;
    const args = n.childForFieldName('arguments');
    const call = { name, args: args ? args.text.slice(1, -1) : '', line: line(n) };
    const firstArg = args?.namedChildren[0];
    if (firstArg && (firstArg.type === 'string_literal' || firstArg.type === 'binary_expression')) call.firstArg = firstArg.text;
    if (!obj || obj.type === 'this') call.recv = { kind: 'self' };
    else if (obj.type === 'super') call.recv = { kind: 'super' };
    else if (obj.type === 'identifier') {
      const v = obj.text;
      if (locals.has(v)) call.recv = { kind: 'var', name: v, type: locals.get(v) };
      else if (fieldNames.has(v) || /^[a-z_$]/.test(v)) call.recv = { kind: 'field', name: v };
      else call.recv = { kind: 'static', type: v };
    } else if (obj.type === 'field_access' && obj.childForFieldName('object')?.type === 'this') {
      call.recv = { kind: 'field', name: obj.childForFieldName('field').text };
    } else if (obj.type === 'scoped_identifier' || obj.type === 'type_identifier') {
      call.recv = { kind: 'static', type: obj.text };
    } else call.recv = { kind: 'expr', text: obj.text.slice(0, 60) };
    calls.push(call);
  }
  return { calls, locals };
}

export function extractJava(tree, file) {
  const root = tree.rootNode;
  let pkg = '';
  const imports = {};
  const types = [];

  for (const c of root.namedChildren) {
    if (c.type === 'package_declaration') pkg = c.namedChildren.filter((x) => !/annotation/.test(x.type)).map((x) => x.text).join('');
    if (c.type === 'import_declaration' && !c.text.includes('*') && !/\bstatic\b/.test(c.text)) {
      const q = c.namedChildren.find((x) => x.type === 'scoped_identifier' || x.type === 'identifier')?.text;
      if (q) imports[q.split('.').pop()] = q;
    }
  }

  function visitType(n, outer) {
    const kind0 = TYPE_DECL[n.type];
    const mods = modsOf(n);
    const simple = n.childForFieldName('name').text;
    const qname = outer ? `${outer.name}.${simple}` : simple;
    const t = {
      id: pkg ? `${pkg}.${qname}` : qname, name: qname, simpleName: simple, pkg, file, line: line(n), lang: 'java',
      kind: kind0 === 'class' && mods.abstract ? 'abstract' : kind0,
      annotations: mods.annotations, visibility: mods.visibility, extends: [], implements: [],
      fields: [], methods: [], constants: [], imports, outer: outer?.id,
    };
    const sup = n.childForFieldName('superclass');
    if (sup) t.extends.push(sup.namedChildren[0]?.text || sup.text.replace(/^extends\s+/, ''));
    const itf = n.childForFieldName('interfaces');
    const listTypes = (x) => (x?.namedChildren.find((c) => c.type === 'type_list')?.namedChildren || []).map((c) => c.text);
    if (itf) t.implements.push(...listTypes(itf));
    const ext = n.namedChildren.find((c) => c.type === 'extends_interfaces');
    if (ext) t.extends.push(...listTypes(ext));
    types.push(t);

    const body = n.childForFieldName('body');
    if (!body) return;
    const members = [];
    for (const c of body.namedChildren) {
      if (c.type === 'enum_constant') t.constants.push(c.childForFieldName('name')?.text || c.text);
      else if (c.type === 'enum_body_declarations') members.push(...c.namedChildren);
      else members.push(c);
    }
    const fieldNames = new Set();
    for (const c of members) if (c.type === 'field_declaration' || c.type === 'constant_declaration') {
      for (const d of c.namedChildren.filter((x) => x.type === 'variable_declarator')) fieldNames.add(d.childForFieldName('name')?.text);
    }
    for (const c of members) {
      if (TYPE_DECL[c.type]) { visitType(c, t); continue; }
      if (c.type === 'field_declaration' || c.type === 'constant_declaration') {
        const m = modsOf(c);
        const type = c.childForFieldName('type')?.text;
        for (const d of c.namedChildren.filter((x) => x.type === 'variable_declarator')) {
          t.fields.push({ name: d.childForFieldName('name').text, type, visibility: m.visibility || (kind0 === 'interface' ? 'public' : undefined),
            static: m.static || c.type === 'constant_declaration', final: m.final, annotations: m.annotations, line: line(c),
            value: d.childForFieldName('value')?.text?.slice(0, 120) });
        }
      } else if (c.type === 'method_declaration' || c.type === 'constructor_declaration' || c.type === 'compact_constructor_declaration') {
        const m = modsOf(c);
        const ps = params(c.childForFieldName('parameters'));
        const body = c.childForFieldName('body');
        const { calls } = collectCalls(body, ps, fieldNames);
        t.methods.push({
          name: c.childForFieldName('name')?.text || simple,
          kind: c.type === 'method_declaration' ? 'method' : 'constructor',
          params: ps, type: c.childForFieldName('type')?.text,
          visibility: m.visibility || (kind0 === 'interface' ? 'public' : undefined),
          static: m.static, abstract: m.abstract || (kind0 === 'interface' && !body), annotations: m.annotations,
          line: line(c), calls,
        });
      }
    }
  }

  for (const c of root.namedChildren) if (TYPE_DECL[c.type]) visitType(c, null);
  return types;
}
