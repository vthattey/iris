---
name: iris-diagrams
description: Create interactive UML and ER diagrams (class, sequence, activity/flow, component, state, ER) that open collapsed and expand one level per click, as a single offline HTML file. Use when asked to diagram code, trace a call flow, show a database schema, visualize architecture, or turn PlantUML/Mermaid into an interactive diagram.
---

# Iris — interactive UML and ER diagrams

Iris turns code, existing PlantUML/Mermaid, or a JSON description into **one self-contained HTML file**.
Every diagram opens collapsed; each click opens one more level (a package → its classes, a class → its
members, a call → the calls it makes, a table → its columns). Nothing loads from the network.

## 1. Pick the input path

| You have | Do this |
| --- | --- |
| A code base (Java, TypeScript, Python) | `iris analyze <folder> -o <name>.iris.json --html` |
| PlantUML (`.puml`) or Mermaid (`.mmd`, or Markdown with mermaid blocks) | `iris import <file> -o <name>.iris.json`, then `iris render` |
| Knowledge from other agents, docs, or a description | Write Iris JSON yourself (see section 3), then `iris validate` and `iris render` |

`iris analyze` produces, in one document:
- a **class diagram** (packages → types → members; getters/setters hidden),
- an **ER diagram** when JPA, TypeORM, SQLAlchemy or Django mappings exist,
- one **call-flow sequence diagram per entry point**: Spring/JAX-RS endpoints, `@Scheduled`, Quartz jobs,
  Kafka/JMS/Rabbit listeners, NestJS controllers, FastAPI/Flask routes, Celery tasks.
  Interfaces resolve to their single implementation, repository calls end in the SQL they imply,
  and HTTP/JDBC/broker clients appear as external participants.

Useful flags: `--lang java|ts|python`, `--max-depth 6`, `--max-flows 300`, `--include-tests`, `--keep-accessors`, `--title`.

## 2. Commands

Run from the Iris repository (`node bin/iris.js …`) or after `npm link` as `iris …`.

```
iris render   doc.iris.json -o doc.html [--diagram <id>]   # interactive HTML
iris validate doc.iris.json [--strict]                       # schema + reference checks
iris export   doc.iris.json -o doc.mermaid.md               # Mermaid (fully expanded, static)
iris export   doc.iris.json --dir mermaid/                  # one .mmd per diagram
iris import   diagram.puml -o diagram.iris.json
iris analyze  ./src -o app.iris.json --html
```

Exit code 0 = ok, 1 = invalid input (errors printed to stderr), 2 = usage error. Always run `validate`
(or `render`, which validates) after writing JSON by hand, and fix every error it reports.

## 3. Writing Iris JSON by hand

Read `references/schema-guide.md` before writing JSON. The essentials:

```json
{ "iris": "1.0", "title": "Payments", "diagrams": [ { "id": "classes", "type": "class", "title": "…", "elements": [], "relations": [] } ] }
```

- Graph types (`class`, `component`, `activity`, `state`, `er`) use `elements` + `relations`.
  Nest with `"parent": "<id>"`. Children stay hidden until the parent is clicked.
- `sequence` uses `participants` + `messages`. Put the calls a message triggers in its `children`;
  they stay hidden until that message is clicked.
- `members` (fields, methods, columns) show when a class or table is clicked.

### Design for one-click-at-a-time reading

- Keep the top level small: about 5–12 visible items. Group everything else under packages, systems,
  sub-flows, composite states or schemas.
- Nest by meaning: package → class, system → container → component, step → sub-steps, call → inner calls.
- In sequence diagrams, nest the calls made while handling a message under that message. Do not list
  every call flat at the top level.
- Relations between hidden children are drawn between their nearest visible parents and merged with a
  count (×3), so it is fine to relate deep elements directly.
- Use `source: { file, line }` on elements and messages so readers can jump to the code.

## 4. Deliver

- Give the user the `.html` file. It works offline in any browser; nothing else is needed.
- Add Mermaid (`iris export`) only when the user wants diagrams inside Markdown, a wiki or a pull request.
  Mermaid is static, so it shows everything expanded.
- Mention which diagrams are in the file (the sidebar lists them) and that clicking expands one level.

## 5. Limits to tell the user about

- Code analysis is static: reflection, string-built bean names, AOP proxies and runtime wiring are not
  followed. An interface with several implementations is shown at the interface.
- Activity diagrams are not generated from code yet; they come from PlantUML/Mermaid import or hand-written JSON.
- Very large class graphs (2,000+ types with dense relations) take about a second to re-layout per click.
