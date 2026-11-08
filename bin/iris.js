#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validate } from '../src/model/validate.js';
import { renderHtml } from '../src/render/html.js';
import { exportMermaid, mermaidMarkdown } from '../src/export/mermaid.js';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

const HELP = `Iris ${pkg.version} — interactive UML and ER diagrams

Usage
  iris render   <input.json|->  [-o out.html] [--diagram <id>]
  iris validate <input.json|->
  iris export   <input.json|->  [-o out.md] [--dir <folder>]     Mermaid output
  iris import   <file.mmd|file.puml> [-o out.iris.json]          Mermaid / PlantUML → Iris
  iris analyze  <folder> [--lang java|ts|python] [-o out.iris.json] [--html]
  iris schema                                                     Print the JSON Schema path

Options
  -o, --out       Output file (default: next to the input)
  --diagram       Render only the diagram with this id
  --dir           Export: one .mmd file per diagram into this folder
  --lang          Analyze: java | ts | python (default: the most common in the folder)
  --html          Analyze: also write the interactive HTML next to the JSON
  --title         Analyze: document title (default: folder name)
  --max-depth     Analyze: call-flow depth limit (default 6)
  --max-flows     Analyze: maximum call-flow diagrams (default 300)
  --include-tests Analyze: include test sources
  --keep-accessors Analyze: keep getters/setters in class diagrams
  --strict        Treat validation warnings as errors
  -h, --help      Show this help
  -v, --version   Show the version

Exit codes: 0 ok, 1 invalid input, 2 usage error.`;

function fail(msg, code = 1) { process.stderr.write(`iris: ${msg}\n`); process.exit(code); }

function readInput(path) {
  if (!path) fail('missing input file. Run "iris --help".', 2);
  try {
    const text = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
    return JSON.parse(text);
  } catch (e) {
    fail(`cannot read ${path === '-' ? 'stdin' : path}: ${e.message}`);
  }
}

function checked(doc, strict) {
  const r = validate(doc);
  for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
  if (!r.ok || (strict && r.warnings.length)) {
    for (const e of r.errors) process.stderr.write(`error: ${e}\n`);
    fail(`input is not a valid Iris document (${r.errors.length} error${r.errors.length === 1 ? '' : 's'}${strict && r.warnings.length ? `, ${r.warnings.length} warnings` : ''})`);
  }
  return doc;
}

function defaultOut(input, ext) {
  if (!input || input === '-') return `diagram${ext}`;
  const base = basename(input).replace(/\.iris\.json$|\.json$|\.mmd$|\.puml$|\.plantuml$/i, '');
  return join(dirname(input), base + ext);
}

function write(path, content) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, content);
  process.stdout.write(`${path}\n`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      diagram: { type: 'string' },
      dir: { type: 'string' },
      lang: { type: 'string' },
      title: { type: 'string' },
      html: { type: 'boolean' },
      'include-tests': { type: 'boolean' },
      'keep-accessors': { type: 'boolean' },
      'max-depth': { type: 'string' },
      'max-flows': { type: 'string' },
      strict: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  const [cmd, input] = positionals;
  if (values.version) return process.stdout.write(pkg.version + '\n');
  if (values.help || !cmd) return process.stdout.write(HELP + '\n');

  switch (cmd) {
    case 'render': {
      const doc = checked(readInput(input), values.strict);
      if (values.diagram) {
        const only = doc.diagrams.filter((d) => d.id === values.diagram);
        if (!only.length) fail(`no diagram with id "${values.diagram}"`, 2);
        doc.diagrams = only;
      }
      write(values.out || defaultOut(input, '.html'), renderHtml(doc));
      break;
    }
    case 'validate': {
      checked(readInput(input), values.strict);
      process.stdout.write('valid\n');
      break;
    }
    case 'export': {
      const doc = checked(readInput(input), values.strict);
      if (values.dir) {
        for (const x of exportMermaid(doc)) write(join(values.dir, `${x.id}.mmd`), x.mermaid + '\n');
      } else {
        write(values.out || defaultOut(input, '.mermaid.md'), mermaidMarkdown(doc));
      }
      break;
    }
    case 'import': {
      if (!input) fail('missing file to import', 2);
      const { importFile } = await import('../src/import/index.js');
      const doc = importFile(input, readFileSync(input, 'utf8'));
      checked(doc, false);
      write(values.out || defaultOut(input, '.iris.json'), JSON.stringify(doc, null, 2) + '\n');
      break;
    }
    case 'analyze': {
      if (!input) fail('missing folder to analyze', 2);
      const { analyze } = await import('../src/analyze/index.js');
      const { doc, warnings, stats } = await analyze(input, {
        lang: values.lang, includeTests: values['include-tests'], keepAccessors: values['keep-accessors'],
        maxDepth: values['max-depth'] ? Number(values['max-depth']) : undefined,
        maxFlows: values['max-flows'] ? Number(values['max-flows']) : undefined, title: values.title,
      });
      for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
      process.stderr.write(`analyzed ${stats.files} ${stats.lang} files: ${stats.types} types, ${stats.entries} entry points, ${doc.diagrams.length} diagrams\n`);
      checked(doc, false);
      const out = values.out || 'iris-analysis.iris.json';
      write(out, JSON.stringify(doc, null, 2) + '\n');
      if (values.html) write(out.replace(/(\.iris)?\.json$/, '') + '.html', renderHtml(doc));
      break;
    }
    case 'schema': {
      process.stdout.write(fileURLToPath(new URL('../schema/iris-diagram.schema.json', import.meta.url)) + '\n');
      break;
    }
    default:
      fail(`unknown command "${cmd}". Run "iris --help".`, 2);
  }
}

main().catch((e) => fail(e.stack || e.message));

