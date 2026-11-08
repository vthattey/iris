import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/analyze/index.js';
import { validate } from '../src/index.js';

const fx = (n) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));
const flow = (doc, title) => doc.diagrams.find((d) => d.type === 'sequence' && d.title === title);
const walk = (ms, out = []) => { for (const m of ms) { out.push(m); walk(m.children || [], out); } return out; };

test('Java: class, ER and call-flow diagrams from a Spring monolith', async () => {
  const { doc, warnings } = await analyze(fx('java-monolith'));
  assert.deepEqual(warnings, []);
  assert.deepEqual(validate(doc).errors, []);

  const cls = doc.diagrams.find((d) => d.type === 'class');
  const impl = cls.elements.find((e) => e.label === 'PaymentServiceImpl');
  assert.equal(impl.stereotype, 'Service');
  assert.equal(impl.parent, 'pkg:com.app.service.impl');
  assert.ok(cls.relations.some((r) => r.kind === 'realization' && r.from === 'com.app.service.impl.PaymentServiceImpl' && r.to === 'com.app.service.PaymentService'));
  const dto = cls.elements.find((e) => e.label === 'PaymentDTO');
  assert.ok(!dto.members.some((m) => m.name === 'getAmount'), 'accessors hidden');

  const er = doc.diagrams.find((d) => d.type === 'er');
  const txn = er.elements.find((e) => e.id === 'transactions');
  assert.ok(txn.members.find((m) => m.name === 'id' && m.pk), 'inherited @Id from @MappedSuperclass');
  assert.equal(txn.members.find((m) => m.name === 'account_id').fk, 'accounts.id');
  assert.ok(!txn.members.some((m) => m.name === 'displayLabel'), '@Transient skipped');
  const acc = er.elements.find((e) => e.id === 'accounts');
  const num = acc.members.find((m) => m.name === 'account_number');
  assert.equal(num.unique, true);
  assert.equal(num.nullable, false);
  assert.deepEqual(er.relations.map((r) => [r.from, r.to, r.fromCard, r.toCard]), [['transactions', 'accounts', '*', '1']]);

  const post = flow(doc, 'POST /api/payments');
  assert.ok(post, 'POST endpoint has a flow');
  const msgs = walk(post.messages);
  const process = msgs.find((m) => m.label.startsWith('processPayment'));
  assert.equal(process.to, 'com.app.service.impl.PaymentServiceImpl', 'interface resolved to implementation');
  assert.match(process.note, /via PaymentService/);
  assert.match(process.note, /@Transactional/);
  assert.ok(msgs.some((m) => m.to === 'db' && m.label === 'SELECT FROM accounts'));
  assert.ok(msgs.some((m) => m.to === 'db' && m.label === 'INSERT/UPDATE transactions'));
  assert.ok(msgs.some((m) => m.to === 'http' && /api\/check/.test(m.label)), 'RestTemplate call shown as external HTTP');
  assert.ok(!msgs.some((m) => /^set|^get/.test(m.label)), 'entity accessors filtered');
  assert.ok(flow(doc, 'GET /api/payments/{id}'));
  assert.ok(doc.diagrams.some((d) => d.title.startsWith('cron 0 0 2 * * ?')));
});

test('TypeScript: NestJS controllers, DI and inheritance', async () => {
  const { doc } = await analyze(fx('ts-app'));
  assert.deepEqual(validate(doc).errors, []);
  const cls = doc.diagrams.find((d) => d.type === 'class');
  const svc = cls.elements.find((e) => e.label === 'PaymentsService');
  assert.ok(svc.members.some((m) => m.name === 'accounts' && m.type === 'AccountsRepository'), 'constructor parameter property becomes a field');
  assert.ok(cls.relations.some((r) => r.kind === 'inheritance' && r.to.endsWith('BaseService')));
  assert.ok(cls.relations.some((r) => r.kind === 'realization' && r.to.endsWith('Auditable')));
  const post = flow(doc, 'POST /payments');
  const labels = walk(post.messages).map((m) => m.label);
  assert.ok(labels.includes('process(dto)'));
  assert.ok(labels.some((l) => l.startsWith('findByNumber')));
  assert.ok(flow(doc, 'GET /payments/:id'));
});

test('Python: FastAPI routes, module-level services and dataclasses', async () => {
  const { doc } = await analyze(fx('python-app'));
  assert.deepEqual(validate(doc).errors, []);
  const cls = doc.diagrams.find((d) => d.type === 'class');
  assert.equal(cls.elements.find((e) => e.label === 'PaymentRequest').stereotype, 'dataclass');
  assert.equal(cls.elements.find((e) => e.label === 'Status').kind, 'enum');
  const svc = cls.elements.find((e) => e.label === 'PaymentService');
  assert.ok(svc.members.some((m) => m.name === 'repo' && m.type === 'AccountRepository'));
  const post = flow(doc, 'POST /payments');
  const labels = walk(post.messages).map((m) => m.label);
  assert.ok(labels.includes('process(req)'));
  assert.ok(labels.some((l) => l.startsWith('find_by_number')));
  assert.ok(labels.some((l) => l.startsWith('_validate')));
});
