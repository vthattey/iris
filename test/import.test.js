import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importFile } from '../src/import/index.js';
import { validate } from '../src/index.js';

const fx = (n) => new URL(`./fixtures/plantuml/${n}.puml`, import.meta.url);
const load = (n) => importFile(`${n}.puml`, readFileSync(fx(n), 'utf8')).diagrams[0];

for (const n of ['class', 'sequence', 'activity', 'state', 'er', 'component']) {
  test(`PlantUML ${n} imports as a valid ${n === 'er' ? 'er' : n} diagram`, () => {
    const d = load(n);
    assert.equal(d.type, n);
    const r = validate({ iris: '1.0', diagrams: [d] });
    assert.deepEqual(r.errors, []);
  });
}

test('PlantUML class details', () => {
  const d = load('class');
  const by = Object.fromEntries(d.elements.map((e) => [e.id, e]));
  assert.equal(by.PaymentService.kind, 'interface');
  assert.equal(by.PaymentService.parent, 'com.app.service');
  assert.equal(by.PaymentServiceImpl.stereotype, 'Service');
  assert.equal(by.TxnStatus.kind, 'enum');
  assert.equal(by.BaseEntity.kind, 'abstract');
  assert.ok(by.PaymentServiceImpl.members.find((m) => m.name === 'MAX_RETRIES').static);
  const assoc = d.relations.find((r) => r.kind === 'association');
  assert.deepEqual([assoc.from, assoc.to, assoc.fromCard, assoc.toCard, assoc.label], ['Transaction', 'Account', '*', '1', 'belongs to']);
});

test('PlantUML sequence nests calls under activations and return', () => {
  const d = load('sequence');
  assert.equal(d.messages.length, 1);
  const top = d.messages[0];
  assert.equal(top.label, 'POST /api/payments');
  const inner = top.children[0];
  assert.equal(inner.label, 'processPayment(req)');
  assert.deepEqual(inner.children.map((m) => m.label), ['INSERT transactions', 'ok', 'Transaction']);
  assert.equal(top.children[1].label, '201');
});

test('PlantUML activity builds decisions and joins', () => {
  const d = load('activity');
  assert.equal(d.elements.filter((e) => e.kind === 'decision').length, 2);
  assert.equal(d.elements.filter((e) => e.kind === 'start').length, 1);
  const respond = d.elements.find((e) => e.label === 'Respond');
  assert.equal(d.relations.filter((r) => r.to === respond.id).length, 3, 'three branches meet at Respond');
});

test('Mermaid inside Markdown imports every block', () => {
  const md = '# x\n```mermaid\nclassDiagram\n  A <|-- B\n```\n\n```mermaid\nerDiagram\n  A ||--o{ B : has\n```\n';
  const doc = importFile('notes.md', md);
  assert.equal(doc.diagrams.length, 2);
  assert.deepEqual(doc.diagrams.map((d) => d.type), ['class', 'er']);
});
