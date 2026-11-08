import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// web-tree-sitter replaces its module exports during init(), so keep the constructor captured here.
const Parser = require('web-tree-sitter');
let ready = null;
const langs = new Map();
const parsers = new Map();

const GRAMMAR = { java: 'java', ts: 'typescript', tsx: 'tsx', python: 'python' };

/** Returns a (reused) tree-sitter parser for the given language key: java | ts | tsx | python. */
export async function parserFor(lang) {
  if (!ready) ready = Parser.init();
  await ready;
  if (!parsers.has(lang)) {
    if (!langs.has(lang)) {
      const wasm = require.resolve(`tree-sitter-wasms/out/tree-sitter-${GRAMMAR[lang]}.wasm`);
      langs.set(lang, await Parser.Language.load(wasm));
    }
    const p = new Parser();
    p.setLanguage(langs.get(lang));
    parsers.set(lang, p);
  }
  return parsers.get(lang);
}
