// The single place prompts are declared and produced. A prompt assembled at
// runtime is a list of parts; `render` joins them and reports the exact
// segments to the decision log, so what the console shows is what the model
// received. Static texts and external files are declared here too, so
// everything that reaches a model can be listed.
//
// Parts of an assembled prompt:
//   {text}                                   fixed text, always present
//   {include: id}                            the text of a registered static prompt
//   {slot, options: {name: text}, optional?} fixed text chosen by name at render time
//   {slot, kind, optional?, prefix?, suffix?, ref?}
//                                            text supplied at render time; `kind` says
//                                            where it comes from, `ref` names the prompt
//                                            that produces it, and an optional slot may
//                                            carry fixed text that appears only with it

import {PIPELINE_NODES, nonEmpty, sha256, stableJson, validId} from './registry-common.mjs';

const SLOT = /^[a-z][A-Za-z0-9]{0,39}$/;
const OPTION = /^[a-z][a-z0-9-]{0,23}$/;
const SLOT_KINDS = new Set<any>(['static', 'config', 'runtime']);
const SEGMENT_NAME_MAX = 80; // the decision log rejects longer names
const DETAILS_MAX = 20000;
// Only objects handed out by `fragment` may be embedded as pre-assembled text.
const fragments = new WeakSet<object>();
const named = (name: string) => name.slice(0, SEGMENT_NAME_MAX);

function normalizeParts(parts?: any) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 64) throw new Error('Prompt parts must be a non-empty list');
  const seen = new Set<any>();
  return parts.map((part?: any) => {
    if (!part || typeof part !== 'object') throw new Error('Invalid prompt part');
    if ('text' in part) {
      if (!nonEmpty(part.text, 20000) || Object.keys(part).length !== 1) throw new Error('Invalid literal prompt part');
      return {text: part.text};
    }
    if ('include' in part) {
      if (!validId(part.include) || Object.keys(part).length !== 1) throw new Error('Invalid include prompt part');
      return {include: part.include};
    }
    if (typeof part.slot !== 'string' || !SLOT.test(part.slot) || seen.has(part.slot)) throw new Error(`Invalid or repeated prompt slot: ${String(part.slot).slice(0, 40)}`);
    seen.add(part.slot);
    const optional = part.optional === true;
    if ('options' in part) {
      const entries = part.options && typeof part.options === 'object' && !Array.isArray(part.options) ? Object.entries(part.options) : [];
      const extra = Object.keys(part).some((key) => !['slot', 'options', 'optional'].includes(key));
      if (extra || !entries.length || entries.length > 12 || entries.some(([name, text]) => !OPTION.test(name) || !nonEmpty(text, 20000))) throw new Error(`Invalid options for prompt slot ${part.slot}`);
      return {slot: part.slot, optional, options: Object.fromEntries(entries)};
    }
    if (!SLOT_KINDS.has(part.kind)) throw new Error(`Invalid kind for prompt slot ${part.slot}`);
    for (const affix of ['prefix', 'suffix']) if (part[affix] !== undefined && (!optional || !nonEmpty(part[affix], 2000))) throw new Error(`Only an optional slot may carry a prefix or suffix: ${part.slot}`);
    if (part.ref !== undefined && !validId(part.ref)) throw new Error(`Invalid reference for prompt slot ${part.slot}`);
    return {slot: part.slot, kind: part.kind, optional, ...(part.ref ? {ref: part.ref} : {}), ...(part.prefix ? {prefix: part.prefix} : {}), ...(part.suffix ? {suffix: part.suffix} : {})};
  });
}

function normalizeDetails(id: string, details?: any) {
  if (details === undefined) return undefined;
  if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error(`Prompt ${id}: details must be an object`);
  const copy = structuredClone(details);
  if (stableJson(copy).length > DETAILS_MAX) throw new Error(`Prompt ${id}: details are too large`);
  return copy;
}

export function createPromptRegistry({log}: { log?: any; [key: string]: any } = {}) {
  const prompts = new Map<string, any>();

  /**
   * Declare a prompt. With `parts` it is assembled at runtime through `render`
   * or `fragment`; otherwise it is a fixed text (`kind: 'static'`, `text`) or
   * an external one read on demand (`kind: 'config'`, `read`). `details` is
   * free-form context shown beside it in the console.
   */
  function define(def?: any) {
    if (!def || typeof def !== 'object' || !validId(def.id)) throw new Error('Invalid prompt id');
    if (prompts.has(def.id)) throw new Error(`Prompt already defined: ${def.id}`);
    if (!PIPELINE_NODES.includes(def.node)) throw new Error(`Unknown pipeline node for prompt ${def.id}`);
    if (!nonEmpty(def.title, 120) || !nonEmpty(def.source, 300)) throw new Error(`Prompt ${def.id} needs a title and a source`);
    const details = normalizeDetails(def.id, def.details);
    const base = {id: def.id, node: def.node, title: def.title, source: def.source, ...(details ? {details} : {})};
    if (def.parts !== undefined) {
      if (def.kind !== undefined && def.kind !== 'assembled') throw new Error(`Prompt ${def.id} with parts must be assembled`);
      const parts = normalizeParts(def.parts);
      prompts.set(def.id, {...base, kind: 'assembled', parts, templateHash: sha256(stableJson(parts))});
    } else if (def.kind === 'static' && nonEmpty(def.text, 100000)) prompts.set(def.id, {...base, kind: 'static', text: def.text});
    else if (def.kind === 'config' && typeof def.read === 'function') prompts.set(def.id, {...base, kind: 'config', read: def.read});
    else throw new Error(`Prompt ${def.id} needs parts, a static text or a reader`);
  }

  function assembled(id: string) {
    const def = prompts.get(id);
    if (!def) throw new Error(`Unknown prompt: ${id}`);
    if (def.kind !== 'assembled') throw new Error(`Prompt ${id} is not an assembled prompt`);
    return def;
  }

  // Unknown prompts, slots and branches are programming errors and throw.
  function assemble(def: any, slots: Record<string, any> = {}) {
    const id = def.id;
    const declared = new Set<any>(def.parts.filter((part?: any) => part.slot).map((part?: any) => part.slot));
    for (const name of Object.keys(slots ?? {})) if (!declared.has(name)) throw new Error(`Unknown slot ${name} for prompt ${id}`);
    const segments: {slot: string; kind: string; text: string}[] = [];
    def.parts.forEach((part?: any, index?: any) => {
      if (part.text !== undefined) { segments.push({slot: `literal:${index}`, kind: 'static', text: part.text}); return; }
      if (part.include) {
        const included = prompts.get(part.include);
        if (!included || included.kind !== 'static') throw new Error(`Prompt ${id} includes ${part.include}, which is not a registered static prompt`);
        segments.push({slot: named(`@${part.include}`), kind: 'static', text: included.text});
        return;
      }
      const value = slots?.[part.slot], embedded = value && typeof value === 'object' && fragments.has(value) ? value : null;
      // A required slot must be supplied, but may legitimately be empty text.
      if (value == null || (part.options && value === '')) {
        if (part.optional) return;
        throw new Error(`Missing slot ${part.slot} for prompt ${id}`);
      }
      if (value === '' || embedded?.text === '') return;
      if (part.options) {
        if (typeof value !== 'string' || !Object.hasOwn(part.options, value)) throw new Error(`Unknown option for slot ${part.slot} of prompt ${id}`);
        segments.push({slot: named(`${part.slot}=${value}`), kind: 'static', text: part.options[value]});
        return;
      }
      if (!embedded && typeof value !== 'string') throw new Error(`Slot ${part.slot} for prompt ${id} must be text`);
      if (part.prefix) segments.push({slot: `${part.slot}:prefix`, kind: 'static', text: part.prefix});
      if (embedded) for (const inner of embedded.segments) segments.push({slot: named(`${part.slot}/${inner.slot}`), kind: inner.kind, text: inner.text});
      else segments.push({slot: part.slot, kind: part.kind, text: value});
      if (part.suffix) segments.push({slot: `${part.slot}:suffix`, kind: 'static', text: part.suffix});
    });
    return segments;
  }
  const joined = (segments: {text: string}[]) => segments.map((segment) => segment.text).join('');

  /** Produce an assembled prompt that is about to be sent, and record it. */
  function render(id: string, slots: Record<string, any> = {}, source: Record<string, any> = {}) {
    const def = assembled(id), segments = assemble(def, slots);
    // Recording is best effort; the prompt is produced regardless.
    try { log?.render?.({promptId: id, templateHash: def.templateHash, segments, eventId: source?.eventId, requestId: source?.requestId, sessionId: source?.sessionId, channel: source?.channel}); } catch {}
    return joined(segments);
  }

  /**
   * Assemble a piece of text that a larger prompt will embed. Nothing is
   * recorded here; passing the fragment as a slot value keeps its segments, so
   * the parent's record still tells fixed text from runtime data.
   */
  function fragment(id: string, slots: Record<string, any> = {}) {
    const segments = assemble(assembled(id), slots);
    const made = Object.freeze({id, text: joined(segments), segments: Object.freeze(segments.map((segment) => Object.freeze({...segment})))});
    fragments.add(made);
    return made;
  }

  /**
   * Record a fragment that is sent to a model as it is (for example a context
   * block the host adds to a system prompt). Best effort, like `render`.
   */
  function record(made?: any, source: Record<string, any> = {}) {
    try {
      if (!made || typeof made !== 'object' || !fragments.has(made)) return;
      log?.render?.({promptId: made.id, templateHash: prompts.get(made.id)?.templateHash, segments: [...made.segments], eventId: source?.eventId, requestId: source?.requestId, sessionId: source?.sessionId, channel: source?.channel});
    } catch {}
  }

  const listedPart = (part: any) => part.options ? {...part, options: {...part.options}} : {...part};
  const listed = (def: any) => ({id: def.id, node: def.node, title: def.title, kind: def.kind, source: def.source, ...(def.details ? {details: structuredClone(def.details)} : {}), ...(def.kind === 'assembled' ? {parts: def.parts.map(listedPart), templateHash: def.templateHash} : {})});
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
    define, render, fragment, record, describe,
    has: (id: string) => prompts.has(id),
    get: (id: string) => prompts.has(id) ? listed(prompts.get(id)) : null,
    list: () => sorted().map(listed),
    /** Hash of every definition (external file contents excluded; snapshot those separately). */
    hash: () => sha256(stableJson(sorted().map((def) => ({...listed(def), ...(def.kind === 'static' ? {text: def.text} : {})})))),
  };
}
