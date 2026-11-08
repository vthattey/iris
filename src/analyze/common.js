// Helpers shared by the language extractors and the diagram builder.

/** Base name of a type: "List<Account>" → "List", "Account[]" → "Account", "a.b.C" → "C". */
export function baseType(t) {
  if (!t) return '';
  let s = String(t).trim().replace(/^:\s*/, '').replace(/\?$/, '');
  s = s.replace(/<[\s\S]*$/, '').replace(/\[[\s\S]*$/, '').replace(/\[\]$/, '').trim();
  s = s.replace(/^(final|readonly)\s+/, '');
  const parts = s.split('.');
  return parts[parts.length - 1];
}

/** Generic arguments: "Map<String, List<Account>>" → ["String", "List<Account>"]. */
export function typeArgs(t) {
  const s = String(t || '');
  const i = s.indexOf('<'), j = s.lastIndexOf('>');
  const sq = s.indexOf('['), sj = s.lastIndexOf(']');
  let inner = null;
  if (i >= 0 && j > i) inner = s.slice(i + 1, j);
  else if (sq >= 0 && sj > sq + 1) inner = s.slice(sq + 1, sj); // Python List[Account]
  if (!inner) return [];
  const out = [];
  let depth = 0, cur = '';
  for (const c of inner) {
    if (c === '<' || c === '[') depth++;
    if (c === '>' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COLLECTIONS = new Set(['List', 'Set', 'Collection', 'Iterable', 'ArrayList', 'LinkedList', 'HashSet', 'TreeSet',
  'LinkedHashSet', 'SortedSet', 'Queue', 'Deque', 'Stream', 'Array', 'ReadonlyArray', 'Sequence', 'list', 'set',
  'tuple', 'Tuple', 'FrozenSet', 'frozenset', 'Page', 'Slice', 'Flux']);

/** Element type of a collection-ish type, or null. "List<Account>" → "Account", "Account[]" → "Account". */
export function collectionOf(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (/\[\]$/.test(s)) return baseType(s.slice(0, -2));
  const b = baseType(s);
  if (COLLECTIONS.has(b)) { const a = typeArgs(s); return a.length ? baseType(a[0]) : null; }
  if ((b === 'Map' || b === 'HashMap' || b === 'dict' || b === 'Dict' || b === 'Record') && typeArgs(s).length === 2) return baseType(typeArgs(s)[1]);
  return null;
}

/** Wrapper types whose argument is the "real" type: Optional<X>, Promise<X>, Mono<X>, Observable<X>. */
export function unwrap(t) {
  const b = baseType(t);
  if (['Optional', 'Promise', 'Mono', 'Observable', 'CompletableFuture', 'Future', 'ResponseEntity', 'Optional_', 'Awaitable'].includes(b)) {
    const a = typeArgs(t);
    if (a.length) return unwrap(a[0]);
  }
  return t;
}

export function stripQuotes(s) {
  s = String(s ?? '').trim();
  if (/^(["'`]).*\1$/s.test(s)) return s.slice(1, -1);
  if (/^[rbfu]?["']/.test(s)) return s.replace(/^[rbfu]?(["'])(.*)\1$/s, '$2');
  return s;
}

export function shorten(s, n = 48) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export const ACCESSOR = /^(get|set|is|has)[A-Z_]/;

export function snake(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}
