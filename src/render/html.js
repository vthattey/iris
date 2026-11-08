import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(here('../../package.json'), 'utf8'));

let cache = null;
function assets() {
  if (cache) return cache;
  cache = {
    template: readFileSync(here('../../viewer/template.html'), 'utf8'),
    css: readFileSync(here('../../viewer/viewer.css'), 'utf8'),
    viewer: readFileSync(here('../../viewer/viewer.js'), 'utf8'),
    elk: readFileSync(require.resolve('elkjs/lib/elk.bundled.js'), 'utf8'),
  };
  return cache;
}

// Make arbitrary script text safe inside an inline <script> element.
function inlineScript(js) {
  return js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

const LS = new RegExp('\\u2028', 'g');
const PS = new RegExp('\\u2029', 'g');

// Serialize data so it cannot break out of the <script> element.
function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LS, '\\u2028')
    .replace(PS, '\\u2029');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Render an Iris document to a single self-contained, offline HTML string.
 * Nothing is loaded from the network when the file is opened.
 */
export function renderHtml(doc) {
  const a = assets();
  const title = doc.title || doc.diagrams[0]?.title || 'Iris diagram';
  // Use function replacements so "$" sequences in the payload are not interpreted.
  return a.template
    .replace('__IRIS_VERSION__', () => pkg.version)
    .replace('__IRIS_TITLE__', () => escapeHtml(title))
    .replace('/*__IRIS_CSS__*/', () => a.css.replace(/<\/style/gi, '<\\/style'))
    .replace('/*__ELK__*/', () => inlineScript(a.elk))
    .replace('/*__IRIS_DATA__*/', () => inlineJson(doc))
    .replace('/*__IRIS_VIEWER__*/', () => inlineScript(a.viewer));
}
