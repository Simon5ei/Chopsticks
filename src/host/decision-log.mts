// Durable explanation records kept beside the traces: which rule decided what
// and why, which prompt text was actually sent, and which runtime version was
// in effect. Rows are small and outlive the verbose trace rows.
//
// Nothing here may block message processing: every method swallows its own
// failure and answers with an empty result when the store is unavailable.

import {sha256, stableJson} from './registry-common.mjs';

const OUTCOMES = new Set<any>(['allow', 'deny', 'rewrite', 'defer', 'info']);
const SEGMENT_KINDS = new Set<any>(['static', 'config', 'runtime']);
const NODE = /^[a-z][a-z-]{0,39}$/;
const HASH = /^[0-9a-f]{64}$/;
const DAY = 86400000;
const empty = () => ({items: [], nextBeforeSeq: null});
const emptyStats = () => ({decisions: 0, renders: 0, segments: 0, segmentBytes: 0, snapshots: 0});
const limitOf = (value?: any) => Number.isFinite(value) ? Math.max(1, Math.min(100, Math.floor(value))) : 50;
const short = (value?: any, max: number = 512) => typeof value === 'string' && value ? value.slice(0, max) : null;

export function createDecisionLog({db, clean, text, maxRows = 200000, maxAgeMs = 30 * DAY, maxSegmentBytes = 64 * 1024 * 1024, maxSegmentChars = 65536, now = Date.now}: { db?: any; clean?: any; text?: any; maxRows?: number; maxAgeMs?: number; maxSegmentBytes?: number; maxSegmentChars?: number; now?: any; [key: string]: any } = {}) {
  const dead: any = {decide() {}, render() {}, snapshot() { return null; }, currentSnapshot() { return null; }, segment() { return null; }, decisions: empty, renders: empty, snapshots: empty, stats: emptyStats};
  if (!db) return dead;
  const rows = Math.max(1, Math.min(1000000, Math.floor(maxRows)));
  let segmentBytes = 0, current = null, sincePrune = 0;
  const stamp = () => new Date(now()).toISOString();
  const pruneAge = () => {
    const cutoff = new Date(now() - maxAgeMs).toISOString();
    db.prepare('DELETE FROM decisions WHERE at < ?').run(cutoff);
    db.prepare('DELETE FROM prompt_renders WHERE at < ?').run(cutoff);
  };
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS decisions(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,node TEXT NOT NULL,ruleId TEXT,outcome TEXT NOT NULL,reason TEXT,eventId TEXT,requestId TEXT,callId TEXT,sessionId TEXT,channel TEXT,snapshotId INTEGER,detail TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS decisions_event ON decisions(eventId,seq);
 CREATE INDEX IF NOT EXISTS decisions_rule ON decisions(ruleId,seq);
 CREATE INDEX IF NOT EXISTS decisions_request ON decisions(requestId,seq);
 CREATE INDEX IF NOT EXISTS decisions_call ON decisions(callId);
 CREATE INDEX IF NOT EXISTS decisions_at ON decisions(at);
 CREATE TABLE IF NOT EXISTS prompt_segments(hash TEXT PRIMARY KEY,text TEXT NOT NULL,bytes INTEGER NOT NULL,firstAt TEXT NOT NULL,lastAt TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS prompt_segments_used ON prompt_segments(lastAt);
 CREATE TABLE IF NOT EXISTS prompt_renders(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,promptId TEXT NOT NULL,templateHash TEXT,eventId TEXT,requestId TEXT,sessionId TEXT,channel TEXT,snapshotId INTEGER,chars INTEGER NOT NULL,segments TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS prompt_renders_prompt ON prompt_renders(promptId,seq);
 CREATE INDEX IF NOT EXISTS prompt_renders_event ON prompt_renders(eventId,seq);
 CREATE INDEX IF NOT EXISTS prompt_renders_request ON prompt_renders(requestId,seq);
 CREATE INDEX IF NOT EXISTS prompt_renders_at ON prompt_renders(at);
 CREATE TABLE IF NOT EXISTS runtime_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,digest TEXT NOT NULL,value TEXT NOT NULL);`);
    pruneAge();
    segmentBytes = Number(db.prepare('SELECT COALESCE(SUM(bytes),0) AS total FROM prompt_segments').get().total) || 0;
  } catch { return dead; }

  function pruneCount(table: string) {
    db.prepare(`DELETE FROM ${table} WHERE seq <= (SELECT COALESCE(MAX(seq),0)-? FROM ${table})`).run(rows);
    if (++sincePrune >= 256) { sincePrune = 0; pruneAge(); }
  }

  /** Record one decision. Returns its sequence number, or undefined when dropped. */
  function decide(input?: any) {
    try {
      if (!input || typeof input !== 'object' || typeof input.node !== 'string' || !NODE.test(input.node) || !OUTCOMES.has(input.outcome)) return;
      const r = clean({ruleId: input.ruleId, reason: input.reason, eventId: input.eventId, requestId: input.requestId, callId: input.callId, sessionId: input.sessionId, channel: input.channel, detail: input.detail ?? {}});
      const detail = JSON.stringify(r.detail && typeof r.detail === 'object' ? r.detail : {});
      const inserted = db.prepare('INSERT INTO decisions(at,node,ruleId,outcome,reason,eventId,requestId,callId,sessionId,channel,snapshotId,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(stamp(), input.node, short(r.ruleId, 80), input.outcome, short(r.reason, 120), short(r.eventId), short(r.requestId), short(r.callId), short(r.sessionId), short(r.channel), current, detail.length <= 4000 ? detail : JSON.stringify({truncated: true}));
      pruneCount('decisions');
      return Number(inserted.lastInsertRowid);
    } catch {}
  }

  function evictSegments() {
    while (segmentBytes > maxSegmentBytes) {
      const victims = db.prepare('SELECT hash,bytes FROM prompt_segments ORDER BY lastAt ASC,rowid ASC LIMIT 16').all();
      if (!victims.length) { segmentBytes = 0; return; }
      for (const victim of victims) {
        if (segmentBytes <= maxSegmentBytes) return;
        db.prepare('DELETE FROM prompt_segments WHERE hash=?').run(victim.hash);
        segmentBytes -= Number(victim.bytes) || 0;
      }
    }
  }

  /**
   * Record one rendered prompt as ordered segments. Segment text is redacted,
   * stored once per distinct content, and never restructured, so the prompt
   * can be rebuilt by concatenating its segments.
   */
  function render(input?: any) {
    try {
      if (!input || typeof input.promptId !== 'string' || !input.promptId || !Array.isArray(input.segments) || !input.segments.length || input.segments.length > 64) return;
      if (input.segments.some((s?: any) => !s || typeof s.slot !== 'string' || !s.slot || s.slot.length > 80 || !SEGMENT_KINDS.has(s.kind) || typeof s.text !== 'string')) return;
      const at = stamp(), listed = [];
      let chars = 0;
      for (const segment of input.segments) {
        if (!segment.text) continue;
        chars += segment.text.length;
        const redacted = text(segment.text, Infinity), truncated = redacted.length > maxSegmentChars;
        const stored = truncated ? redacted.slice(0, maxSegmentChars) : redacted, hash = sha256(stored);
        if (db.prepare('SELECT 1 FROM prompt_segments WHERE hash=?').get(hash)) db.prepare('UPDATE prompt_segments SET lastAt=? WHERE hash=?').run(at, hash);
        else {
          const bytes = Buffer.byteLength(stored);
          db.prepare('INSERT INTO prompt_segments(hash,text,bytes,firstAt,lastAt) VALUES(?,?,?,?,?)').run(hash, stored, bytes, at, at);
          segmentBytes += bytes;
        }
        listed.push({slot: segment.slot, kind: segment.kind, hash, chars: segment.text.length, ...(truncated ? {truncated: true} : {})});
      }
      const r = clean({promptId: input.promptId, templateHash: input.templateHash, eventId: input.eventId, requestId: input.requestId, sessionId: input.sessionId, channel: input.channel});
      const inserted = db.prepare('INSERT INTO prompt_renders(at,promptId,templateHash,eventId,requestId,sessionId,channel,snapshotId,chars,segments) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(at, short(r.promptId, 80), short(r.templateHash, 64), short(r.eventId), short(r.requestId), short(r.sessionId), short(r.channel), current, chars, JSON.stringify(listed));
      pruneCount('prompt_renders');
      evictSegments();
      return {seq: Number(inserted.lastInsertRowid), chars};
    } catch {}
  }

  /** Stored text of one segment, or null when unknown or already evicted. */
  function segment(hash?: any) {
    try { return typeof hash === 'string' && HASH.test(hash) ? db.prepare('SELECT text FROM prompt_segments WHERE hash=?').get(hash)?.text ?? null : null; } catch { return null; }
  }

  /**
   * Declare what is running now (build, preset, persona and registry hashes).
   * Unchanged content keeps the latest id, so the id moves only when something
   * that shapes processing changed. Later decisions and renders carry it.
   */
  function snapshot(value?: any) {
    try {
      const canonical = stableJson(clean(value && typeof value === 'object' ? value : {})), digest = sha256(canonical);
      const latest = db.prepare('SELECT id,digest FROM runtime_snapshots ORDER BY id DESC LIMIT 1').get();
      if (latest?.digest === digest) current = Number(latest.id);
      else {
        current = Number(db.prepare('INSERT INTO runtime_snapshots(at,digest,value) VALUES(?,?,?)').run(stamp(), digest, canonical.length <= 16000 ? canonical : JSON.stringify({truncated: true})).lastInsertRowid);
        db.prepare('DELETE FROM runtime_snapshots WHERE id <= (SELECT COALESCE(MAX(id),0)-500 FROM runtime_snapshots)').run();
      }
      return current;
    } catch { return null; }
  }

  function select(table: string, key: string, fields: string[], payload: any, parse: (row: any) => any) {
    try {
      const clauses = [], args = [];
      for (const field of fields) if (typeof payload?.[field] === 'string' && payload[field]) { clauses.push(`${field}=?`); args.push(payload[field].slice(0, 512)); }
      if (Number.isSafeInteger(payload?.beforeSeq) && payload.beforeSeq > 0) { clauses.push(`${key}<?`); args.push(payload.beforeSeq); }
      const limit = limitOf(payload?.limit);
      const items = db.prepare(`SELECT * FROM ${table} ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY ${key} DESC LIMIT ?`).all(...args, limit + 1).map(parse);
      const more = items.length > limit;
      items.length = Math.min(items.length, limit);
      return {items, nextBeforeSeq: more ? items.at(-1)[key] : null};
    } catch { return empty(); }
  }
  const json = (value?: any, fallback?: any) => { try { return JSON.parse(value); } catch { return fallback; } };

  return {
    decide, render, segment, snapshot,
    currentSnapshot: () => current,
    decisions: (payload: Record<string, any> = {}) => select('decisions', 'seq', ['eventId', 'ruleId', 'requestId', 'callId', 'sessionId', 'channel', 'node', 'outcome'], payload, (row) => ({...row, detail: json(row.detail, {})})),
    renders: (payload: Record<string, any> = {}) => select('prompt_renders', 'seq', ['promptId', 'eventId', 'requestId', 'sessionId', 'channel'], payload, (row) => ({...row, segments: json(row.segments, [])})),
    snapshots: (payload: Record<string, any> = {}) => select('runtime_snapshots', 'id', [], payload, (row) => ({...row, value: json(row.value, {})})),
    stats() {
      try {
        const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n) || 0;
        return {decisions: count('decisions'), renders: count('prompt_renders'), segments: count('prompt_segments'), segmentBytes, snapshots: count('runtime_snapshots')};
      } catch { return emptyStats(); }
    },
  };
}
