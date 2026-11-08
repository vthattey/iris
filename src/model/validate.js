import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { ELEMENT_KINDS, RELATION_KINDS, CONTAINER_KINDS } from './kinds.js';

const schemaPath = fileURLToPath(new URL('../../schema/iris-diagram.schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const checkSchema = ajv.compile(schema);

/**
 * Validate an Iris document.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validate(doc) {
  const errors = [];
  const warnings = [];

  if (!checkSchema(doc)) {
    for (const e of checkSchema.errors) {
      errors.push(`${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`);
    }
    return { ok: false, errors, warnings };
  }

  const diagramIds = new Set();
  doc.diagrams.forEach((d, di) => {
    const at = `diagrams[${di}] (${d.id})`;
    if (diagramIds.has(d.id)) errors.push(`${at}: duplicate diagram id`);
    diagramIds.add(d.id);
    if (d.type === 'sequence') validateSequence(d, at, errors, warnings);
    else validateGraph(d, at, errors, warnings);
  });

  return { ok: errors.length === 0, errors, warnings };
}

function validateGraph(d, at, errors, warnings) {
  const allowedEl = ELEMENT_KINDS[d.type];
  const allowedRel = RELATION_KINDS[d.type];
  const byId = new Map();

  for (const el of d.elements) {
    if (byId.has(el.id)) errors.push(`${at}: duplicate element id "${el.id}"`);
    byId.set(el.id, el);
    if (!allowedEl.includes(el.kind)) {
      errors.push(`${at}: element "${el.id}" has kind "${el.kind}"; ${d.type} diagrams allow ${allowedEl.join(', ')}`);
    }
  }

  for (const el of d.elements) {
    if (!el.parent) continue;
    const p = byId.get(el.parent);
    if (!p) { errors.push(`${at}: element "${el.id}" names missing parent "${el.parent}"`); continue; }
    if (!CONTAINER_KINDS.has(p.kind)) {
      warnings.push(`${at}: "${el.id}" is inside "${p.id}" of kind "${p.kind}", which is not normally a container`);
    }
    // Cycle check
    const seen = new Set([el.id]);
    let cur = p;
    while (cur) {
      if (seen.has(cur.id)) { errors.push(`${at}: parent cycle through "${el.id}"`); break; }
      seen.add(cur.id);
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
  }

  (d.relations || []).forEach((r, ri) => {
    if (!byId.has(r.from)) errors.push(`${at}: relations[${ri}] from unknown element "${r.from}"`);
    if (!byId.has(r.to)) errors.push(`${at}: relations[${ri}] to unknown element "${r.to}"`);
    if (!allowedRel.includes(r.kind)) {
      errors.push(`${at}: relations[${ri}] kind "${r.kind}"; ${d.type} diagrams allow ${allowedRel.join(', ')}`);
    }
  });

  if (d.type === 'er') {
    for (const el of d.elements) {
      for (const m of el.members || []) {
        if (!m.fk) continue;
        const [table] = m.fk.split('.');
        if (!byId.has(table)) warnings.push(`${at}: column ${el.id}.${m.name} references unknown table "${table}"`);
      }
    }
  }
}

function validateSequence(d, at, errors, warnings) {
  const ids = new Set();
  for (const p of d.participants) {
    if (ids.has(p.id)) errors.push(`${at}: duplicate participant id "${p.id}"`);
    ids.add(p.id);
  }
  let count = 0;
  const walk = (msgs, path) => {
    msgs.forEach((m, i) => {
      count++;
      const here = `${path}[${i}]`;
      if (!ids.has(m.from)) errors.push(`${at}: ${here} from unknown participant "${m.from}"`);
      if (!ids.has(m.to)) errors.push(`${at}: ${here} to unknown participant "${m.to}"`);
      if (m.children) walk(m.children, `${here}.children`);
    });
  };
  walk(d.messages, 'messages');
  if (count === 0) warnings.push(`${at}: sequence diagram has no messages`);
}
