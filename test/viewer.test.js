// Browser test of the interactive viewer. Skipped when Playwright is not installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderHtml } from '../src/index.js';

const require = createRequire(import.meta.url);
let playwright = null;
try { playwright = require('playwright'); } catch { /* optional */ }

test('every diagram opens collapsed and expands one level per click', { skip: !playwright && 'playwright not installed' }, async () => {
  const doc = JSON.parse(readFileSync(new URL('../examples/payments.iris.json', import.meta.url), 'utf8'));
  const file = join(mkdtempSync(join(tmpdir(), 'iris-')), 'payments.html');
  writeFileSync(file, renderHtml(doc));
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // [diagram, ids visible at start, element to click, ids that must appear after one click]
    const cases = [
      ['payment-classes', ['pkg.controller', 'pkg.service', 'pkg.repository', 'pkg.domain'], 'pkg.service', ['PaymentService', 'PaymentServiceImpl', 'RiskClient']],
      ['payment-sequence', ['m0'], 'm0', ['m0.0', 'm0.1']],
      ['payment-flow', ['start', 'lookup', 'risk', 'save', 'end'], 'save', ['save.build', 'save.insert', 'save.trigger']],
      ['payments-components', ['user', 'mono', 'db', 'risk', 'clearing'], 'mono', ['web', 'core']],
      ['transaction-states', ['PENDING', 'PROCESSING', 'SETTLED'], 'PROCESSING', ['PROCESSING.risk', 'PROCESSING.clearing']],
      ['payments-er', ['customers', 'accounts', 'transactions'], 'transactions', []],
    ];
    const open = async (id) => { await page.goto('about:blank'); await page.goto(`file://${file}#${id}`); };
    for (const [id, start, click, revealed] of cases) {
      await open(id);
      await page.waitForFunction(() => document.querySelectorAll('#viewport [data-id]').length > 0);
      const before = await page.evaluate(() => window.__iris.visibleIds());
      for (const s of start) assert.ok(before.includes(s), `${id}: ${s} visible at start`);
      for (const r of revealed) assert.ok(!before.includes(r), `${id}: ${r} hidden at start`);
      await page.click(`#viewport [data-id="${click}"]`);
      await page.waitForFunction((c) => document.querySelector(`[data-id="${c}"]`)?.getAttribute('aria-expanded') === 'true', click);
      const after = await page.evaluate(() => window.__iris.visibleIds());
      for (const r of revealed) assert.ok(after.includes(r), `${id}: ${r} revealed after clicking ${click}`);
      // One level only: grandchildren stay hidden.
      if (id === 'payment-sequence') assert.ok(!after.includes('m0.0.0'), 'grandchild calls stay collapsed');
      if (id === 'payments-components') assert.ok(!after.includes('core.payment'), 'nested components stay collapsed');
    }
    // ER: clicking a table reveals its columns inside the node.
    await open('payments-er');
    await page.waitForSelector('[data-id="transactions"]');
    const rows = async () => page.locator('[data-id="transactions"] text.member').count();
    assert.equal(await rows(), 0);
    await page.click('[data-id="transactions"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-id="transactions"] text.member').length > 0);
    assert.ok(await rows() >= 5);
    // Keyboard: Enter toggles a focused node.
    await open('payment-classes');
    await page.waitForSelector('[data-id="pkg.domain"]');
    await page.focus('[data-id="pkg.domain"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-id="Account"]');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
