import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, resolve as resolvePath } from 'node:path';
import { parserFor } from './parser.js';
import { extractJava } from './java.js';
import { extractTypeScript } from './typescript.js';
import { extractPython } from './python.js';
import { build } from './build.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'dist', 'out', 'bin', '.idea', '.vscode', '.gradle', 'venv', '.venv',
  'env', '__pycache__', '.mvn', '.next', 'coverage', '.tox', 'site-packages', 'generated', 'generated-sources']);
const EXT = { '.java': 'java', '.ts': 'ts', '.tsx': 'tsx', '.mts': 'ts', '.cts': 'ts', '.py': 'python' };
const LANG_OF = { java: 'java', ts: 'ts', tsx: 'ts', python: 'python', typescript: 'ts', py: 'python' };

function isTest(rel) {
  return /(^|\/)(src\/test|test|tests|__tests__|spec)\//.test(rel) || /(Test|Tests|IT)\.java$/.test(rel) || /\.(spec|test)\.tsx?$/.test(rel) ||
    /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(rel) || /\.d\.ts$/.test(rel);
}

function listFiles(root, includeTests) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.') && name !== '.') continue;
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); continue; }
      const ext = name.slice(name.lastIndexOf('.'));
      if (!EXT[ext]) continue;
      const rel = relative(root, p).split('\\').join('/');
      if (!includeTests && isTest(rel)) continue;
      if (st.size > 2_000_000) continue;
      out.push({ path: p, rel, lang: EXT[ext] });
    }
  };
  walk(root);
  return out;
}

/**
 * Analyze a source folder and return an Iris document with a class diagram,
 * an ER diagram (when ORM mappings exist) and one call-flow diagram per entry point.
 */
export async function analyze(root, opts = {}) {
  root = resolvePath(root);
  const all = listFiles(root, !!opts.includeTests);
  let lang = opts.lang ? LANG_OF[opts.lang.toLowerCase()] : null;
  if (opts.lang && !lang) throw new Error(`Unsupported language "${opts.lang}". Use java, ts or python.`);
  if (!lang) {
    const count = { java: 0, ts: 0, python: 0 };
    for (const f of all) count[LANG_OF[f.lang]]++;
    lang = Object.entries(count).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(count).sort((a, b) => b[1] - a[1])[0][0] : null;
    if (!lang) throw new Error(`No Java, TypeScript or Python files found under ${root}`);
  }
  const files = all.filter((f) => LANG_OF[f.lang] === lang);
  const types = [];
  const errors = [];
  for (const f of files) {
    try {
      const p = await parserFor(f.lang);
      const src = readFileSync(f.path, 'utf8');
      const tree = p.parse(src);
      if (lang === 'java') types.push(...extractJava(tree, f.rel));
      else if (lang === 'ts') types.push(...extractTypeScript(tree, f.rel, f.rel));
      else types.push(...extractPython(tree, f.rel, f.rel));
      tree.delete();

    } catch (e) {
      errors.push(`${f.rel}: ${e.message}`);
    }
  }
  const title = opts.title || basename(root);
  const { doc, warnings, stats } = build(types, { ...opts, title });
  return { doc, warnings: [...errors.map((e) => `could not parse ${e}`), ...warnings], stats: { ...stats, files: files.length, lang } };
}
