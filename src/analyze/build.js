// Language-neutral type model → Iris document (class diagram, ER diagram, one call-flow per entry point).
import { baseType, typeArgs, collectionOf, unwrap, stripQuotes, shorten, ACCESSOR, snake } from './common.js';

const ann = (x, name) => (x.annotations || []).find((a) => a.name === name);
const hasAnn = (x, ...names) => (x.annotations || []).some((a) => names.includes(a.name));
const SAFE = (s) => String(s).replace(/[^A-Za-z0-9_.:$/#@\-]/g, '_');

const BEAN_ANN = ['Service', 'Component', 'Repository', 'Controller', 'RestController', 'Configuration', 'Named', 'Singleton',
  'ApplicationScoped', 'RequestScoped', 'Stateless', 'Stateful', 'Path', 'Injectable', 'Resolver', 'Gateway', 'Processor'];
const HTTP_CLIENTS = new Set(['RestTemplate', 'AsyncRestTemplate', 'WebClient', 'RestClient', 'HttpClient', 'CloseableHttpClient',
  'OkHttpClient', 'HttpService', 'AxiosInstance', 'HttpURLConnection', 'Client', 'WebTarget']);
const DB_CLIENTS = new Set(['JdbcTemplate', 'NamedParameterJdbcTemplate', 'SimpleJdbcInsert', 'SimpleJdbcCall', 'EntityManager', 'Session',
  'SessionFactory', 'SqlSession', 'SqlSessionTemplate', 'MongoTemplate', 'DataSource', 'Connection', 'PreparedStatement', 'Statement',
  'DataSourceTransactionManager', 'AsyncSession', 'Cursor', 'Engine', 'Repository', 'EntityRepository', 'DataSourceUtils', 'Pool', 'PoolClient']);
const BROKERS = new Set(['KafkaTemplate', 'JmsTemplate', 'RabbitTemplate', 'AmqpTemplate', 'StreamBridge', 'ApplicationEventPublisher',
  'KafkaProducer', 'Producer', 'ClientProxy', 'EventEmitter2']);
const HTTP_MODULES = new Set(['requests', 'httpx', 'axios', 'aiohttp', 'urllib']);
const DB_MODULES = new Set(['cursor', 'session', 'db', 'conn', 'connection']);
const HTTP_VERBS = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', DeleteMapping: 'DELETE', PatchMapping: 'PATCH',
  GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE', PATCH: 'PATCH', HEAD: 'HEAD', OPTIONS: 'OPTIONS',
  Get: 'GET', Post: 'POST', Put: 'PUT', Delete: 'DELETE', Patch: 'PATCH', All: 'ANY',
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH' };

export function build(types, opts = {}) {
  const maxDepth = opts.maxDepth ?? 6;
  const maxFlows = opts.maxFlows ?? 300;
  const keepAccessors = !!opts.keepAccessors;
  const warnings = [];

  // ---------- index ----------
  const byId = new Map(), byName = new Map(), moduleByFile = new Map();
  for (const t of types) {
    if (byId.has(t.id)) t.id = `${t.id}#${t.file}`;
    byId.set(t.id, t);
    for (const k of new Set([t.simpleName, t.name])) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(t); }
    if (t.kind === 'module') moduleByFile.set(t.file, t);
  }
  const resolve = (name, from) => {
    if (!name) return null;
    const raw = String(unwrap(name)).trim();
    if (byId.has(raw)) return byId.get(raw);
    const b = baseType(raw);
    const imp = from?.imports?.[b];
    if (imp && byId.has(imp)) return byId.get(imp);
    const c = (byName.get(b) || []).filter((x) => x.kind !== 'module');
    if (!c.length) return null;
    if (c.length === 1) return c[0];
    return c.find((x) => x.pkg === from?.pkg) || c.find((x) => imp && x.id.endsWith(imp)) || c[0];
  };
  const supers = (t) => [...t.extends, ...t.implements].map((n) => resolve(n, t)).filter((x) => x && x !== t);
  const subs = new Map();
  for (const t of types) for (const s of supers(t)) { if (!subs.has(s.id)) subs.set(s.id, []); subs.get(s.id).push(t); }
  const concreteImpls = (t, seen = new Set()) => {
    const out = [];
    for (const s of subs.get(t.id) || []) {
      if (seen.has(s.id)) continue; seen.add(s.id);
      if (s.kind === 'interface' || s.kind === 'abstract') out.push(...concreteImpls(s, seen)); else out.push(s);
    }
    return out;
  };
  const hierarchy = (t) => { const out = [], seen = new Set(); const go = (x) => { if (!x || seen.has(x.id)) return; seen.add(x.id); out.push(x); supers(x).forEach(go); }; go(t); return out; };
  const fieldOf = (t, name) => { for (const x of hierarchy(t)) { const f = x.fields.find((ff) => ff.name === name); if (f) return { f, owner: x }; } return null; };
  const findMethod = (t, name, argc) => {
    for (const x of hierarchy(t)) {
      const ms = x.methods.filter((m) => m.name === name && m.kind !== 'constructor');
      if (ms.length) return { m: ms.find((m) => m.params.length === argc) || ms[0], owner: x };
    }
    return null;
  };
  const argCount = (args) => { if (!args.trim()) return 0; let d = 0, n = 1; for (const c of args) { if ('([{<'.includes(c)) d++; else if (')]}>'.includes(c)) d--; else if (c === ',' && d === 0) n++; } return n; };

  const isRepo = (t) => !!t && (hasAnn(t, 'Repository', 'EntityRepository') ||
    (t.kind === 'interface' && t.extends.some((e) => /(^|\.)(\w*Repository|Repository)$/.test(baseType(e)))) ||
    /(Repository|Repo|Dao|DAO)$/.test(t.simpleName));
  const isController = (t) => hasAnn(t, 'RestController', 'Controller', 'Path', 'Resolver');
  const beanMemo = new Map();
  const isBean = (t) => {
    if (!t) return false;
    if (beanMemo.has(t.id)) return beanMemo.get(t.id);
    beanMemo.set(t.id, false);
    let v = hasAnn(t, ...BEAN_ANN) || isRepo(t) || t.lang === 'python';
    if (!v && (t.kind === 'interface' || t.kind === 'abstract')) v = concreteImpls(t).some(isBean);
    if (!v) v = supers(t).some((s) => (s.kind === 'interface' || s.kind === 'abstract') && hasAnn(t, ...BEAN_ANN));
    beanMemo.set(t.id, v);
    return v;
  };
  const roleKind = (t) => (isController(t) || (t.kind === 'module' && t.methods.some((m) => entryOf(t, m))) ? 'boundary' : isRepo(t) ? 'entity' : 'control');

  // ---------- class diagram ----------
  const classTypes = types.filter((t) => t.kind !== 'module');
  const elements = [], relations = [];
  const pkgs = [...new Set(classTypes.map((t) => t.pkg).filter(Boolean))].sort();
  const pkgEl = new Map();
  let groupOf = () => undefined;
  if (pkgs.length > 25) {
    const split = pkgs.map((p) => p.split('.'));
    let pre = 0;
    while (split.every((s) => s.length > pre + 1 && s[pre] === split[0][pre])) pre++;
    const groups = new Set(split.map((s) => s.slice(0, pre + 1).join('.')));
    if (groups.size > 1 && groups.size < pkgs.length) {
      for (const g of groups) elements.push({ id: `group:${g}`, label: g, kind: 'package' });
      groupOf = (p) => { const g = p.split('.').slice(0, pre + 1).join('.'); return groups.has(g) && g !== p ? `group:${g}` : undefined; };
    }
  }
  for (const p of pkgs) { const id = `pkg:${p}`; pkgEl.set(p, id); elements.push({ id, label: p, kind: 'package', parent: groupOf(p) }); }
  const elId = (t) => SAFE(t.id);
  const sig = (t, p) => (t.lang === 'java' ? `${p.type ? p.type + ' ' : ''}${p.name}` : `${p.name}${p.type ? ': ' + p.type : ''}`);
  const STEREO = ['RestController', 'Controller', 'Service', 'Repository', 'Component', 'Configuration', 'Entity', 'MappedSuperclass',
    'Embeddable', 'Injectable', 'Path', 'Resolver', 'dataclass', 'Stateless', 'Singleton'];
  for (const t of classTypes) {
    const members = [];
    const fieldNames = new Set(t.fields.map((f) => f.name.toLowerCase()));
    for (const f of t.fields) {
      if (f.name === 'serialVersionUID') continue;
      const m = { name: f.name, kind: 'field' };
      if (f.type) m.type = f.type;
      if (f.visibility) m.visibility = f.visibility; else if (t.lang === 'java') m.visibility = 'package';
      if (f.static) m.static = true;
      const notes = (f.annotations || []).map((a) => '@' + a.name);
      if (notes.length) m.note = notes.join(' ');
      members.push(m);
    }
    for (const c of t.constants) members.push({ name: c, kind: 'literal' });
    for (const me of t.methods) {
      if (!keepAccessors && ACCESSOR.test(me.name) && me.params.length <= 1) {
        const prop = me.name.replace(/^(get|set|is|has)/, '').toLowerCase();
        if (fieldNames.has(prop)) continue;
      }
      if (me.kind === 'constructor' && !me.params.length) continue;
      const m = { name: me.kind === 'constructor' ? t.simpleName : me.name, kind: me.kind };
      if (me.params.length) m.params = me.params.map((p) => sig(t, p)).join(', ');
      if (me.type) m.type = me.type;
      if (me.visibility) m.visibility = me.visibility; else if (t.lang === 'java') m.visibility = 'package';
      if (me.static) m.static = true;
      if (me.abstract && t.kind !== 'interface') m.abstract = true;
      const notes = (me.annotations || []).filter((a) => a.name !== 'Override').map((a) => '@' + a.name + (a.args?.value ? `("${a.args.value}")` : ''));
      if (notes.length) m.note = notes.join(' ');
      members.push(m);
    }
    const st = (t.annotations || []).find((a) => STEREO.includes(a.name));
    const e = { id: elId(t), label: t.name, kind: t.kind === 'module' ? 'class' : t.kind, parent: pkgEl.get(t.pkg),
      source: { file: t.file, line: t.line } };
    if (st) e.stereotype = st.name;
    else if (isRepo(t) && t.kind === 'interface') e.stereotype = 'Repository';
    if (members.length) e.members = members;
    elements.push(e);
  }
  const relKey = new Set();
  const addRel = (from, to, kind, extra = {}) => {
    const k = `${from}|${to}|${kind}`;
    if (from === to || relKey.has(k)) return;
    relKey.add(k);
    relations.push({ from, to, kind, ...extra });
  };
  for (const t of classTypes) {
    for (const s of t.extends) { const x = resolve(s, t); if (x && x.kind !== 'module') addRel(elId(t), elId(x), 'inheritance'); }
    for (const s of t.implements) { const x = resolve(s, t); if (x && x.kind !== 'module') addRel(elId(t), elId(x), x.kind === 'interface' ? 'realization' : 'inheritance'); }
    for (const f of t.fields) {
      if (!f.type) continue;
      const coll = collectionOf(f.type);
      const x = resolve(coll || unwrap(f.type), t);
      if (!x || x.kind === 'module') continue;
      const injected = f.injected || hasAnn(f, 'Autowired', 'Inject', 'Resource', 'InjectRepository') || (f.final && isBean(x));
      if (injected || (isBean(x) && isBean(t) && !coll)) addRel(elId(t), elId(x), 'dependency');
      else addRel(elId(t), elId(x), 'association', coll ? { toCard: '*' } : {});
    }
  }
  const diagrams = [];
  if (classTypes.length) {
    diagrams.push({ id: 'classes', type: 'class', title: `${opts.title || 'Code'} — classes`,
      description: 'Click a package to see its types, then a type to see its members.', elements, relations });
  }

  // ---------- ER ----------
  const er = buildEr(types, { resolve, hierarchy, supers });
  if (er) diagrams.push(er);

  // ---------- flows ----------
  function entryOf(t, m) {
    if (t.lang === 'java') {
      const clsPath = (ann(t, 'RequestMapping') || ann(t, 'Path'))?.args;
      const base = clsPath ? (clsPath.value ?? clsPath.path ?? '') : '';
      for (const a of m.annotations || []) {
        if (HTTP_VERBS[a.name] && /Mapping$/.test(a.name)) return { kind: 'http', label: `${HTTP_VERBS[a.name]} ${joinPath(base, a.args.value ?? a.args.path ?? '')}` };
        if (a.name === 'RequestMapping') {
          const verb = (a.args.method || '').replace(/.*\./, '').replace(/[{}]/g, '') || 'ANY';
          return { kind: 'http', label: `${verb} ${joinPath(base, a.args.value ?? a.args.path ?? '')}` };
        }
        if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(a.name) && hasAnn(t, 'Path')) {
          return { kind: 'http', label: `${a.name} ${joinPath(base, ann(m, 'Path')?.args.value ?? '')}` };
        }
        if (a.name === 'Scheduled') {
          const s = a.args.cron ? `cron ${a.args.cron}` : a.args.fixedRate ? `every ${a.args.fixedRate} ms` : a.args.fixedDelay ? `${a.args.fixedDelay} ms after last run` : 'scheduled';
          return { kind: 'schedule', label: `${s} — ${t.simpleName}.${m.name}()` };
        }
        if (['KafkaListener', 'JmsListener', 'RabbitListener', 'SqsListener', 'StreamListener'].includes(a.name)) {
          const dest = a.args.topics ?? a.args.destination ?? a.args.queues ?? a.args.value ?? '';
          return { kind: 'message', label: `${a.name.replace('Listener', '')} ${dest}`.trim() };
        }
        if (a.name === 'EventListener') return { kind: 'message', label: `Event ${m.params[0]?.type || ''}`.trim() };
      }
      if ((m.name === 'execute' || m.name === 'executeInternal') && t.extends.concat(t.implements).some((s) => /^(Job|QuartzJobBean|StatefulJob)$/.test(baseType(s)))) {
        return { kind: 'schedule', label: `Quartz job ${t.simpleName}` };
      }
      if (m.name === 'main' && m.static && m.params.length === 1) return { kind: 'main', label: `main — ${t.simpleName}` };
      return null;
    }
    if (t.lang === 'ts') {
      const ctl = ann(t, 'Controller');
      for (const a of m.annotations || []) {
        if (ctl && HTTP_VERBS[a.name] && /^[A-Z]/.test(a.name)) return { kind: 'http', label: `${HTTP_VERBS[a.name]} ${joinPath(ctl.args.value ?? ctl.args.path ?? '', a.args.value ?? '')}` };
        if (a.name === 'Cron' || a.name === 'Interval') return { kind: 'schedule', label: `${a.name.toLowerCase()} ${a.args.value ?? ''} — ${t.simpleName}.${m.name}()` };
        if (a.name === 'MessagePattern' || a.name === 'EventPattern') return { kind: 'message', label: `${a.name.replace('Pattern', '')} ${a.args.value ?? ''}` };
      }
      return null;
    }
    if (t.lang === 'python') {
      for (const a of m.annotations || []) {
        const verb = HTTP_VERBS[a.name];
        if (verb && a.target.includes('.')) return { kind: 'http', label: `${verb} ${a.args.value ?? a.args.path ?? ''}` };
        if ((a.name === 'route' || a.name === 'api_route') && a.target.includes('.')) {
          const ms = (a.args.methods || 'GET').replace(/[[\]'"]/g, '').split(',')[0].trim() || 'GET';
          return { kind: 'http', label: `${ms} ${a.args.value ?? ''}` };
        }
        if (a.name === 'task' || a.name === 'shared_task') return { kind: 'schedule', label: `task ${t.simpleName}.${m.name}()` };
      }
      return null;
    }
    return null;
  }

  const entries = [];
  for (const t of types) for (const m of t.methods) { const e = entryOf(t, m); if (e) entries.push({ t, m, ...e }); }
  entries.sort((a, b) => a.label.localeCompare(b.label));
  if (entries.length > maxFlows) warnings.push(`${entries.length} entry points found; only the first ${maxFlows} get a call-flow diagram (use --max-flows).`);

  const ids = new Set(diagrams.map((d) => d.id));
  for (const en of entries.slice(0, maxFlows)) {
    const d = flowDiagram(en);
    let id = SAFE(`flow-${en.t.simpleName}-${en.m.name}`), i = 2;
    while (ids.has(id)) id = `${SAFE(`flow-${en.t.simpleName}-${en.m.name}`)}-${i++}`;
    ids.add(id);
    d.id = id;
    diagrams.push(d);
  }

  function flowDiagram(en) {
    const participants = [], pset = new Set();
    const part = (id, label, kind) => { if (!pset.has(id)) { pset.add(id); const p = { id }; if (label && label !== id) p.label = label; if (kind) p.kind = kind; participants.push(p); } return id; };
    const caller = part('caller', { http: 'Client', schedule: 'Scheduler', message: 'Message broker', main: 'Launcher' }[en.kind] || 'Caller', en.kind === 'message' ? 'queue' : 'actor');
    const pidOf = (t) => part(SAFE(t.id), t.kind === 'module' ? `${t.name} (module)` : t.name, roleKind(t));

    function expand(t, m, depth, stack) {
      const out = [];
      let fromId = null;
      const fromOf = () => (fromId ||= pidOf(t));
      for (const c of m.calls) {
        const r = target(t, c);
        if (!r) continue;
        const src = { file: t.file, line: c.line };
        if (r.ext) {
          const pid = r.ext === 'http' ? part('http', 'External HTTP API', 'external') : r.ext === 'db' ? part('db', 'Database', 'database') : part('broker', 'Message broker', 'queue');
          out.push({ from: fromOf(), to: pid, label: `${c.name}${c.firstArg ? ' ' + shorten(c.firstArg, 60) : ''}`, ...(r.ext === 'broker' ? { kind: 'async' } : {}), source: src });
          continue;
        }
        const from = fromOf();
        const to = pidOf(r.type);
        const msg = { from, to, label: `${c.name}(${shorten(c.args, 40)})`, source: src };
        const notes = [];
        if (r.iface) notes.push(`via ${r.iface.simpleName}`);
        const tx = r.method && (ann(r.method.m, 'Transactional') || ann(r.method.owner, 'Transactional') || ann(r.method.m, 'transaction.atomic'));
        if (tx) notes.push(`@Transactional${tx.args?.propagation ? ' ' + tx.args.propagation.replace(/.*\./, '') : ''}`);
        if (notes.length) msg.note = notes.join(' · ');
        const key = `${r.type.id}#${c.name}`;
        if (r.method) {
          if (stack.includes(key)) msg.label += '  ↺ recursive';
          else if (depth >= maxDepth) { if (r.method.m.calls.length) msg.note = (msg.note ? msg.note + ' · ' : '') + 'depth limit reached'; }
          else {
            const kids = expand(r.type, r.method.m, depth + 1, [...stack, key]);
            if (kids.length) msg.children = kids;
          }
          const q = ann(r.method.m, 'Query');
          if (q && q.args.value) msg.children = [...(msg.children || []), { from: to, to: part('db', 'Database', 'database'), label: shorten(q.args.value, 70) }];
        }
        const table = isRepo(r.type) ? repoTable(r.type) : null;
        const springData = r.type.kind === 'interface' && !concreteImpls(r.type).length;
        if (isRepo(r.type) && !msg.children && (table || springData)) {
          const op = repoOp(c.name, table);
          if (op) msg.children = [{ from: to, to: part('db', 'Database', 'database'), label: op }];
        }
        out.push(msg);
      }
      return out;
    }
    const top = { from: caller, to: pidOf(en.t), label: en.label, source: { file: en.t.file, line: en.m.line } };
    const kids = expand(en.t, en.m, 1, [`${en.t.id}#${en.m.name}`]);
    if (kids.length) top.children = kids;
    return {
      id: '', type: 'sequence', title: en.label,
      description: `${en.t.name}.${en.m.name}() · ${en.t.file}:${en.m.line} · click a call to see the calls it makes`,
      participants, messages: [top],
    };
  }

  function target(t, c) {
    if (!c.name || !c.recv) return null;
    let tt = null, viaField = false, typeName = null;
    switch (c.recv.kind) {
      case 'self': tt = t; break;
      case 'super': tt = supers(t)[0] || null; break;
      case 'field': {
        const hit = fieldOf(t, c.recv.name);
        if (!hit) {
          const mod = moduleByFile.get(t.file);
          const mf = mod && mod.fields.find((f) => f.name === c.recv.name);
          if (mf) typeName = mf.type;
          else return null;
        } else typeName = hit.f.type;
        viaField = true;
        break;
      }
      case 'var': typeName = c.recv.type; break;
      case 'static': typeName = c.recv.type; break;
      case 'module':
        if (HTTP_MODULES.has(c.recv.name)) return { ext: 'http' };
        if (DB_MODULES.has(c.recv.name) && /^(execute|executemany|query|add|merge|delete|commit|scalars|scalar|get|find|insert|update)/.test(c.name)) return { ext: 'db' };
        return null;
      case 'function': {
        if (c.name === 'fetch') return { ext: 'http' };
        const mod = t.kind === 'module' ? t : moduleByFile.get(t.file);
        let fm = mod && mod.methods.find((m) => m.name === c.name);
        let owner = mod;
        if (!fm && t.imports?.[c.name]) {
          const imp = t.imports[c.name];
          owner = types.find((x) => x.kind === 'module' && (imp === `${x.id}.${c.name}` || imp.replace(/^\.\//, '').replace(/\//g, '.').endsWith(x.id.split('.').pop())));
          fm = owner && owner.methods.find((m) => m.name === c.name);
        }
        return fm ? { type: owner, method: { m: fm, owner } } : null;
      }
      default: return null;
    }
    if (typeName) {
      const b = baseType(typeName);
      if (HTTP_CLIENTS.has(b)) return { ext: 'http' };
      if (BROKERS.has(b)) return { ext: 'broker' };
      if (DB_CLIENTS.has(b) && !resolve(typeName, t)) return { ext: 'db' };
      tt = resolve(collectionOf(typeName) ? null : typeName, t);
    }
    if (!tt) return null;
    let impl = tt;
    if (tt.kind === 'interface' || tt.kind === 'abstract') {
      const im = concreteImpls(tt);
      if (im.length === 1) impl = im[0];
    }
    const self = impl === t || tt === t;
    const meth = findMethod(impl, c.name, argCount(c.args)) || findMethod(tt, c.name, argCount(c.args));
    if (!self && ACCESSOR.test(c.name) && !isBean(impl)) return null;
    if (!meth && !isRepo(tt)) return null;
    if (!self && !viaField && !isBean(impl) && !isRepo(tt) && (t.lang === 'java' || t.lang === 'ts')) return null;
    return { type: impl, iface: impl !== tt ? tt : null, method: meth };
  }

  function repoTable(t) {
    for (const e of t.extends) {
      const a = typeArgs(e);
      if (a.length) { const ent = resolve(a[0], t); if (ent) return tableName(ent); return baseType(a[0]); }
    }
    return null;
  }

  return { doc: { iris: '1.0', title: opts.title || 'Code analysis', diagrams }, warnings, stats: { types: classTypes.length, entries: entries.length } };
}

function joinPath(a, b) {
  a = stripQuotes(a || ''); b = stripQuotes(b || '');
  const p = `/${a}/${b}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
  return p;
}

function repoOp(name, table) {
  const t = table || '?';
  if (/^(save|insert|persist|create|add|store|update|merge|upsert)/i.test(name)) return `INSERT/UPDATE ${t}`;
  if (/^(delete|remove|destroy)/i.test(name)) return `DELETE FROM ${t}`;
  if (/^(find|get|read|query|search|exists|count|stream|list|load|fetch)/i.test(name)) return `SELECT FROM ${t}`;
  return null;
}

// ---------- ER from ORM mappings ----------
function tableName(t) {
  const tb = ann(t, 'Table'), en = ann(t, 'Entity');
  if (tb && (tb.args.name || tb.args.value)) return tb.args.name || tb.args.value;
  if (en && (en.args.name || en.args.value) && !/^\{/.test(en.args.value || '')) return en.args.name || en.args.value;
  const tn = t.fields.find((f) => f.name === '__tablename__');
  if (tn && tn.value) return stripQuotes(tn.value);
  if (t.lang === 'python' && isDjango(t)) {
    // Django's default: <app label>_<model name in lower case>; the app is the package holding models.py
    const parts = t.pkg.split('.');
    const app = parts[parts.length - 1] === 'models' ? parts[parts.length - 2] : parts[parts.length - 1];
    return `${app ? app + '_' : ''}${t.simpleName.toLowerCase()}`;
  }
  return t.simpleName;
}
const isDjango = (t) => t.extends.some((e) => /(^|\.)Model$/.test(e) && /models\./.test(e));
const isSqlAlchemy = (t) => t.lang === 'python' && (t.fields.some((f) => f.name === '__tablename__') || t.fields.some((f) => /^(Column|mapped_column|relationship)\(/.test(f.value || '')));

function buildEr(types, { resolve, hierarchy, supers }) {
  const entities = types.filter((t) => hasAnn(t, 'Entity') || isSqlAlchemy(t) || isDjango(t));
  if (!entities.length) return null;
  const elements = [], relations = [];
  const pkOf = (t) => {
    for (const x of hierarchy(t)) for (const f of x.fields) if (hasAnn(f, 'Id', 'EmbeddedId', 'PrimaryGeneratedColumn', 'PrimaryColumn') || /primary_key\s*=\s*True/.test(f.value || '')) return { name: colName(f, t.lang), type: pyType(f) || f.type };
    if (isDjango(t)) return { name: 'id', type: 'AutoField' };
    return { name: 'id', type: 'id' };
  };
  // TypeORM's first @Column argument is the column type, so only Java (@Column(name=...)) reads `value` as a name.
  const colName = (f, lang) => (ann(f, 'Column')?.args.name || (lang !== 'ts' && ann(f, 'Column')?.args.value) || f.name).replace(/^["']|["']$/g, '');
  for (const t of entities) {
    const table = tableName(t);
    const cols = [];
    const fields = [];
    for (const x of hierarchy(t)) if (x === t || hasAnn(x, 'MappedSuperclass') || (t.lang === 'python' && x !== t)) fields.push(...x.fields);
    for (const f of fields) {
      if (f.static && t.lang === 'java') continue;
      if (f.name === '__tablename__' || f.name === '__table_args__') continue;
      if (hasAnn(f, 'Transient', 'OneToMany', 'Embedded', 'ElementCollection')) continue;
      if (t.lang === 'python' && !/^(Column|mapped_column|models\.\w+|db\.Column)\(/.test(f.value || '') && !/Mapped\[/.test(f.type || '')) continue;
      if (t.lang === 'python' && /^relationship\(|models\.ManyToManyField/.test(f.value || '')) continue;
      const many = ann(f, 'ManyToMany');
      if (many) {
        if (!many.args.mappedBy) {
          const target = resolve(collectionOf(f.type) || f.type, t);
          if (target) relations.push({ from: SAFE(table), to: SAFE(tableName(target)), kind: 'relationship', fromCard: '*', toCard: '*', label: ann(f, 'JoinTable')?.args.name || f.name });
        }
        continue;
      }
      const toOne = ann(f, 'ManyToOne') || ann(f, 'OneToOne');
      const pyFk = (f.value || '').match(/ForeignKey\(\s*["']([\w.]+)["']/) || (f.value || '').match(/models\.(ForeignKey|OneToOneField)\(\s*["']?([\w.]+)["']?/);
      if (toOne || pyFk) {
        if (toOne && toOne.args.mappedBy) continue;
        let targetTable, targetPk = 'id', targetType = 'id';
        if (toOne) {
          const tgtName = (toOne.args.value && /=>\s*(\w+)/.exec(toOne.args.value)?.[1]) || toOne.args.targetEntity?.replace(/\.class$/, '') || f.type;
          const target = resolve(tgtName, t);
          targetTable = target ? tableName(target) : baseType(tgtName);
          if (target) { const pk = pkOf(target); targetPk = pk.name; targetType = pk.type || 'id'; }
        } else if (pyFk[0].startsWith('ForeignKey')) {
          [targetTable, targetPk] = pyFk[1].includes('.') ? pyFk[1].split('.') : [pyFk[1], 'id'];
        } else {
          const target = resolve(pyFk[2].split('.').pop(), t);
          targetTable = target ? tableName(target) : snake(pyFk[2].split('.').pop());
          if (target) targetType = pkOf(target).type;
        }
        const jc = ann(f, 'JoinColumn');
        const name = jc?.args.name || jc?.args.value || (pyFk && !pyFk[0].startsWith('ForeignKey') ? `${f.name}_id` : (pyFk ? f.name : `${f.name}_id`));
        const ownType = pyType(f);
        const col = { name: stripQuotes(name), kind: 'column', type: ownType && !/Field$|^ForeignKey/.test(ownType) ? ownType : baseType(targetType), fk: `${targetTable}.${targetPk}` };
        if (jc?.args.nullable === 'false' || toOne?.args.optional === 'false' || /nullable\s*=\s*False/.test(f.value || '')) col.nullable = false;
        cols.push(col);
        relations.push({ from: SAFE(table), to: SAFE(targetTable), kind: 'relationship', fromCard: ann(f, 'OneToOne') || /OneToOneField/.test(f.value || '') ? '1' : '*', toCard: '1' });
        continue;
      }
      const c = ann(f, 'Column') || {};
      const col = { name: colName(f, t.lang), kind: 'column', type: pyType(f) || baseType(f.type) || 'unknown' };
      if (hasAnn(f, 'Id', 'EmbeddedId', 'PrimaryGeneratedColumn', 'PrimaryColumn') || /primary_key\s*=\s*True/.test(f.value || '')) col.pk = true;
      if (c.args?.nullable === 'false' || hasAnn(f, 'NotNull', 'NonNull') || /nullable\s*=\s*False/.test(f.value || '')) col.nullable = false;
      if (c.args?.unique === 'true' || /unique\s*=\s*True/.test(f.value || '')) col.unique = true;
      if (hasAnn(f, 'Enumerated')) col.note = `enum ${baseType(f.type)}`;
      cols.push(col);
    }
    if (t.lang === 'python' && isDjango(t) && !cols.some((c) => c.pk)) cols.unshift({ name: 'id', kind: 'column', type: 'AutoField', pk: true });
    cols.sort((a, b) => (b.pk ? 1 : 0) - (a.pk ? 1 : 0));
    const e = { id: SAFE(table), label: table !== SAFE(table) ? table : undefined, kind: 'table', source: { file: t.file, line: t.line }, note: `Mapped by ${t.name}` };
    if (!e.label) delete e.label;
    if (cols.length) e.members = cols;
    if (!elements.some((x) => x.id === e.id)) elements.push(e);
    for (const s of supers(t)) if (hasAnn(s, 'Entity')) relations.push({ from: SAFE(table), to: SAFE(tableName(s)), kind: 'relationship', fromCard: '1', toCard: '1', label: 'extends' });
  }
  const ids = new Set(elements.map((e) => e.id));
  for (const r of relations) if (!ids.has(r.to)) { ids.add(r.to); elements.push({ id: r.to, kind: 'table', note: 'Referenced but not mapped in this code base' }); }
  return { id: 'er', type: 'er', title: 'Database tables (from ORM mappings)', description: 'Click a table to see its columns.', elements, relations };
}
function pyType(f) {
  const v = f.value || '';
  let m = v.match(/^(?:db\.)?(?:Column|mapped_column)\(\s*(?:["'][\w]+["']\s*,\s*)?([A-Z]\w*(?:\(\d+(?:,\s*\d+)?\))?)/);
  if (m) return m[1];
  m = v.match(/^models\.(\w+)\(/);
  if (m) return m[1];
  m = (f.type || '').match(/Mapped\[(?:Optional\[)?(\w+)/);
  return m ? m[1] : null;
}
