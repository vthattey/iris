# Iris JSON format

An Iris document is plain JSON. The formal definition is
[`schema/iris-diagram.schema.json`](../schema/iris-diagram.schema.json) (JSON Schema draft-07);
this page explains it with examples.

- [Document](#document)
- [Graph diagrams: elements and relations](#graph-diagrams-elements-and-relations)
- [Members](#members)
- [Per-type reference](#per-type-reference): [class](#class) · [component](#component) · [activity](#activity) · [state](#state) · [ER](#er)
- [Sequence diagrams](#sequence-diagrams)
- [Designing for one-click-at-a-time](#designing-for-one-click-at-a-time)
- [Validation rules](#validation-rules)

## Document

```json
{
  "iris": "1.0",
  "title": "Payments monolith",
  "diagrams": [ { "id": "classes", "type": "class", "title": "Domain model", "elements": [], "relations": [] } ]
}
```

| Field | Required | Description |
| --- | --- | --- |
| `iris` | yes | Format version. Always `"1.0"` for this release. |
| `title` | no | Shown at the top of the sidebar and in the browser tab |
| `diagrams` | yes | One or more diagrams. Each appears in the sidebar. |

Every diagram has:

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique in the document. Letters, digits and `_ . : $ / # @ -`. Used in the URL (`file.html#id`). |
| `type` | yes | `class`, `sequence`, `activity`, `component`, `state` or `er` |
| `title` | no | Heading above the diagram and its sidebar label (defaults to `id`) |
| `description` | no | One line under the heading. A good place for "click a package to see its classes". |
| `direction` | no | Main layout direction for graph types: `DOWN` (default for class, activity, state) or `RIGHT` (default for component and ER), `UP`, `LEFT` |

## Graph diagrams: elements and relations

Class, component, activity, state and ER diagrams use `elements` and `relations`.

```json
{
  "id": "PaymentServiceImpl",
  "label": "PaymentServiceImpl",
  "kind": "class",
  "parent": "pkg.service",
  "stereotype": "Service",
  "note": "Shown in the tooltip",
  "source": { "file": "src/main/java/com/app/service/impl/PaymentServiceImpl.java", "line": 31 },
  "expanded": false,
  "members": [ { "name": "processPayment", "kind": "method", "params": "PaymentDTO request", "type": "Transaction" } ]
}
```

| Element field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique within the diagram |
| `kind` | yes | Shape and meaning; allowed values depend on the diagram type (below) |
| `label` | no | Display text (defaults to `id`) |
| `parent` | no | Id of the containing element. **Children stay hidden until the parent is clicked.** |
| `stereotype` | no | Shown as `«stereotype»` above the name |
| `members` | no | Fields, methods, columns, enum constants. **Shown when the element is clicked.** |
| `note` | no | Tooltip text |
| `source` | no | `{ "file", "line" }`, shown in the tooltip |
| `expanded` | no | `true` to start this element open |

```json
{ "from": "Transaction", "to": "Account", "kind": "association", "label": "belongs to", "fromCard": "*", "toCard": "1" }
```

| Relation field | Required | Description |
| --- | --- | --- |
| `from`, `to` | yes | Element ids. They may be deeply nested; while hidden, the relation is drawn to the nearest visible parent. |
| `kind` | yes | Line style and arrowheads; allowed values depend on the diagram type |
| `label` | no | Text on the line: a guard, event, method or relationship name |
| `fromCard`, `toCard` | no | Multiplicity at each end: `1`, `0..1`, `*`, `1..*` (any text is shown in class diagrams) |

When several relations end up between the same two visible elements (because their real endpoints are
hidden), Iris draws one line labelled with the count, for example `×3`.

## Members

| Field | Applies to | Description |
| --- | --- | --- |
| `name` | all | Required |
| `kind` | all | `field`, `method`, `constructor`, `column`, `literal` (enum constant) |
| `type` | all | Field or column type, or method return type |
| `params` | methods | Parameter list as written, e.g. `"PaymentDTO request, boolean dryRun"` |
| `visibility` | class members | `public` (+), `private` (−), `protected` (#), `package` (~) |
| `static`, `abstract` | class members | Static members are underlined, abstract ones italic |
| `pk`, `fk`, `unique`, `nullable` | columns | `fk` is the referenced column, e.g. `"accounts.id"`. Shown as PK/FK/UQ badges; NOT NULL in the tooltip. |
| `note` | all | Tooltip text, e.g. an annotation or a CHECK constraint |

In class diagrams, fields and enum constants are drawn in one compartment and methods in another.

## Per-type reference

### Class

| Element kinds | `package`, `class`, `interface`, `abstract`, `enum`, `record`, `annotation` |
| --- | --- |
| Relation kinds | `inheritance` (child → parent, hollow triangle), `realization` (class → interface, dashed hollow triangle), `association` (open arrow), `aggregation` (hollow diamond at `from`), `composition` (filled diamond at `from`), `dependency` (dashed open arrow) |
| Containers | `package` (packages may nest) |

### Component

| Element kinds | `system`, `container`, `component`, `node`, `database` (cylinder), `queue`, `external` (dashed), `actor` |
| --- | --- |
| Relation kinds | `uses`, `calls`, `reads`, `writes` (solid arrows), `publishes`, `subscribes` (dashed arrows) |
| Containers | `system`, `container`, `node`, `component` |

### Activity

| Element kinds | `start`, `end`, `action`, `decision`, `merge`, `fork`, `join`, `subflow`, `note` |
| --- | --- |
| Relation kinds | `flow`. Put branch guards (`yes`, `no`, `[amount > 0]`) in `label`. |
| Containers | `subflow`. Its steps stay hidden until it is clicked. |

### State

| Element kinds | `initial`, `final`, `state`, `composite`, `choice`, `history` |
| --- | --- |
| Relation kinds | `transition`. Use `label` for `event [guard] / action`. |
| Containers | `composite` |

### ER

| Element kinds | `table`, `view`, `schema` |
| --- | --- |
| Relation kinds | `relationship`. Point from the table holding the foreign key to the referenced table. `fromCard`/`toCard` become crow's-foot ends: `1` (‖), `0..1` (o‖), `*` (o<), `1..*` (‖<). |
| Containers | `schema` |

```json
{ "from": "transactions", "to": "accounts", "kind": "relationship", "fromCard": "*", "toCard": "1", "label": "belongs to" }
```

## Sequence diagrams

Sequence diagrams use `participants` and `messages` instead of elements and relations.

```json
{
  "id": "post-payments",
  "type": "sequence",
  "title": "POST /api/payments",
  "participants": [
    { "id": "client", "label": "Client", "kind": "actor" },
    { "id": "ctrl", "label": "PaymentController", "kind": "boundary" },
    { "id": "svc", "label": "PaymentServiceImpl", "kind": "control" },
    { "id": "db", "label": "Database", "kind": "database" }
  ],
  "messages": [
    { "from": "client", "to": "ctrl", "label": "POST /api/payments", "children": [
      { "from": "ctrl", "to": "svc", "label": "processPayment(request)", "note": "@Transactional", "children": [
        { "from": "svc", "to": "db", "label": "INSERT INTO transactions" }
      ] },
      { "from": "ctrl", "to": "client", "label": "201 Created", "kind": "reply" }
    ] }
  ]
}
```

| Participant field | Description |
| --- | --- |
| `id` | Required, unique |
| `label` | Display name |
| `kind` | `participant` (default), `actor`, `boundary`, `control`, `entity`, `database`, `queue`, `external` |
| `source` | `{ file, line }` |

| Message field | Description |
| --- | --- |
| `from`, `to`, `label` | Required. `from` equal to `to` draws a self-call loop. |
| `kind` | `sync` (default, filled arrow), `async` (open arrow), `reply` (dashed), `create` |
| `children` | Messages sent while handling this one. **Hidden until this message is clicked.** A collapsed message shows ▸ and the number of calls inside. |
| `note` | Small box under the arrow |
| `source` | `{ file, line }`, shown in the tooltip |
| `expanded` | `true` to start open |

An opened message draws an activation bar on the receiving lifeline that spans its children.

## Designing for one-click-at-a-time

- **Keep the first screen small:** about 5–12 visible items. Put everything else under packages, systems,
  sub-flows, composite states or schemas.
- **Nest by meaning:** package → class, system → container → component, step → sub-steps, call → inner calls.
- **Relate the real elements, not their containers.** Iris rolls relations up to whatever is visible, so the
  same JSON reads well at every level.
- **In sequence diagrams, nest instead of listing.** A flat list of 40 calls is a wall; the same calls nested
  under the calls that make them open one meaningful step at a time.
- **Add `source` locations** so readers can jump from the diagram to the code.

## Validation rules

`iris validate` (and every command that reads a document) checks:

| Check | Result |
| --- | --- |
| Schema (required fields, value types, allowed enums, id pattern) | error |
| Duplicate diagram, element or participant id | error |
| Element or relation `kind` not allowed for the diagram type | error |
| `parent`, relation `from`/`to` or message `from`/`to` refers to an unknown id | error |
| Parent cycle | error |
| Child placed inside a kind that is not normally a container | warning |
| ER `fk` refers to an unknown table | warning |
| Sequence diagram with no messages | warning |

`--strict` turns warnings into errors.
