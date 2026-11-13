// The single place deterministic rules are declared: every gate, quota,
// allowlist or rewrite that can change what happens to a message. Call sites
// report each outcome through `decide`, which writes it to the decision log
// with the rule's pipeline node. The console lists the same definitions with
// their current parameter values.

import {PIPELINE_NODES, nonEmpty, sha256, stableJson, validId} from './registry-common.mjs';

const OUTCOMES = new Set<any>(['allow', 'deny', 'rewrite', 'defer']);

export function createRuleRegistry({log}: { log?: any; [key: string]: any } = {}) {
  const rules = new Map<string, any>();

  /**
   * Declare a rule. `params` returns its current parameters as
   * `{name: {value, from: 'hardcoded' | 'config' | 'external', key?}}`;
   * `counters` returns live usage such as `{used, limit}`.
   */
  function define(def?: any) {
    if (!def || typeof def !== 'object' || !validId(def.id)) throw new Error('Invalid rule id');
    if (rules.has(def.id)) throw new Error(`Rule already defined: ${def.id}`);
    if (!PIPELINE_NODES.includes(def.node)) throw new Error(`Unknown pipeline node for rule ${def.id}`);
    if (!nonEmpty(def.title, 120) || !nonEmpty(def.description, 1000) || !nonEmpty(def.source, 300)) throw new Error(`Rule ${def.id} needs a title, a description and a source`);
    for (const reader of ['params', 'counters']) if (def[reader] !== undefined && typeof def[reader] !== 'function') throw new Error(`Rule ${def.id}: ${reader} must be a function`);
    rules.set(def.id, {id: def.id, node: def.node, title: def.title, description: def.description, source: def.source, params: def.params, counters: def.counters});
  }

  /**
   * Record that a rule decided `outcome` (allow, deny, rewrite or defer).
   * Never throws: this runs on the message path. An unregistered rule or an
   * invalid outcome is still recorded, marked as such, so the mistake is
   * visible in the console instead of the decision being lost.
   */
  function decide(id: string, outcome: string, source: Record<string, any> = {}) {
    try {
      const def = rules.get(id);
      const ids = {eventId: source?.eventId, requestId: source?.requestId, callId: source?.callId, sessionId: source?.sessionId, channel: source?.channel};
      const record = !def ? {node: 'unregistered', ruleId: String(id).slice(0, 80), outcome: 'info', reason: 'unregistered_rule', ...ids, detail: {outcome: String(outcome).slice(0, 40)}}
        : !OUTCOMES.has(outcome) ? {node: def.node, ruleId: def.id, outcome: 'info', reason: 'invalid_outcome', ...ids, detail: {outcome: String(outcome).slice(0, 40)}}
        : {node: def.node, ruleId: def.id, outcome, reason: source?.reason, ...ids, detail: source?.detail};
      return log?.decide?.(record);
    } catch {}
  }

  // A failing reader must not hide the rule; its values are just unavailable.
  const read = (reader?: any) => {
    if (!reader) return null;
    try {
      const value = reader();
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Rule reader must return an object');
      return structuredClone(value);
    } catch { return {error: true}; }
  };
  const listed = (def: any) => ({id: def.id, node: def.node, title: def.title, description: def.description, source: def.source, params: read(def.params), counters: read(def.counters)});
  const sorted = () => [...rules.values()].sort((a, b) => a.id < b.id ? -1 : 1);

  return {
    define, decide,
    get: (id: string) => rules.has(id) ? listed(rules.get(id)) : null,
    list: () => sorted().map(listed),
    /** Hash of every definition and its current parameter values; live counters are excluded. */
    hash: () => sha256(stableJson(sorted().map((def) => ({...listed(def), counters: undefined})))),
  };
}
