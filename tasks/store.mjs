import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Synchronous repositories and effect journal share the Engine transaction. */
export function createStore(stateDir) {
  mkdirSync(stateDir, { recursive: true });
  const db = new DatabaseSync(join(stateDir, 'superagent.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS effects (id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, value TEXT NOT NULL);`);
  const getRow = db.prepare('SELECT value FROM records WHERE kind=? AND id=?');
  const putRow = db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value');
  const allRows = db.prepare('SELECT value FROM records WHERE kind=? ORDER BY rowid');
  const decode = row => row && JSON.parse(row.value);
  const get = (kind, id) => decode(getRow.get(kind, id));
  const put = (kind, id, value) => putRow.run(kind, id, JSON.stringify(value));
  const list = kind => allRows.all(kind).map(decode);
  let depth = 0;
  function atomic(work) {
    if (depth) return work();
    db.exec('BEGIN IMMEDIATE'); depth++;
    try { const value = work(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { depth--; }
  }
  // One local host owns the journal. A live PID (including this process) is
  // conservatively treated as an owner; a crashed process releases it on restart.
  const leaseId = randomUUID();
  try {
    atomic(() => {
      const owner = get('lease', 'coordinator');
      if (owner?.pid) {
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('Coordinator already open: effect journal has an active owner');
      }
      put('lease', 'coordinator', { pid: process.pid, leaseId });
    });
  } catch (error) { db.close(); throw error; }
  const repository = (kind, key = 'id') => ({ get: id => get(kind, id), save: value => put(kind, value[key], value), list: () => list(kind) });
  const threads = repository('thread', 'key');
  threads.active = () => threads.list().filter(t => t.pending.length || t.evaluating);
  const tickets = repository('ticket');
  tickets.list = () => list('ticket').reverse();
  tickets.open = () => tickets.list().filter(t => !t.ended);
  tickets.active = () => tickets.list().filter(t => t.undelivered.length || ['pending', 'running'].includes(t.assignments.at(-1)?.state));
  const triggers = repository('trigger');
  triggers.disposition = id => get('disposition', id);
  triggers.saveDisposition = (id, value) => put('disposition', id, value);
  const decisions = repository('decision');
  decisions.byThread = key => decisions.list().filter(d => d.threadKey === key);
  const queue = db.prepare('INSERT OR IGNORE INTO effects VALUES(?,?,?,?)');
  const effects = {
    queue(value) { queue.run(value.id, value.kind, 'pending', JSON.stringify(value)); },
    list() { return db.prepare('SELECT * FROM effects ORDER BY rowid').all().map(row => ({ ...JSON.parse(row.value), state: row.state })); },
    get(id) { const row = db.prepare('SELECT * FROM effects WHERE id=?').get(id); return row && { ...JSON.parse(row.value), state: row.state }; },
    set(id, state, extra = {}) { const value = effects.get(id); if (value) db.prepare('UPDATE effects SET state=?,value=? WHERE id=?').run(state, JSON.stringify({ ...value, ...extra }), id); },
  };
  // Acceptance may already have occurred outside SQLite. Never blindly resend.
  db.exec("UPDATE effects SET state='uncertain' WHERE state='inflight'");
  return { repo: { atomic, triggers, threads, tickets, decisions }, atomic, get, put, list, effects,
    close() {
      atomic(() => { if (get('lease', 'coordinator')?.leaseId === leaseId) put('lease', 'coordinator', { pid: null, leaseId }); });
      db.close();
    } };
}
