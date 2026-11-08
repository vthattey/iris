import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, renderHtml, exportMermaid } from '../src/index.js';
import { importMermaid } from '../src/import/mermaid.js';

const example = () => JSON.parse(readFileSync(new URL('../examples/payments.iris.json', import.meta.url), 'utf8'));

test('example document is valid', () => {
  const r = validate(example());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('validator catches wrong kinds, dangling ids and parent cycles', () => {
  const doc = {
    iris: '1.0',
    diagrams: [{
      id: 'd', type: 'class',
      elements: [
        { id: 'A', kind: 'table' },
        { id: 'B', kind: 'class', parent: 'C' },
        { id: 'C', kind: 'package', parent: 'B' },
      ],
      relations: [{ from: 'A', to: 'Z', kind: 'flow' }],
    }],
  };
  const r = validate(doc);
  assert.equal(r.ok, false);
  const all = r.errors.join('\n');
  assert.match(all, /kind "table"/);
  assert.match(all, /unknown element "Z"/);
  assert.match(all, /kind "flow"/);
  assert.match(all, /parent cycle/);
});

test('sequence diagrams need participants and messages', () => {
  const r = validate({ iris: '1.0', diagrams: [{ id: 's', type: 'sequence', participants: [{ id: 'a' }], messages: [{ from: 'a', to: 'b', label: 'x' }] }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /unknown participant "b"/);
});

test('rendered HTML is self-contained and script-safe', () => {
  const doc = example();
  doc.diagrams[0].title = 'Evil </script><script>alert(1)</script>';
  const html = renderHtml(doc);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/<script[^>]+src=/i.test(html), 'no external scripts');
  assert.ok(!/<link[^>]+href=/i.test(html), 'no external stylesheets');
  // Only the four structural script tags exist; the payload cannot open a new one.
  assert.equal((html.match(/<script>/g) || []).length, 3);
  assert.equal((html.match(/<\/script>/g) || []).length, 3);
  assert.ok(html.includes('\\u003c/script'));
});

test('Mermaid export covers all six types and round-trips', () => {
  const doc = example();
  const out = exportMermaid(doc);
  assert.equal(out.length, 6);
  const heads = out.map((x) => x.mermaid.split('\n')[0]);
  assert.deepEqual(heads, ['classDiagram', 'sequenceDiagram', 'flowchart TD', 'flowchart LR', 'stateDiagram-v2', 'erDiagram']);
  // Reserved word "end" must not be used as a raw node id.
  assert.ok(!/^\s+end\(/m.test(out[2].mermaid));
  for (const x of out) {
    const back = importMermaid(x.mermaid, x.id);
    const r = validate(back);
    assert.deepEqual(r.errors, [], `${x.id} re-imports cleanly`);
  }
  const cls = importMermaid(out[0].mermaid, 'c').diagrams[0];
  const orig = doc.diagrams[0];
  assert.equal(cls.relations.length, orig.relations.length);
  const members = (d) => d.elements.reduce((n, e) => n + (e.members || []).length, 0);
  assert.equal(members(cls), members(orig));
  const seq = importMermaid(out[1].mermaid, 's').diagrams[0];
  assert.equal(seq.messages.length, 1, 'nesting rebuilt from activations');
  const count = (ms) => ms.reduce((n, m) => n + 1 + count(m.children || []), 0);
  assert.equal(count(seq.messages), count(doc.diagrams[1].messages));
});
