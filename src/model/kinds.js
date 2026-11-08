// Allowed element and relation kinds per diagram type.
export const ELEMENT_KINDS = {
  class: ['package', 'class', 'interface', 'abstract', 'enum', 'record', 'annotation'],
  component: ['system', 'container', 'component', 'database', 'queue', 'external', 'actor', 'node'],
  activity: ['start', 'end', 'action', 'decision', 'merge', 'fork', 'join', 'subflow', 'note'],
  state: ['initial', 'final', 'state', 'composite', 'choice', 'history'],
  er: ['schema', 'table', 'view'],
};

export const RELATION_KINDS = {
  class: ['inheritance', 'realization', 'association', 'aggregation', 'composition', 'dependency'],
  component: ['uses', 'calls', 'reads', 'writes', 'publishes', 'subscribes'],
  activity: ['flow'],
  state: ['transition'],
  er: ['relationship'],
};

// Kinds that may contain children (other elements naming them as parent).
export const CONTAINER_KINDS = new Set([
  'package', 'system', 'container', 'node', 'subflow', 'composite', 'schema',
  // A component may be broken down into sub-components.
  'component',
]);
