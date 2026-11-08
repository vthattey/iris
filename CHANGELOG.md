# Changelog

All notable changes to Iris are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-08

First public release.

### Added

- **Interactive viewer** in one offline HTML file: everything opens collapsed and expands one level per
  click. Pan, zoom, fit, collapse all, keyboard control, per-diagram links, light and dark themes. ELK layout
  bundled inline.
- **Six diagram types:** class, sequence, activity, component, state and ER, with UML and crow's-foot notation.
  Relations to hidden elements roll up to the nearest visible parent with a count.
- **JSON format** with a JSON Schema and a validator (`iris validate`) that checks references, kinds and
  parent cycles.
- **Code analysis** (`iris analyze`) for Java, TypeScript and Python: class diagrams, ER diagrams from JPA,
  TypeORM, SQLAlchemy and Django mappings, and a call-flow sequence diagram for every entry point (Spring MVC,
  JAX-RS, `@Scheduled`, Quartz, Kafka/JMS/Rabbit/SQS listeners, NestJS, FastAPI/Flask, Celery). Interfaces
  resolve to their single implementation, `@Transactional` boundaries are noted, repository calls end in the
  SQL they imply, and HTTP/database/broker clients appear as external participants.
- **Importers** for PlantUML (class, sequence, activity, state, component, IE/ER) and Mermaid (classDiagram,
  sequenceDiagram, flowchart, stateDiagram, erDiagram, and Markdown with mermaid blocks).
- **Mermaid export** for every diagram type.
- **CLI** (`render`, `validate`, `export`, `import`, `analyze`, `schema`) and a JavaScript API.
- **Agent Skill** for GitHub Copilot, Claude Code and other agents, with a schema guide for agents writing JSON.

[Unreleased]: https://github.com/vthattey/iris/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vthattey/iris/releases/tag/v0.1.0
