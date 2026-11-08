# Iris

**Interactive UML and ER diagrams that open collapsed and expand one level per click.**

Big diagrams are hard to read when everything is drawn at once. Iris shows the top level first, and you
click to open one more level at a time: a package → its classes → their members, an endpoint → the calls it
makes → the calls those make, a table → its columns.

- **Six diagram types:** class, sequence, activity/flow, component, state, ER
- **One offline HTML file:** layout engine bundled, nothing loaded from the network
- **Three ways in:** analyze a code base (Java, TypeScript, Python), import PlantUML or Mermaid, or write JSON
- **Mermaid out:** export any diagram for Markdown, wikis and pull requests
- **Two ways to use it:** a command-line tool, and an Agent Skill for GitHub Copilot, Claude Code and other agents
- **Smooth up to ~2,000 nodes:** only what is open is laid out

## Quick start

```bash
git clone <this repo> iris && cd iris
npm install
npm link            # optional: puts `iris` on your PATH (otherwise use `node bin/iris.js`)

iris render examples/payments.iris.json -o payments.html
open payments.html  # or double-click it
```

Requires Node.js 18 or later.

## Diagram a code base

```bash
iris analyze path/to/project -o project.iris.json --html
```

This writes `project.iris.json` and `project.html` with:

| Diagram | Built from |
| --- | --- |
| Class diagram | Packages → types → fields, methods, enum constants. Inheritance, realization, dependencies (injected fields) and associations. Getters/setters are hidden when a matching field exists (`--keep-accessors` keeps them). |
| ER diagram | JPA (`@Entity`, `@Table`, `@Column`, `@Id`, `@ManyToOne`, `@JoinColumn`, `@MappedSuperclass`, `@Transient`), TypeORM, SQLAlchemy and Django models. |
| One call flow per entry point | Spring MVC and JAX-RS endpoints, `@Scheduled`, Quartz jobs, Kafka/JMS/Rabbit listeners, `main`; NestJS controllers and `@Cron`; FastAPI/Flask routes and Celery tasks. Interfaces resolve to their single implementation, `@Transactional` boundaries are marked, Spring Data repository calls end in the SQL they imply, and `RestTemplate`/`WebClient`, JDBC/`EntityManager` and Kafka/JMS clients appear as external participants. |

Options: `--lang java|ts|python` (default: whichever is most common), `--max-depth 6`, `--max-flows 300`,
`--include-tests`, `--keep-accessors`, `--title`.

Tested on Java 8 code (Spring Boot, JPA); the Java parser handles Java 8 through 21 syntax.

## Import PlantUML or Mermaid

```bash
iris import architecture.puml -o architecture.iris.json
iris import notes.md -o notes.iris.json      # every ```mermaid block in the file
iris render architecture.iris.json
```

| Format | Supported diagrams |
| --- | --- |
| PlantUML | class (packages, stereotypes, members, all relation arrows), sequence (activate/deactivate, `++`/`--`, `return`), activity (new syntax: if/elseif/else, while, repeat, fork, partition), state (composite), component/deployment, IE entity |
| Mermaid | classDiagram (namespaces), sequenceDiagram (activations become nesting), flowchart/graph (subgraphs), stateDiagram-v2, erDiagram |

## Write diagrams as JSON

```json
{
  "iris": "1.0",
  "title": "Payments",
  "diagrams": [{
    "id": "schema", "type": "er", "title": "Payments schema",
    "elements": [
      { "id": "accounts", "kind": "table", "members": [
        { "name": "id", "kind": "column", "type": "BIGINT", "pk": true } ] },
      { "id": "transactions", "kind": "table", "members": [
        { "name": "id", "kind": "column", "type": "BIGINT", "pk": true },
        { "name": "account_id", "kind": "column", "type": "BIGINT", "fk": "accounts.id" } ] }
    ],
    "relations": [ { "from": "transactions", "to": "accounts", "kind": "relationship", "fromCard": "*", "toCard": "1" } ]
  }]
}
```

- Nest elements with `"parent"`; children stay hidden until the parent is clicked.
- In sequence diagrams, put the calls a message triggers in its `"children"`.
- Full reference: [`skill/iris/references/schema-guide.md`](skill/iris/references/schema-guide.md) and the JSON Schema in
  [`schema/iris-diagram.schema.json`](schema/iris-diagram.schema.json). [`examples/payments.iris.json`](examples/payments.iris.json)
  has one diagram of every type.

## Commands

| Command | What it does |
| --- | --- |
| `iris render <doc.json> [-o out.html] [--diagram id]` | Interactive single-file HTML |
| `iris validate <doc.json> [--strict]` | Schema and reference checks (unknown ids, wrong kinds, parent cycles) |
| `iris export <doc.json> [-o out.md] [--dir folder]` | Mermaid, as one Markdown file or one `.mmd` per diagram |
| `iris import <file.puml\|file.mmd\|file.md> [-o out.json]` | PlantUML / Mermaid → Iris JSON |
| `iris analyze <folder> [-o out.json] [--html]` | Code → class, ER and call-flow diagrams |
| `iris schema` | Prints the path of the JSON Schema |

`-` reads the input from stdin. Exit codes: 0 ok, 1 invalid input, 2 usage error.

## Use it from an agent

The Agent Skill in [`skill/iris/`](skill/iris/SKILL.md) teaches an agent when and how to use Iris.

| Agent | Where to put the skill folder |
| --- | --- |
| GitHub Copilot | `.github/skills/iris/` in the repository (or `~/.copilot/skills/iris/` for yourself) |
| Claude Code | `.claude/skills/iris/` (or `~/.claude/skills/iris/`) |
| Other agents with Agent Skills support | Their skills folder (for example `.agents/skills/iris/`) |

The skill calls the CLI, so install Iris on the same machine (`npm link` in this repo) or point the skill at
`node /path/to/iris/bin/iris.js`.

From other tools or agents, the contract is simple: produce Iris JSON (from your own knowledge store, a crawl,
or a schema dump), run `iris validate`, then `iris render`. The guide's last section maps common agent outputs
(call chains, table schemas, service maps) to diagram types.

### Library API

```js
import { writeFileSync } from 'node:fs';
import { validate, renderHtml, exportMermaid } from 'iris-diagrams';
import { analyze } from 'iris-diagrams/analyze';
import { importFile } from 'iris-diagrams/import';

const { doc } = await analyze('./src');
if (validate(doc).ok) writeFileSync('app.html', renderHtml(doc));
```

## How it works

- **Viewer** (`viewer/`): vanilla JavaScript and SVG with the [ELK](https://github.com/kieler/elkjs) layered
  layout engine bundled inline. Only open elements are laid out. Relations to hidden children are drawn to
  their nearest visible parent and merged with a count. After each click the clicked element stays where it was
  on screen. Keyboard: Tab to a node, Enter/Space to expand, `+`/`-` to zoom, `0` to fit.
- **Analyzers** (`src/analyze/`): tree-sitter grammars (WebAssembly, no native build) feed one
  language-neutral model. The class, ER and flow builders work on that model.
- **Importers** (`src/import/`) and **Mermaid export** (`src/export/`) are plain text translators.

## Limits

- Code analysis is static. Reflection, beans named in strings, runtime proxies and dynamic dispatch across
  several implementations are not followed; an interface with several implementations is shown at the interface.
- Activity diagrams are not generated from code yet (import or JSON only).
- Remaining UML types (use case, deployment, object, package, timing, communication, interaction overview,
  composite structure, profile) are planned.

## Development

```bash
npm test                    # unit + analyzer + import tests; the browser test runs when Playwright is installed
npm run examples            # renders examples and fixtures into out/examples
```

## Licence

MIT. Design derived from the MIT-licensed code-flow-graph skill; see [NOTICE](NOTICE). The bundled ELK layout
engine is EPL-2.0.
