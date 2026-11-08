# Code analysis

`iris analyze` reads a source folder statically, with no build, no running application and no database
connection, and produces up to three kinds of diagram.

```bash
iris analyze ./my-service -o my-service.iris.json --html
```

- [How a run works](#how-a-run-works)
- [Class diagram](#class-diagram)
- [ER diagram](#er-diagram)
- [Call flows](#call-flows)
- [Language details](#language-details): [Java](#java) · [TypeScript](#typescript) · [Python](#python)
- [Large and legacy code bases](#large-and-legacy-code-bases)
- [What static analysis cannot see](#what-static-analysis-cannot-see)

## How a run works

1. **Find files.** Iris walks the folder, skipping `node_modules`, `.git`, `target`, `build`, `dist`, `out`,
   `bin`, `.idea`, `.vscode`, `.gradle`, `.mvn`, `venv`, `.venv`, `env`, `__pycache__`, `.next`, `coverage`,
   `.tox`, `site-packages`, `generated` and `generated-sources`, plus hidden folders and files over 2 MB.
   Test sources are skipped unless you pass `--include-tests`.
2. **Pick a language.** The language with the most files wins, unless you pass `--lang`. One language per run.
3. **Parse.** Each file is parsed with [tree-sitter](https://tree-sitter.github.io/) (WebAssembly grammars,
   no native build). A file that fails to parse is reported and skipped.
4. **Extract.** A language extractor turns syntax trees into one neutral model: types, fields, methods,
   parameters, annotations/decorators and the calls each method makes, with each call's receiver typed where
   possible (field, parameter, local variable, `this`, static type).
5. **Build diagrams** from that model, as described below.

## Class diagram

| What you see | Built from |
| --- | --- |
| Packages | Java packages; TypeScript folders; Python modules. With more than 25 packages, they are grouped one level below their common prefix (for example `com.acme.billing`, `com.acme.ledger`). |
| Types | Classes, interfaces, abstract classes, enums, records, annotations; nested types are labelled `Outer.Inner` |
| Stereotypes | The first of `RestController`, `Controller`, `Service`, `Repository`, `Component`, `Configuration`, `Entity`, `MappedSuperclass`, `Embeddable`, `Injectable`, `Path`, `Resolver`, `dataclass`, `Stateless`, `Singleton`; Spring Data interfaces get `«Repository»` |
| Members | Fields (type, visibility, static), enum constants, methods (parameters, return type), constructors with parameters. Annotations such as `@Transactional` appear in tooltips. |
| Hidden by default | Getters and setters whose property matches a field (`getAmount()` when there is an `amount` field), and `serialVersionUID`. `--keep-accessors` keeps them. |
| `inheritance` / `realization` | `extends` / `implements` (and base classes in Python) between project types |
| `dependency` | Fields that are injected (`@Autowired`, `@Inject`, `@Resource`, constructor parameter properties, `self.x` set from an `__init__` parameter) or `final` fields of bean types |
| `association` | Other fields of project types; collections (`List<X>`, `Set<X>`, `X[]`, `list[X]`) get `*` at the far end |

Types outside the project (JDK, frameworks, libraries) are not drawn.

## ER diagram

Built when the code has ORM mappings.

| Framework | Entities | Columns | Keys and relations |
| --- | --- | --- | --- |
| **JPA / Hibernate** (Java) | `@Entity`; table from `@Table(name)`, else `@Entity(name)`, else the class name | Fields, plus fields inherited from `@MappedSuperclass` parents; name from `@Column(name)`; skips `static`, `@Transient`, `@OneToMany`, `@Embedded`, `@ElementCollection` | `@Id`/`@EmbeddedId` → PK; `@Column(nullable = false)`, `@NotNull` → NOT NULL; `@Column(unique = true)` → UQ; `@ManyToOne`/`@OneToOne` → FK column from `@JoinColumn(name)` (default `<field>_id`) and a `*`–`1` / `1`–`1` relationship; `@ManyToMany` (owning side) → `*`–`*` labelled with the `@JoinTable` name; `@Enumerated` noted |
| **TypeORM** (TypeScript) | `@Entity('name')` or `@Entity({ name })` | Properties with `@Column`, `@PrimaryGeneratedColumn`, `@PrimaryColumn`; name from `{ name }` | `@ManyToOne(() => X)` + `@JoinColumn({ name })` → FK |
| **SQLAlchemy** (Python) | Classes with `__tablename__` or `Column(...)`/`mapped_column(...)` attributes | `Column(...)`, `mapped_column(...)`, `Mapped[...]` annotations; type from the first argument | `primary_key=True`, `nullable=False`, `unique=True`, `ForeignKey("table.col")`; `relationship()` is not a column |
| **Django** (Python) | Subclasses of `models.Model`; table `<app>_<model>` | `models.XxxField(...)`; an implicit `id` primary key is added | `models.ForeignKey(X)` / `OneToOneField(X)` → `<field>_id` FK; `unique=True` |

Tables that are referenced but not mapped in the scanned code still appear, with a note saying so.

## Call flows

Iris creates one sequence diagram per **entry point**. The first message comes from a caller (Client,
Scheduler, Message broker or Launcher) into the entry method. Each call inside it is a message you can click
to see the calls *it* makes, down to `--max-depth` levels (default 6).

### Entry points

| Language | Recognised |
| --- | --- |
| Java | `@GetMapping` `@PostMapping` `@PutMapping` `@DeleteMapping` `@PatchMapping` `@RequestMapping` (with class-level `@RequestMapping` prefix and `method = RequestMethod.X`); JAX-RS `@Path` + `@GET` `@POST` `@PUT` `@DELETE` `@PATCH` `@HEAD` `@OPTIONS`; `@Scheduled(cron / fixedRate / fixedDelay)`; Quartz `execute`/`executeInternal` on `Job`/`QuartzJobBean`; `@KafkaListener` `@JmsListener` `@RabbitListener` `@SqsListener` `@StreamListener` `@EventListener`; `public static void main` |
| TypeScript | NestJS `@Controller(path)` + `@Get` `@Post` `@Put` `@Delete` `@Patch` `@All`; `@Cron`, `@Interval`; `@MessagePattern`, `@EventPattern` |
| Python | `@<app>.get/post/put/delete/patch(path)` (FastAPI, Flask 2+), `@<app>.route(path, methods=[...])`, `@api_route`; Celery `@task` / `@shared_task` |

Flows are titled by their entry, for example `POST /api/payments` or `cron 0 0 2 * * ? — SettlementJob.settle()`,
and sorted alphabetically. Only the first `--max-flows` (default 300) are kept.

### Which calls appear

A call is resolved by its receiver: `this`/`self`, a field (including inherited fields), a parameter, a
local variable, or a static type. Iris then keeps it when it is useful for tracing:

| Kept | Example |
| --- | --- |
| Calls on the same object | `validate(request)`, `this.audit()` |
| Calls through fields, including injected beans | `paymentService.process(dto)` |
| Calls on beans and repositories through locals or parameters | `repo.save(x)` |
| HTTP clients → an **External HTTP API** participant | `restTemplate.postForObject(url, …)`, `webClient…`, `requests.post(…)`, `axios.get(…)`, `fetch(…)` |
| Database clients → a **Database** participant | `jdbcTemplate.query(sql, …)`, `entityManager.persist(…)`, `sqlSession.selectList(…)`, TypeORM `Repository<T>`, `session.add(…)`, `cursor.execute(…)` |
| Message brokers → a **Message broker** participant (async arrow) | `kafkaTemplate.send(topic, …)`, `jmsTemplate.convertAndSend(…)`, `rabbitTemplate…`, `streamBridge…`, `eventPublisher.publishEvent(…)` |

| Dropped | Why |
| --- | --- |
| Getters and setters on other objects | `account.getBalance()` adds noise, not flow |
| Calls on entities and DTOs held in local variables (Java, TypeScript) | Data access, not control flow |
| Calls to types outside the project, including JDK and framework methods | They can't be followed |
| Calls whose receiver type can't be determined | Iris won't guess |

Notes on a call:

- `via PaymentService`: the call was made through an interface and resolved to its only implementation.
- `@Transactional` (with propagation such as `REQUIRES_NEW`): the called method or its class is transactional.
- `depth limit reached`: the callee makes further calls beyond `--max-depth`.
- `↺ recursive`: the call re-enters a method already on the path.

### Database steps

A call to a repository ends in a **Database** step when the table is known:

| Method name | Step |
| --- | --- |
| `save…`, `insert…`, `persist…`, `create…`, `add…`, `store…`, `update…`, `merge…`, `upsert…` | `INSERT/UPDATE <table>` |
| `delete…`, `remove…`, `destroy…` | `DELETE FROM <table>` |
| `find…`, `get…`, `read…`, `query…`, `search…`, `exists…`, `count…`, `stream…`, `list…`, `load…`, `fetch…` | `SELECT FROM <table>` |
| Method annotated `@Query("…")` | The query text |

The table comes from the repository's entity type (`JpaRepository<Account, Long>` → the `Account` entity's
table). For Spring Data interfaces without an implementation, a step is added even when the table is unknown.

## Language details

### Java

- Grammar covers Java 8 through 21 syntax: generics, lambdas, records, `var`, switch expressions.
- Packages from `package` declarations; single-type `import`s are used to disambiguate same-named classes.
- Beans: `@Service`, `@Component`, `@Repository`, `@Controller`, `@RestController`, `@Configuration`, `@Named`,
  `@Singleton`, `@ApplicationScoped`, `@RequestScoped`, `@Stateless`, `@Stateful`, JAX-RS `@Path`; interfaces
  extending `*Repository` (Spring Data); classes named `*Repository`, `*Repo`, `*Dao`.
- Interface or abstract class with exactly one concrete implementation in the project → calls go to it.

### TypeScript

- `.ts`, `.tsx`, `.mts`, `.cts`; declaration files (`.d.ts`) are skipped.
- Packages are folders relative to the analyzed root.
- Classes, abstract classes, interfaces, enums, decorators (on classes, members and parameters).
- Constructor parameter properties (`constructor(private readonly svc: Svc)`) become injected fields.
- Top-level functions and arrow functions are tracked for calls between functions.

### Python

- Modules are dotted paths relative to the analyzed root (`app/services.py` → `app.services`).
- Fields: class attributes, annotated attributes (dataclasses), `self.x` assignments in `__init__` (typed from
  an annotation, a constructor call such as `self.repo = Repo()`, or a typed parameter), and `@property`.
- `Enum` subclasses → enums; `ABC` → abstract; `Protocol` → interface. `@staticmethod`/`@classmethod` → static.
- Module-level instances (`service = PaymentService()`) are used to resolve calls from route functions.
- Visibility: `_name` → protected, `__name` → private.

## Large and legacy code bases

- **Start with one module.** `iris analyze path/to/module` gives a readable first picture faster than the whole tree.
- **Use the JSON.** `--html` is a convenience; the JSON is the real output. Edit it to regroup packages,
  rename, or delete noise, then `iris render`.
- **Split huge flows.** If a flow is too deep, lower `--max-depth`. If you have more endpoints than
  `--max-flows`, raise it or analyze modules separately.
- **Keep the ER honest.** The ER diagram reflects the *mappings*, not the live schema. Columns used only by
  stored procedures, triggers and legacy tables without entities won't appear. Write those into the JSON or
  generate an ER diagram from your database catalog using the [JSON format](json-format.md).
- **Java 8 specifics.** Field injection with `@Autowired`, `javax.*` annotations, `RestTemplate` and JAX-RS are
  all recognised. Spring XML bean definitions and MyBatis mapper XML are not read yet (on the roadmap).

## What static analysis cannot see

- Beans wired only in XML, by string name, or by reflection
- Which implementation runs when an interface has several (the flow stops at the interface)
- AOP advice, proxies and interceptors (except that `@Transactional` is noted)
- Calls made through lambdas passed to frameworks, callbacks and event buses (other than the publish call itself)
- SQL built at runtime (the call to `JdbcTemplate` shows its first argument as written)

Treat generated diagrams as an accurate map of what the code says, and check runtime behaviour with logs or
tracing where it matters.
