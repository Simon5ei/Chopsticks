import { createHash } from 'node:crypto';
import { redact } from './events.mjs';
import { createBatching } from './batching.mjs';
import {platformRoute} from './platforms.mjs';

const terminal = ['observed', 'dispatched', 'failed', 'uncertain'];

export function createRouter({ store, assess, dispatch, policy = {}, timeoutMs = 30000,hierarchy,mood,batchWindowMs=0,onBatch,urgent }) {
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
  if(hierarchy)db.exec(`CREATE TABLE IF NOT EXISTS core_router_domains(event_id TEXT PRIMARY KEY,domain TEXT NOT NULL,platform TEXT NOT NULL,session_key TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS core_attention(seq INTEGER PRIMARY KEY AUTOINCREMENT,domain TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS core_domain_attention(seq INTEGER PRIMARY KEY AUTOINCREMENT,domain TEXT NOT NULL,platform TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL);`);
  // Re-index the changed workspace layout without changing event/decision history.
  if(hierarchy)for(const row of db.prepare('SELECT DISTINCT e.channel FROM core_events e JOIN core_router_domains d ON d.event_id=e.id').all()){
    const route=platformRoute(row.channel);db.prepare('UPDATE core_router_domains SET domain=?,platform=?,session_key=? WHERE event_id IN (SELECT id FROM core_events WHERE channel=?)').run(route.domain,route.platform,route.sessionKey,row.channel);
  }
  const batchLimit=(value,fallback,max)=>Number.isFinite(value)?Math.max(1,Math.min(max,Math.floor(value))):fallback;
  const batching=Number.isFinite(batchWindowMs)&&batchWindowMs>0?createBatching({store,windowMs:batchLimit(batchWindowMs,3000,60000),urgent,maxEvents:batchLimit(settings.batchMaxEvents,16,32),maxChars:batchLimit(settings.batchMaxChars,12000,12000)}):null;
  let attentionDomain,attentionBurst=0;
  const platformCache=new Map();
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
    if(hierarchy)for(const row of db.prepare('SELECT e.id,e.channel FROM core_events e LEFT JOIN core_router_domains d ON d.event_id=e.id WHERE d.event_id IS NULL').all()){
     const route=platformRoute(row);db.prepare('INSERT OR IGNORE INTO core_router_domains VALUES(?,?,?,?)').run(row.id,route.domain,route.platform,route.sessionKey);
    }
  }
  function admitEvent(event,options={}) {
    if(!batching)return;
    if(event.kind==='message.sent'||!allowed(event)){update(event.id,'observed',event.kind==='message.sent'?null:'policy_blocked');return;}
    batching.admit(event,options);
  }
  function admitPending() {
    if(batching)for(const row of db.prepare("SELECT r.event_id FROM core_router r LEFT JOIN core_batch_members m ON m.event_id=r.event_id WHERE r.state='pending' AND m.event_id IS NULL ORDER BY r.seq").all())admitEvent(store.get(row.event_id));
  }
  function schedule(ms = 0) {
    if (closed || running) return;
    if(scheduled){clearTimeout(scheduled);scheduled=undefined;}
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
      await boundedCall('dispatch', [event.id], signal => dispatch(action, event, { ...freshContext(event.channel, signal),...batching?{batch:batching.describe(event.id)}:{} }));
      update(event.id, 'dispatched');
    } catch (cause) {
      const code = cause?.code === 'dispatch_timeout' ? 'dispatch_timeout' : closed ? 'shutdown_during_dispatch' : 'dispatch_failed_or_uncertain';
      update(event.id, 'uncertain', code);
      error(code, [event.id]);
    }
  }

  async function assessBatch(rows) {
    const originals = rows.map(row => store.get(row.event_id));
    if(batching)batching.seal(rows[0].event_id,onBatch);
    const projection=batching?.project(originals);
    const events = projection?.events??originals;
    const batch=batching?{...batching.describe(rows[0].event_id),truncated:projection.truncated,omittedEventCount:originals.length-events.length}:undefined;
    const ids = originals.map(e => e.id);
    for (const id of ids) db.prepare("UPDATE core_router SET state = 'assessing', attempts = attempts + 1, updated_at = ? WHERE event_id = ?").run(Date.now(), id);
    try {
      const route=hierarchy?platformRoute(events[0]):undefined;
      const moodEvidence=mood?.prepare(events);
      const result = await boundedCall('assessment', ids, signal => assess({ events,...batch?{batch}:{}, context: freshContext(events[0].channel, signal), signal,...route?{route,domain:route.domain}:{},...moodEvidence?{moodEvidence}:{} }));
      if (!result || !Array.isArray(result.actions)) throw new Error('Invalid assessor response');
      const byId = new Map();
      for (const action of result.actions.slice(0, maxBatch * 4)) {
        if (batching&&action?.kind!=='observe'&&[...byId.values()].some(a=>a.kind!=='observe')) continue;
        if (!action || !events.some(e=>e.id===action.eventId) || byId.has(action.eventId) || !['observe', 'respond', 'task','attach','stop'].includes(action.kind)) continue;
        byId.set(action.eventId, {
          eventId: action.eventId, kind: action.kind,...(['attach','stop'].includes(action.kind)&&typeof action.ticketId==='string'?{ticketId:action.ticketId.slice(0,512)}:{}),
          ...(typeof action.prompt === 'string' ? { prompt: redact(action.prompt).slice(0, 12000) } : {}),
          dispatchId: `dispatch:${createHash('sha256').update(action.eventId).digest('hex')}`,
        });
      }
      // All decision rows are committed together before any dispatch starts.
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const event of originals) {
          const action = byId.get(event.id) ?? { eventId: event.id, kind: 'observe' };
          db.prepare('UPDATE core_router SET state = ?, action = ?, updated_at = ?, error_code = NULL WHERE event_id = ?')
            .run(action.kind === 'observe' ? 'observed' : 'decided', JSON.stringify(action), Date.now(), event.id);
        }
        mood?.commit(result.moodUpdates,moodEvidence?.sourceEventIds||[]);
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
      admitPending();
      while (!closed) {
        // Passive/internal evidence must not consume semantic attention just to
        // be discarded later by the per-event policy. Also cover recovered rows.
        if(hierarchy)for(const row of db.prepare("SELECT event_id FROM core_router WHERE state='pending' AND next_at<=?").all(Date.now())){
         const event=store.get(row.event_id);
         if(event.kind==='message.sent'||!allowed(event))update(event.id,'observed',event.kind==='message.sent'?null:'policy_blocked');
        }
        let selected;
        if(hierarchy){
         const domains=db.prepare("SELECT d.domain,COUNT(*) AS count,MIN(r.seq) AS firstSeq FROM core_router r JOIN core_router_domains d ON d.event_id=r.event_id WHERE r.state='decided' OR (r.state='pending' AND r.next_at<=?) GROUP BY d.domain").all(Date.now());
         if(!domains.length)break;
         if(domains.length===1){selected=domains[0].domain;attentionDomain=undefined;attentionBurst=0;}
         else if(attentionDomain&&attentionBurst<8&&domains.some(d=>d.domain===attentionDomain))selected=attentionDomain;
         else{
          let choice;
          try{choice=await boundedCall('attention',[],signal=>hierarchy.select?.({domains,signal}));}catch{error('attention_error',[]);}
          if(closed)break;
          selected=domains.some(d=>d.domain===choice?.domain)?choice.domain:domains.some(d=>d.domain==='chat')?'chat':domains[0].domain;
          db.prepare('INSERT INTO core_attention(domain,reason,at) VALUES(?,?,?)').run(selected,redact(String(choice?.reason||'available-domain priority')).slice(0,300),Date.now());
          attentionDomain=selected;attentionBurst=0;
         }
         attentionBurst++;
        }
        let selectedPlatform;
        if(hierarchy){
         const platforms=db.prepare("SELECT d.platform,COUNT(*) AS count,MIN(r.seq) AS firstSeq FROM core_router r JOIN core_router_domains d ON d.event_id=r.event_id WHERE d.domain=? AND (r.state='decided' OR (r.state='pending' AND r.next_at<=?)) GROUP BY d.platform ORDER BY firstSeq").all(selected,Date.now());
         if(!platforms.length)continue;
         const cache=platformCache.get(selected);
         const cachedDecided=cache&&db.prepare("SELECT 1 FROM core_router r JOIN core_router_domains d ON d.event_id=r.event_id WHERE r.state='decided' AND d.domain=? AND d.platform=? LIMIT 1").get(selected,cache.platform);
         if(platforms.length===1)selectedPlatform=platforms[0].platform;
         else if(cache&&platforms.some(p=>p.platform===cache.platform)&&(cache.batches<4||cachedDecided))selectedPlatform=cache.platform;
         else{
          let choice;
          try{if(hierarchy.selectPlatform)choice=await boundedCall('platform_attention',[],signal=>hierarchy.selectPlatform({domain:selected,platforms,signal}));}catch{error('platform_attention_error',[]);}
          if(closed)break;
          selectedPlatform=platforms.some(p=>p.platform===choice?.platform)?choice.platform:platforms[0].platform;
          db.prepare('INSERT INTO core_domain_attention(domain,platform,reason,at) VALUES(?,?,?,?)').run(selected,selectedPlatform,redact(String(choice?.reason||'oldest ready platform')).slice(0,300),Date.now());
          platformCache.set(selected,{platform:selectedPlatform,batches:0});
         }
        }
        const decided = hierarchy?db.prepare("SELECT r.* FROM core_router r JOIN core_router_domains d ON d.event_id=r.event_id WHERE r.state='decided' AND d.domain=? AND d.platform=? ORDER BY r.seq LIMIT 1").get(selected,selectedPlatform):db.prepare("SELECT * FROM core_router WHERE state = 'decided' ORDER BY seq LIMIT 1").get();
        if (decided) { await deliver(decided); continue; }
        const first = hierarchy?db.prepare("SELECT r.*,e.channel,d.session_key FROM core_router r JOIN core_events e ON e.id=r.event_id JOIN core_router_domains d ON d.event_id=r.event_id WHERE r.state='pending' AND r.next_at<=? AND d.domain=? AND d.platform=? ORDER BY r.seq LIMIT 1").get(Date.now(),selected,selectedPlatform):db.prepare("SELECT r.*, e.channel FROM core_router r JOIN core_events e ON e.id = r.event_id WHERE r.state = 'pending' AND r.next_at <= ? ORDER BY r.seq LIMIT 1").get(Date.now());
        if (!first) break;
        const rows = batching?batching.rows(first.event_id):hierarchy?db.prepare("SELECT r.* FROM core_router r JOIN core_router_domains d ON d.event_id=r.event_id WHERE r.state='pending' AND r.next_at<=? AND d.session_key=? AND d.domain=? AND d.platform=? ORDER BY r.seq LIMIT ?").all(Date.now(),first.session_key,selected,selectedPlatform,selected==='surf'?1:maxBatch):db.prepare("SELECT r.* FROM core_router r JOIN core_events e ON e.id = r.event_id WHERE r.state = 'pending' AND r.next_at <= ? AND e.channel = ? ORDER BY r.seq LIMIT ?").all(Date.now(), first.channel, maxBatch);
        const actionable = [];
        for (const row of rows) {
          const event = store.get(row.event_id);
          if (event.kind === 'message.sent' || !allowed(event)) update(event.id, 'observed', event.kind === 'message.sent' ? null : 'policy_blocked');
          else actionable.push(row);
        }
        if (actionable.length) {if(hierarchy&&platformCache.get(selected)?.platform===selectedPlatform)platformCache.get(selected).batches++;await assessBatch(actionable);}
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
    const layers=hierarchy?{overall:{decisions:db.prepare('SELECT COUNT(*) AS n FROM core_attention').get().n,lastDecision:db.prepare('SELECT domain,reason,at FROM core_attention ORDER BY seq DESC LIMIT 1').get()||null},chat:{counts:{}},surf:{counts:{}}}:undefined;
    if(layers)for(const domain of ['chat','surf']){layers[domain].selections=db.prepare('SELECT COUNT(*) AS n FROM core_domain_attention WHERE domain=?').get(domain).n;layers[domain].lastSelection=db.prepare('SELECT platform,reason,at FROM core_domain_attention WHERE domain=? ORDER BY seq DESC LIMIT 1').get(domain)||null;}
    if(layers)for(const row of db.prepare('SELECT d.domain,r.state,COUNT(*) AS n FROM core_router r JOIN core_router_domains d ON d.event_id=r.event_id GROUP BY d.domain,r.state').all())layers[row.domain].counts[row.state]=row.n;
    return { closed, running, revision: store.latestSeq(), counts,...layers?{layers}:{}, active: active ? { phase: active.phase, eventIds: [...active.eventIds], startedAt: active.startedAt, deadline: active.deadline } : null, lastProgressAt, errors: errors.map(e => ({ ...e, eventIds: [...e.eventIds] })) };
  }

  discover();
  admitPending();
  schedule();
  return {
    async ingest(event, options={}) {
      if (closed) throw new Error('Router is closed');
      const persisted = store.append(event);
      db.prepare('INSERT OR IGNORE INTO core_router(event_id,seq,updated_at) VALUES(?,?,?)').run(persisted.id, persisted.seq, Date.now());
      if(hierarchy){const r=platformRoute(persisted);db.prepare('INSERT OR IGNORE INTO core_router_domains VALUES(?,?,?,?)').run(persisted.id,r.domain,r.platform,r.sessionKey);}
      if(batching&&db.prepare("SELECT state FROM core_router WHERE event_id=?").get(persisted.id)?.state==='pending')admitEvent(persisted,options);
      schedule();
      return persisted;
    },
    tick() { if (!closed) { discover(); admitPending(); schedule(); } return status(); },
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
