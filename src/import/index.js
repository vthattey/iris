import { basename } from 'node:path';
import { importMermaid } from './mermaid.js';
import { importPlantUml } from './plantuml.js';

export { importMermaid, importPlantUml };

/** Import a Mermaid (.mmd/.mermaid/.md) or PlantUML (.puml/.plantuml/.pu) file into an Iris document. */
export function importFile(path, text) {
  const name = basename(path).replace(/\.[^.]+$/, '');
  if (/\.(puml|plantuml|pu|iuml)$/i.test(path) || /^\s*@start(uml|er)/m.test(text)) return importPlantUml(text, name);
  if (/\.md$/i.test(path)) {
    // Markdown: take every ```mermaid block and merge them into one document.
    const blocks = [...text.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
    if (!blocks.length) throw new Error('No ```mermaid blocks found in ' + path);
    const docs = blocks.map((b, i) => importMermaid(b, `${name}-${i + 1}`));
    const diagrams = docs.flatMap((d, i) => d.diagrams.map((x) => ({ ...x, id: `${x.id}-${i + 1}` })));
    return { iris: '1.0', title: name, diagrams };
  }
  return importMermaid(text, name);
}
