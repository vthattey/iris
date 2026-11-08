# Command reference

```
iris <command> [input] [options]
```

Every command accepts `-h`/`--help` and `-v`/`--version`. Wherever a command reads an Iris document,
`-` reads it from standard input.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Invalid input: unreadable file, bad JSON, or a document that fails validation (details on stderr) |
| `2` | Usage error: unknown command, missing argument, or `--diagram` id not found |

Output files are printed to stdout, one per line, so scripts can pick them up. Warnings and errors go to stderr.

---

## `iris render`

Renders an Iris document to one self-contained HTML file.

```bash
iris render <doc.iris.json | -> [-o out.html] [--diagram <id>] [--strict]
```

| Option | Default | Description |
| --- | --- | --- |
| `-o, --out <file>` | Input name with `.html` (`diagram.html` for stdin) | Output path. Folders are created as needed. |
| `--diagram <id>` | All diagrams | Render only this diagram. The sidebar is hidden when one diagram remains. |
| `--strict` | Off | Fail on validation warnings as well as errors. |

The document is validated first; rendering stops with exit code 1 if it is invalid.

```bash
iris render examples/payments.iris.json -o site/payments.html
iris render app.iris.json --diagram flow-PaymentController-create -o post-payments.html
cat generated.json | iris render - -o out.html
```

## `iris validate`

Checks a document without rendering it.

```bash
iris validate <doc.iris.json | -> [--strict]
```

Checks performed:

- JSON Schema: required fields, allowed `type`/`kind` values, id format
- Unique diagram ids, and unique element or participant ids within each diagram
- Element `kind` and relation `kind` allowed for the diagram type
- Every `parent`, relation endpoint and message endpoint refers to an existing id
- No parent cycles
- Warnings: a child inside a kind that is not normally a container, an ER foreign key pointing at an unknown
  table, a sequence diagram without messages

Prints `valid` on success.

## `iris export`

Exports diagrams to [Mermaid](https://mermaid.js.org/). Mermaid is static, so every level is written out
expanded.

```bash
iris export <doc.iris.json | -> [-o out.md] [--dir <folder>]
```

| Option | Default | Description |
| --- | --- | --- |
| `-o, --out <file>` | Input name with `.mermaid.md` | One Markdown file with a heading and a fenced `mermaid` block per diagram |
| `--dir <folder>` | — | Instead, one `<diagram-id>.mmd` file per diagram |

| Iris type | Mermaid output |
| --- | --- |
| class | `classDiagram`. Packages become namespaces; generics use Mermaid's `~T~` syntax. |
| sequence | `sequenceDiagram`. Nesting becomes activations (`->>+` … `deactivate`). |
| activity | `flowchart`. Sub-flows become subgraphs; fork/join become black bars. |
| component | `flowchart LR`. Systems and containers become subgraphs; databases use the cylinder shape. |
| state | `stateDiagram-v2`. Composite states become nested blocks; initial/final become `[*]`. |
| er | `erDiagram` with crow's-foot cardinalities and PK/FK/UK markers. |

Ids that are Mermaid keywords (`end`, `class`, `state`…) are renamed automatically.

## `iris import`

Converts PlantUML or Mermaid into an Iris document. See [importing.md](importing.md) for the syntax covered.

```bash
iris import <file> [-o out.iris.json]
```

| Input | Detected by |
| --- | --- |
| PlantUML | Extension `.puml`, `.plantuml`, `.pu`, `.iuml`, or content starting with `@startuml` |
| Mermaid in Markdown | Extension `.md`: every fenced `mermaid` block becomes one diagram |
| Mermaid | Anything else (`.mmd`, `.mermaid`…) |

The result is validated before it is written.

## `iris analyze`

Reads a source folder and writes a class diagram, an ER diagram (when ORM mappings exist) and one call-flow
diagram per entry point. See [code-analysis.md](code-analysis.md) for everything it recognises.

```bash
iris analyze <folder> [-o out.iris.json] [--html] [options]
```

| Option | Default | Description |
| --- | --- | --- |
| `-o, --out <file>` | `iris-analysis.iris.json` in the current folder | Where to write the JSON |
| `--html` | Off | Also write the interactive HTML next to the JSON (`out.html`) |
| `--lang <java\|ts\|python>` | The language with the most files | Language to analyze; one per run |
| `--title <text>` | Folder name | Document title shown in the sidebar |
| `--max-depth <n>` | `6` | How many call levels a flow follows before stopping (the call is marked "depth limit reached") |
| `--max-flows <n>` | `300` | Maximum number of call-flow diagrams; entry points are sorted by label |
| `--include-tests` | Off | Include test sources (`src/test`, `*Test.java`, `*.spec.ts`, `test_*.py`…) |
| `--keep-accessors` | Off | Keep getters and setters in class diagrams |

A summary goes to stderr, for example:

```
analyzed 1040 java files: 1200 types, 320 entry points, 302 diagrams
```

Files that can't be parsed are reported as warnings and skipped; the rest of the analysis continues.

## `iris schema`

Prints the absolute path of the JSON Schema, for editors and validators:

```bash
code "$(iris schema)"
```

To get completion and validation in VS Code, add to `.vscode/settings.json`:

```json
{ "json.schemas": [ { "fileMatch": ["*.iris.json"], "url": "./node_modules/iris-diagrams/schema/iris-diagram.schema.json" } ] }
```
