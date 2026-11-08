import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const bootPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ticksPattern = /^(?:0|[1-9][0-9]{0,19})$/;
function readProc(file) {
  const fd = openSync(file, 'r'), buffer = Buffer.alloc(4097);
  try {
    let size = 0;
    while (size < buffer.length) { const count = readSync(fd, buffer, size, buffer.length - size, null); if (!count) break; size += count; }
    if (size > 4096) throw new Error('Process identity exceeds bound');
    return buffer.subarray(0, size).toString('utf8');
  } finally { closeSync(fd); }
}
function startTicks(pid, readFile) {
  const raw = readFile(`/proc/${pid}/stat`);
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Invalid process identity');
  // comm is parenthesized and may itself contain spaces or closing parentheses.
  const open = raw.indexOf('('), close = raw.lastIndexOf(')'), fields = raw.slice(close + 1).trim().split(/\s+/);
  if (open < 1 || close <= open || raw.slice(0, open).trim() !== String(pid) || !/^[A-Za-z]$/.test(fields[0]) || !ticksPattern.test(fields[19] ?? '')) throw new Error('Invalid process identity');
  return fields[19]; // /proc stat field 22, counted from field 3 after comm.
}
function identity(readFile) {
  try {
    const raw = readFile('/proc/sys/kernel/random/boot_id');
    if (typeof raw !== 'string' || raw.length > 4096 || !bootPattern.test(raw.trim())) throw new Error();
    return { bootId: raw.trim(), startTicks: startTicks(process.pid, readFile) };
  } catch { throw new Error('Coordinator process identity unavailable'); }
}
function activeOwner(owner, current, kill, readFile) {
  if (!owner || typeof owner !== 'object' || Array.isArray(owner) || !Object.hasOwn(owner, 'pid') || typeof owner.leaseId !== 'string' || !owner.leaseId.trim()) return true;
  const hasIdentity = Object.hasOwn(owner, 'bootId') || Object.hasOwn(owner, 'startTicks');
  const identified = typeof owner.bootId === 'string' && bootPattern.test(owner.bootId) && typeof owner.startTicks === 'string' && ticksPattern.test(owner.startTicks);
  if (hasIdentity ? !identified || Object.keys(owner).length !== 4 : Object.keys(owner).length !== 2) return true;
  if (owner.pid === null) return hasIdentity; // Only the explicit released marker is free.
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return true;
  if (current && identified && owner.bootId !== current.bootId) return false;
  try { kill(owner.pid, 0); } catch (error) { return error.code !== 'ESRCH'; }
  // Legacy or non-Linux leases retain the conservative PID-only rule.
  if (!current || !identified) return true;
  try { return startTicks(owner.pid, readFile) === owner.startTicks; } catch { return true; }
}

/** Synchronous repositories and effect journal share the Engine transaction. */
export function createStore(stateDir, { platform = process.platform, readFile = readProc, kill = (pid, signal) => process.kill(pid, signal) } = {}) {
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
  // One local host owns the journal. Linux PID reuse is distinguished by boot
  // and process generation; unknown identities never authorize takeover.
  const leaseId = randomUUID();
  try {
    atomic(() => {
      const owner = get('lease', 'coordinator');
      const current = platform === 'linux' ? identity(readFile) : null;
      if (owner !== undefined && activeOwner(owner, current, kill, readFile)) throw new Error('Coordinator already open: effect journal has an active owner');
      put('lease', 'coordinator', { pid: process.pid, leaseId, ...current });
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
