import {createHash} from 'node:crypto';

/** Pipeline nodes a prompt or rule can belong to; the console groups by these. */
export const PIPELINE_NODES = Object.freeze(['trigger', 'gate', 'router', 'session', 'ticket', 'act', 'receipt', 'turn', 'memory', 'task', 'background']);

const ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/;

/** Registry ids are dotted lower-case names such as `router.batch-decision`. */
export function validId(id?: any) { return typeof id === 'string' && id.length <= 80 && ID.test(id); }

export const nonEmpty = (value?: any, max: number = 2000) => typeof value === 'string' && value.length > 0 && value.length <= max;

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** JSON with object keys sorted at every level, so equal content always hashes equally. */
export function stableJson(value?: any): string {
  if (Array.isArray(value)) return '[' + value.map((item) => stableJson(item)).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}
