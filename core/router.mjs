import { createHash } from 'node:crypto';
import { redact } from './events.mjs';

const terminal = ['observed', 'dispatched', 'failed', 'uncertain'];

export function createRouter({ store, assess, dispatch, policy = {}, timeoutMs = 30000 }) {
  if (!store?.db || typeof assess !== 'function' || typeof dispatch !== 'function') throw new TypeError('store, assess and dispatch are required');
  const db = store.db;
  const settings = typeof policy === 'object' && policy ? policy : {};
  const maxBatch = Math.max(1, Math.min(32, Math.floor(settings.maxBatch ?? 16)));
  const maxAttempts = Math.max(1, Math.min(5, Math.floor(settings.maxAttempts ?? 2)));
  const retryDelayMs = Math.max(1, Math.min(60000, settings.retryDelayMs ?? 250));
  timeoutMs = Math.max(1, Number(timeoutMs) || 30000);
  db.exec(`CREATE TABLE IF NOT EXISTS core_router (
    event_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
    action TEXT, updated_at INTEGER NOT NULL, error_code TEXT
  ); CREATE INDEX IF NOT EXISTS core_router_state_seq ON core_router(state,seq);`);
  db.prepare("UPDATE core_router SET state = 'pending' WHERE state = 'assessing'").run();
  db.prepare("UPDATE core_router SET state = 'uncertain', error_code = 'restart_during_dispatch' WHERE state = 'dispatching'").run();
  let closed = false, running = false, scheduled, active = null, pumpPromise = Promise.resolve();
  let lastProgressAt = Date.now();
  const errors = [];
  let finalStatus;

  function error(code, eventIds) {
    // Never retain arbitrary provider errors: they often contain prompts or credentials.
    errors.push({ code, eventIds: eventIds.slice(0, maxBatch), at: new Date().toISOString() });
    if (errors.length > 20) errors.shift();
  }
  function update(id, state, errorCode = null) {
    db.prepare('UPDATE core_router SET state = ?, updated_at = ?, error_code = ? WHERE event_id = ?').run(state, Date.now(), errorCode, id);
    lastProgressAt = Date.now();
  }
  function allowed(event) {
    try {
      if (typeof policy === 'function') return policy(event) === true;
      if (settings.allowChannels && !settings.allowChannels.includes(event.channel)) return false;
      return true;
    } catch { return false; }
  }
  function discover() {
    db.prepare(`INSERT OR IGNORE INTO core_router(event_id,seq,updated_at)
      SELECT id,seq,? FROM core_events WHERE id NOT IN (SELECT event_id FROM core_router)`).run(Date.now());
  }
  function schedule(ms = 0) {
    if (closed || scheduled || running) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      pumpPromise = pump().catch(() => { error('router_internal_error', []); });
    }, ms);
    scheduled.unref?.();
  }
  async function boundedCall(phase, eventIds, invoke) {
    const controller = new AbortController();
    const startedAt = Date.now();
    active = { phase, eventIds, startedAt, deadline: startedAt + timeoutMs, controller };
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => invoke(controller.signal)),
        new Promise((_, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { code: closed ? 'shutdown' : `${phase}_timeout` }));
          controller.signal.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => controller.abort(), timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      active = null;
    }
  }
  function freshContext(channel, signal) {
    return { ...store.context({ channel, limit: settings.contextLimit ?? 20, maxChars: settings.contextMaxChars ?? 12000 }), signal };
  }

  async function deliver(row) {
    const event = store.get(row.event_id);
    if (!allowed(event)) { update(event.id, 'observed', 'policy_blocked'); return; }
    const action = JSON.parse(row.action);
    // Persist intent before invoking any external side effect. No automatic replay beyond here.
    update(event.id, 'dispatching');
    try {
      await boundedCall('dispatch', [event.id], signal => dispatch(action, event, freshContext(event.channel, signal)));
      update(event.id, 'dispatched');
    } catch (cause) {
      const code = cause?.code === 'dispatch_timeout' ? 'dispatch_timeout' : closed ? 'shutdown_during_dispatch' : 'dispatch_failed_or_uncertain';
      update(event.id, 'uncertain', code);
      error(code, [event.id]);
    }
  }

  async function assessBatch(rows) {
    const events = rows.map(row => store.get(row.event_id));
    const ids = events.map(e => e.id);
    for (const id of ids) db.prepare("UPDATE core_router SET state = 'assessing', attempts = attempts + 1, updated_at = ? WHERE event_id = ?").run(Date.now(), id);
    try {
      const result = await boundedCall('assessment', ids, signal => assess({ events, context: freshContext(events[0].channel, signal), signal }));
      if (!result || !Array.isArray(result.actions)) throw new Error('Invalid assessor response');
      const byId = new Map();
      for (const action of result.actions.slice(0, maxBatch * 4)) {
        if (!action || !ids.includes(action.eventId) || byId.has(action.eventId) || !['observe', 'respond', 'task'].includes(action.kind)) continue;
        byId.set(action.eventId, {
          eventId: action.eventId, kind: action.kind,
          ...(typeof action.prompt === 'string' ? { prompt: redact(action.prompt).slice(0, 12000) } : {}),
          dispatchId: `dispatch:${createHash('sha256').update(action.eventId).digest('hex')}`,
        });
      }
      // All decision rows are committed together before any dispatch starts.
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const event of events) {
          const action = byId.get(event.id) ?? { eventId: event.id, kind: 'observe' };
          db.prepare('UPDATE core_router SET state = ?, action = ?, updated_at = ?, error_code = NULL WHERE event_id = ?')
            .run(action.kind === 'observe' ? 'observed' : 'decided', JSON.stringify(action), Date.now(), event.id);
        }
        db.exec('COMMIT');
      } catch (cause) { db.exec('ROLLBACK'); throw cause; }
      lastProgressAt = Date.now();
    } catch (cause) {
      const code = cause?.code === 'assessment_timeout' ? 'assessment_timeout' : closed ? 'shutdown' : 'assessment_error';
      error(code, ids);
      for (const row of rows) {
        const state = closed || row.attempts + 1 < maxAttempts ? 'pending' : 'failed';
        db.prepare('UPDATE core_router SET state = ?, next_at = ?, updated_at = ?, error_code = ? WHERE event_id = ?')
          .run(state, Date.now() + retryDelayMs, Date.now(), code, row.event_id);
      }
    }
  }

  async function pump() {
    if (running || closed) return;
    running = true;
    try {
      discover();
      while (!closed) {
        const decided = db.prepare("SELECT * FROM core_router WHERE state = 'decided' ORDER BY seq LIMIT 1").get();
        if (decided) { await deliver(decided); continue; }
        const first = db.prepare("SELECT r.*, e.channel FROM core_router r JOIN core_events e ON e.id = r.event_id WHERE r.state = 'pending' AND r.next_at <= ? ORDER BY r.seq LIMIT 1").get(Date.now());
        if (!first) break;
        const rows = db.prepare("SELECT r.* FROM core_router r JOIN core_events e ON e.id = r.event_id WHERE r.state = 'pending' AND r.next_at <= ? AND e.channel = ? ORDER BY r.seq LIMIT ?").all(Date.now(), first.channel, maxBatch);
        const actionable = [];
        for (const row of rows) {
          const event = store.get(row.event_id);
          if (event.kind === 'message.sent' || !allowed(event)) update(event.id, 'observed', event.kind === 'message.sent' ? null : 'policy_blocked');
          else actionable.push(row);
        }
        if (actionable.length) await assessBatch(actionable);
      }
    } finally {
      running = false;
      if (!closed) {
        const next = db.prepare("SELECT MIN(next_at) AS at FROM core_router WHERE state = 'pending'").get();
        if (next.at != null) schedule(Math.max(0, next.at - Date.now()));
      }
    }
  }

  function status() {
    if (finalStatus) return finalStatus;
    const counts = Object.fromEntries(['pending', 'assessing', 'decided', 'dispatching', ...terminal].map(state => [state, 0]));
    for (const row of db.prepare('SELECT state, COUNT(*) AS count FROM core_router GROUP BY state').all()) counts[row.state] = row.count;
    return { closed, running, revision: store.latestSeq(), counts, active: active ? { phase: active.phase, eventIds: [...active.eventIds], startedAt: active.startedAt, deadline: active.deadline } : null, lastProgressAt, errors: errors.map(e => ({ ...e, eventIds: [...e.eventIds] })) };
  }

  discover();
  schedule();
  return {
    async ingest(event) {
      if (closed) throw new Error('Router is closed');
      const persisted = store.append(event);
      db.prepare('INSERT OR IGNORE INTO core_router(event_id,seq,updated_at) VALUES(?,?,?)').run(persisted.id, persisted.seq, Date.now());
      schedule();
      return persisted;
    },
    tick() { if (!closed) { discover(); schedule(); } return status(); },
    status,
    async close() {
      if (closed) { await pumpPromise; return; }
      closed = true;
      clearTimeout(scheduled);
      active?.controller.abort();
      await pumpPromise;
      finalStatus = status();
    },
  };
}
