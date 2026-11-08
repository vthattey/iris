// Renders every example and test fixture into out/examples so they can be opened in a browser.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderHtml, mermaidMarkdown } from '../src/index.js';
import { analyze } from '../src/analyze/index.js';

const out = 'out/examples';
mkdirSync(out, { recursive: true });
for (const f of readdirSync('examples').filter((x) => x.endsWith('.iris.json'))) {
  const doc = JSON.parse(readFileSync(join('examples', f), 'utf8'));
  const base = f.replace(/\.iris\.json$/, '');
  writeFileSync(join(out, `${base}.html`), renderHtml(doc));
  writeFileSync(join(out, `${base}.mermaid.md`), mermaidMarkdown(doc));
  console.log(`${out}/${base}.html`);
}
for (const app of ['java-monolith', 'ts-app', 'python-app']) {
  const { doc } = await analyze(join('test/fixtures', app));
  writeFileSync(join(out, `${app}.html`), renderHtml(doc));
  console.log(`${out}/${app}.html`);
}
