# Iris JSON — guide for agents

The formal schema is `schema/iris-diagram.schema.json` (`iris schema` prints its path). This guide shows
every diagram type with a minimal, valid example and the allowed `kind` values.

## Document

```json
{ "iris": "1.0", "title": "Shown in the sidebar", "diagrams": [ ... ] }
```

Every diagram has `id` (unique, letters/digits and `_ . : $ / # @ -`), `type`, optional `title`,
`description` and `direction` (`DOWN`, `RIGHT`, `UP`, `LEFT`).

## Elements and relations (all types except sequence)

```json
{ "id": "PaymentServiceImpl", "label": "PaymentServiceImpl", "kind": "class",
  "parent": "pkg.service", "stereotype": "Service", "note": "tooltip text",
  "source": { "file": "src/main/java/com/app/service/impl/PaymentServiceImpl.java", "line": 31 },
  "expanded": false,
  "members": [ { "name": "processPayment", "kind": "method", "params": "PaymentDTO request", "type": "Transaction", "visibility": "public" } ] }
```

```json
{ "from": "PaymentServiceImpl", "to": "PaymentService", "kind": "realization", "label": "optional", "fromCard": "*", "toCard": "1" }
```

| type | element kinds | relation kinds |
| --- | --- | --- |
| `class` | package, class, interface, abstract, enum, record, annotation | inheritance, realization, association, aggregation, composition, dependency |
| `component` | system, container, component, database, queue, external, actor, node | uses, calls, reads, writes, publishes, subscribes |
| `activity` | start, end, action, decision, merge, fork, join, subflow, note | flow (put guards like "yes"/"no" in `label`) |
| `state` | initial, final, state, composite, choice, history | transition (`label` = "event [guard] / action") |
| `er` | schema, table, view | relationship (`fromCard`/`toCard`: 1, 0..1, *, 1..*) |

Member kinds: `field`, `method`, `constructor`, `column`, `literal` (enum constant).
Member flags: `visibility` (public/private/protected/package), `static`, `abstract`,
`pk`, `fk` ("table.column"), `nullable`, `unique`, `note`.

Containers (may be a `parent`): package, system, container, node, component, subflow, composite, schema.

Direction conventions: `inheritance`/`realization` point from child to parent. `aggregation`/`composition`
point from the whole to the part (the diamond is drawn at `from`). ER relationships point from the table
holding the foreign key to the referenced table, so `fromCard: "*"`, `toCard: "1"` is the usual many-to-one.

## Sequence

```json
{ "id": "post-payments", "type": "sequence", "title": "POST /api/payments",
  "participants": [
    { "id": "client", "label": "Client", "kind": "actor" },
    { "id": "ctrl", "label": "PaymentController", "kind": "boundary" },
    { "id": "svc", "label": "PaymentServiceImpl", "kind": "control" },
    { "id": "db", "label": "Database", "kind": "database" } ],
  "messages": [
    { "from": "client", "to": "ctrl", "label": "POST /api/payments", "children": [
      { "from": "ctrl", "to": "svc", "label": "processPayment(request)", "note": "@Transactional", "children": [
        { "from": "svc", "to": "db", "label": "INSERT INTO transactions" } ] },
      { "from": "ctrl", "to": "client", "label": "201 Created", "kind": "reply" } ] } ] }
```

Participant kinds: participant, actor, boundary, control, entity, database, queue, external.
Message kinds: sync (default), async, reply, create. A message whose `from` equals `to` is a self-call.

## Mapping knowledge from other agents

When another agent (for example a code crawler or database agent) hands you structured knowledge:

| Source knowledge | Iris |
| --- | --- |
| Endpoint call chain (controller → service → repository) | `sequence`: one top message for the endpoint, each call nested under its caller |
| Tables, columns, PK/FK, triggers | `er`: tables as elements, columns as members, FKs as `fk` + a relationship; trigger text in `note` |
| Classes, interfaces, packages | `class`: packages as parents, members, inheritance/realization/dependency relations |
| Services, modules, external systems | `component`: system → container → component, databases and external systems as their own kinds |
| Status columns, lifecycle rules | `state` |
| Business process or branching logic | `activity`: sub-processes as `subflow` with their steps as children |

Validate with `iris validate` and fix every error before rendering.
