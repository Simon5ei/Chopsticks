// The single place prompts are declared and produced. A prompt assembled at
// runtime is a list of parts (literal text and named slots); `render` joins
// them and reports the exact segments to the decision log, so what the console
// shows is what the model received. Static texts and external files are
// declared here too, so everything that reaches a model can be listed.

import {PIPELINE_NODES, nonEmpty, sha256, stableJson, validId} from './registry-common.mjs';

const SLOT = /^[a-z][A-Za-z0-9]{0,39}$/;
const SLOT_KINDS = new Set<any>(['static', 'config', 'runtime']);

function normalizeParts(parts?: any) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 64) throw new Error('Prompt parts must be a non-empty list');
  const seen = new Set<any>();
  return parts.map((part?: any) => {
    if (!part || typeof part !== 'object') throw new Error('Invalid prompt part');
    if ('text' in part) {
      if (!nonEmpty(part.text, 20000) || Object.keys(part).length !== 1) throw new Error('Invalid literal prompt part');
      return {text: part.text};
    }
    if (typeof part.slot !== 'string' || !SLOT.test(part.slot) || seen.has(part.slot)) throw new Error(`Invalid or repeated prompt slot: ${String(part.slot).slice(0, 40)}`);
    seen.add(part.slot);
    if (!SLOT_KINDS.has(part.kind)) throw new Error(`Invalid kind for prompt slot ${part.slot}`);
    const optional = part.optional === true;
    if (part.prefix !== undefined && (!optional || !nonEmpty(part.prefix, 2000))) throw new Error(`Only an optional slot may carry a prefix: ${part.slot}`);
    if (part.ref !== undefined && !validId(part.ref)) throw new Error(`Invalid reference for prompt slot ${part.slot}`);
    return {slot: part.slot, kind: part.kind, optional, ...(part.ref ? {ref: part.ref} : {}), ...(part.prefix ? {prefix: part.prefix} : {})};
  });
}

export function createPromptRegistry({log}: { log?: any; [key: string]: any } = {}) {
  const prompts = new Map<string, any>();

  /**
   * Declare a prompt. With `parts` it is assembled at runtime through `render`;
   * otherwise it is a fixed text (`kind: 'static'`, `text`) or an external one
   * read on demand (`kind: 'config'`, `read`).
   */
  function define(def?: any) {
    if (!def || typeof def !== 'object' || !validId(def.id)) throw new Error('Invalid prompt id');
    if (prompts.has(def.id)) throw new Error(`Prompt already defined: ${def.id}`);
    if (!PIPELINE_NODES.includes(def.node)) throw new Error(`Unknown pipeline node for prompt ${def.id}`);
    if (!nonEmpty(def.title, 120) || !nonEmpty(def.source, 300)) throw new Error(`Prompt ${def.id} needs a title and a source`);
    const base = {id: def.id, node: def.node, title: def.title, source: def.source};
    if (def.parts !== undefined) {
      if (def.kind !== undefined && def.kind !== 'assembled') throw new Error(`Prompt ${def.id} with parts must be assembled`);
      const parts = normalizeParts(def.parts);
      prompts.set(def.id, {...base, kind: 'assembled', parts, templateHash: sha256(stableJson(parts))});
    } else if (def.kind === 'static' && nonEmpty(def.text, 100000)) prompts.set(def.id, {...base, kind: 'static', text: def.text});
    else if (def.kind === 'config' && typeof def.read === 'function') prompts.set(def.id, {...base, kind: 'config', read: def.read});
    else throw new Error(`Prompt ${def.id} needs parts, a static text or a reader`);
  }

  /** Produce an assembled prompt. Throws on an unknown prompt or slot: those are programming errors. */
  function render(id: string, slots: Record<string, any> = {}, source: Record<string, any> = {}) {
    const def = prompts.get(id);
    if (!def) throw new Error(`Unknown prompt: ${id}`);
    if (def.kind !== 'assembled') throw new Error(`Prompt ${id} is not an assembled prompt`);
    const declared = new Set<any>(def.parts.filter((part?: any) => part.slot).map((part?: any) => part.slot));
    for (const name of Object.keys(slots ?? {})) if (!declared.has(name)) throw new Error(`Unknown slot ${name} for prompt ${id}`);
    const segments = [];
    def.parts.forEach((part?: any, index?: any) => {
      if (!part.slot) { segments.push({slot: `literal:${index}`, kind: 'static', text: part.text}); return; }
      const value = slots?.[part.slot];
      if (value == null || value === '') {
        if (part.optional) return;
        throw new Error(`Missing slot ${part.slot} for prompt ${id}`);
      }
      if (typeof value !== 'string') throw new Error(`Slot ${part.slot} for prompt ${id} must be text`);
      if (part.prefix) segments.push({slot: `${part.slot}:prefix`, kind: 'static', text: part.prefix});
      segments.push({slot: part.slot, kind: part.kind, text: value});
    });
    // Recording is best effort; the prompt is produced regardless.
    try { log?.render?.({promptId: id, templateHash: def.templateHash, segments, eventId: source?.eventId, requestId: source?.requestId, sessionId: source?.sessionId, channel: source?.channel}); } catch {}
    return segments.map((segment) => segment.text).join('');
  }

  const listed = (def: any) => ({id: def.id, node: def.node, title: def.title, kind: def.kind, source: def.source, ...(def.kind === 'assembled' ? {parts: def.parts.map((part?: any) => ({...part})), templateHash: def.templateHash} : {})});
  const sorted = () => [...prompts.values()].sort((a, b) => a.id < b.id ? -1 : 1);

  /** Definition plus current content. An unreadable external text is reported as `{id, error: true}`. */
  function describe(id: string) {
    const def = prompts.get(id);
    if (!def) throw new Error(`Unknown prompt: ${id}`);
    if (def.kind === 'assembled') return listed(def);
    try {
      const text = def.kind === 'static' ? def.text : def.read();
      if (typeof text !== 'string') throw new Error('Prompt reader must return text');
      return {...listed(def), text, chars: text.length, hash: sha256(text)};
    } catch { return {id, error: true}; }
  }

  return {
    define, render, describe,
    get: (id: string) => prompts.has(id) ? listed(prompts.get(id)) : null,
    list: () => sorted().map(listed),
    /** Hash of every definition (external file contents excluded; snapshot those separately). */
    hash: () => sha256(stableJson(sorted().map((def) => ({...listed(def), ...(def.kind === 'static' ? {text: def.text} : {})})))),
  };
}
