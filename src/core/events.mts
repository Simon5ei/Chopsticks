import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {platformRoute,scopeChannels,publicChannel} from './platforms.mjs';
import type {StoredEvent, EventStoreOptions, RecentEventsOptions, EventContext} from './contracts.mjs';

const kinds = new Set<any>(['message.received', 'message.sent', 'task.result', 'timer']);
const sensitiveKey = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;

// Defense in depth only: callers must never submit credentials as source content.
export function redact(value?: any) {
  return String(value)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED KEY]')
    .replace(/\b(?:authorization\s*:\s*)?bearer\s+[\w.+~\/-]+=*/gi, '[REDACTED AUTH]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret)\s*[=:]\s*)["']?[^\s"',;}]+/gi, '$1[REDACTED]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, '[REDACTED TOKEN]');
}

function sanitizeMeta(value?: any, depth: number = 0) {
  if (depth > 5) return null;
  if (typeof value === 'string') return redact(value).slice(0, 4000);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => sanitizeMeta(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, v]) => [key, sensitiveKey.test(key) ? '[REDACTED]' : sanitizeMeta(v, depth + 1)]));
  return null;
}

function boundedInt(value?: any, fallback?: any, max?: any) {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback;
}

function validateChannel(channel?: any) {
  try{platformRoute(channel);}catch{throw new TypeError('Invalid event channel');}
}

function decode(row?: any): StoredEvent | undefined {
  return row ? { seq: row.seq, id: row.id, kind: row.kind, channel: row.channel, actorId: row.actor_id, text: row.text, at: row.at, meta: JSON.parse(row.meta) } : undefined;
}

export function createEventStore({ stateDir,sharePlatformPrivate=false }: EventStoreOptions) {
  if (typeof stateDir !== 'string' || !stateDir) throw new TypeError('stateDir is required');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(stateDir, 'events.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS core_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, channel TEXT NOT NULL, actor_id TEXT NOT NULL,
      text TEXT NOT NULL, at TEXT NOT NULL, meta TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS core_events_channel_seq ON core_events(channel, seq);
    CREATE INDEX IF NOT EXISTS core_events_kind_seq ON core_events(kind, seq);`);
  let closed = false;
  const get = (id) => decode(db.prepare('SELECT * FROM core_events WHERE id = ?').get(id));
  const latestSeq = (): number => db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM core_events').get().seq as number;

  function append(input?: any) {
    if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 512) throw new TypeError('Stable event id is required (max 512 characters)');
    const existing = get(input.id);
    if (existing) return existing;
    validateChannel(input.channel);
    if (!kinds.has(input.kind)) throw new TypeError('Invalid event kind');
    if (typeof input.actorId !== 'string' || input.actorId.length > 256) throw new TypeError('actorId must be a string (max 256 characters)');
    if (typeof input.text !== 'string' || input.text.length > 100000) throw new TypeError('text must be a string (max 100000 characters)');
    if (input.kind === 'message.sent' && (input.meta?.messageId == null || !String(input.meta.messageId).trim())) throw new TypeError('Confirmed message.sent requires meta.messageId');
    const at = input.at == null ? new Date().toISOString() : new Date(input.at).toISOString();
    const meta = JSON.stringify(sanitizeMeta(input.meta ?? {}));
    if (meta.length > 32000) throw new TypeError('Event metadata too large');
    db.prepare('INSERT OR IGNORE INTO core_events(id,kind,channel,actor_id,text,at,meta) VALUES(?,?,?,?,?,?,?)')
      .run(input.id, input.kind, input.channel, input.actorId, redact(input.text), at, meta);
    return get(input.id);
  }

  function recent({ channel, groups = true, limit = 20, beforeSeq, query }: RecentEventsOptions = {}): StoredEvent[] {
    validateChannel(channel);
    const values = [];
    const clauses = [];
    if (groups) {const scope=scopeChannels(channel,{sharePlatformPrivate});clauses.push(scope.sql);values.push(...scope.args);}
    else { clauses.push('channel = ?'); values.push(channel); }
    // Public source placement does not declassify a development Worker result.
    // Other task.result evidence (platform reads, etc.) retains its old sharing.
    if(groups){
      const ticket="CASE WHEN json_valid(substr(core_events.meta,1,32000)) THEN json_extract(substr(core_events.meta,1,32000),'$.ticketId') ELSE '__unknown__' END";
      const hasState=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='host_kv' LIMIT 1").get();
      const research=publicChannel(channel)&&hasState?`EXISTS (SELECT 1 FROM host_kv WHERE kind='task-source' AND id=(${ticket}) AND CASE WHEN json_valid(substr(value,1,4096)) THEN json_extract(substr(value,1,4096),'$.mode') ELSE NULL END='research')`:'0';
      clauses.push(`(channel=? OR kind!='task.result' OR (${ticket}) IS NULL OR ${research})`);values.push(channel);
    }
    if (beforeSeq != null) { clauses.push('seq < ?'); values.push(boundedInt(beforeSeq, 0, Number.MAX_SAFE_INTEGER)); }
    if (query != null && String(query)) { clauses.push("text LIKE ? ESCAPE '\\'"); values.push(`%${String(query).slice(0, 500).replace(/[\\%_]/g, '\\$&')}%`); }
    values.push(boundedInt(limit, 20, 200));
    return db.prepare(`SELECT * FROM core_events WHERE ${clauses.join(' AND ')} ORDER BY seq DESC LIMIT ?`).all(...values).map(decode).reverse();
  }

  function context({ channel, limit = 20, maxChars = 12000 }: { channel?: string; limit?: number; maxChars?: number } = {}): EventContext {
    const count = boundedInt(limit, 20, 200);
    const budget = boundedInt(maxChars, 12000, 100000);
    const pool = recent({ channel, limit: 200 }).reverse();
    const {sql:selfScope,args:selfArgs}=scopeChannels(channel,{sharePlatformPrivate});
    const self = db.prepare(`SELECT * FROM core_events WHERE kind = 'message.sent' AND ${selfScope} ORDER BY seq DESC LIMIT ?`)
      .all(...selfArgs, Math.max(1, Math.floor(count / 3))).map(decode);
    const prioritized = [...self, ...pool.filter((e) => !self.some((s) => s.id === e.id))].slice(0, count);
    const header = '以下为带来源的历史记录。message.sent 表示已确认发送。\n';
    const records = [];
    let remaining = Math.max(0, budget - header.length);
    for (const [index, item] of prioritized.entries()) {
      // Do not expose arbitrary source metadata to models. IDs and provenance are explicit.
      const entry = { seq: item.seq, id: item.id, kind: item.kind, channel: item.channel, actorId: item.actorId, at: item.at, text: '' };
      const overhead = JSON.stringify(entry).length + 1;
      if (remaining < overhead) continue;
      const allowance = Math.min(remaining, Math.max(overhead + 100, Math.floor(remaining / (prioritized.length - index))));
      let lo = 0, hi = Math.min(item.text.length, allowance - overhead);
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        entry.text = item.text.slice(0, mid);
        if (JSON.stringify(entry).length + 1 <= allowance) lo = mid; else hi = mid - 1;
      }
      entry.text = item.text.slice(0, lo);
      remaining -= JSON.stringify(entry).length + 1;
      records.push(entry);
    }
    records.sort((a?: any, b?: any) => a.seq - b.seq);
    return { revision: latestSeq(), events: records, text: (header + records.map((e) => JSON.stringify(e)).join('\n')).slice(0, budget) };
  }

  return { db, append, recent, context, get, latestSeq, close() { if (!closed) { db.close(); closed = true; } } };
}
