// Durable channel windows. Original messages remain in core_events; only the model
// projection is clipped. No combined text is ever promoted to a source event.
export function createBatching({store,windowMs,urgent,maxEvents=16,maxChars=12000}: { store?: any; windowMs?: any; urgent?: any; maxEvents?: number; maxChars?: number; [key: string]: any }) {
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS core_batches(id TEXT PRIMARY KEY,channel TEXT NOT NULL,opened_at INTEGER NOT NULL,deadline INTEGER NOT NULL,sealed INTEGER NOT NULL DEFAULT 0,notified INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS core_batches_open ON core_batches(channel,sealed,deadline);
    CREATE TABLE IF NOT EXISTS core_batch_members(event_id TEXT PRIMARY KEY,batch_id TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS core_batch_members_batch ON core_batch_members(batch_id);`);
  function admit(event?: any,{urgent:force=false}: { urgent?: boolean; [key: string]: any }={}) {
    if(db.prepare('SELECT 1 FROM core_batch_members WHERE event_id=?').get(event.id))return;
    const row=db.prepare('SELECT state,updated_at FROM core_router WHERE event_id=?').get(event.id);
    if(row?.state!=='pending')return;
    const now=Date.now(), arrival=row.updated_at;
    let immediate=force;
    try{immediate ||= urgent?.(event)===true;}catch{}
    let batch=!immediate&&db.prepare('SELECT * FROM core_batches WHERE channel=? AND sealed=0 AND deadline>? ORDER BY opened_at DESC LIMIT 1').get(event.channel,arrival);
    if(!batch){batch={id:`batch:${event.id}`,channel:event.channel,opened_at:arrival,deadline:immediate?now:arrival+windowMs};db.prepare('INSERT INTO core_batches(id,channel,opened_at,deadline) VALUES(?,?,?,?)').run(batch.id,batch.channel,batch.opened_at,batch.deadline);}
    db.prepare('INSERT INTO core_batch_members VALUES(?,?)').run(event.id,batch.id);
    db.prepare('UPDATE core_router SET next_at=? WHERE event_id=?').run(batch.deadline,event.id);
  }
  function lookup(eventId?: any){return db.prepare('SELECT b.* FROM core_batches b JOIN core_batch_members m ON m.batch_id=b.id WHERE m.event_id=?').get(eventId);}
  function rows(eventId?: any){const b=lookup(eventId);return db.prepare("SELECT r.* FROM core_router r JOIN core_batch_members m ON m.event_id=r.event_id WHERE m.batch_id=? AND r.state='pending' ORDER BY r.seq").all(b.id);}
  function describe(eventId?: any,{originals=false}: { originals?: boolean; [key: string]: any }={}) {
    const b=lookup(eventId);if(!b)return undefined;
    const members=db.prepare('SELECT e.id FROM core_events e JOIN core_batch_members m ON m.event_id=e.id WHERE m.batch_id=? ORDER BY e.seq').all(b.id);
    const sourceEventIds=members.map((r)=>r.id);
    return {id:b.id,channel:b.channel,openedAt:b.opened_at,deadline:b.deadline,sourceEventIds,...originals?{originals:sourceEventIds.map((id)=>store.get(id))}:{}};
  }
  function seal(eventId?: any,onBatch?: any){const b=lookup(eventId);db.prepare('UPDATE core_batches SET sealed=1 WHERE id=?').run(b.id);if(!b.notified){db.prepare('UPDATE core_batches SET notified=1 WHERE id=?').run(b.id);try{const result=onBatch?.(describe(eventId,{originals:true}));result?.catch?.(()=>{});}catch{}}}
  function project(events?: any){let remaining=maxChars;const projected=events.slice(-maxEvents).map((e)=>{const text=e.text.slice(0,remaining);remaining-=text.length;return {...e,text,...text.length<e.text.length?{batchTextTruncated:true}:{}};});return {events:projected,truncated:projected.length<events.length||projected.some((e)=>e.batchTextTruncated)};}
  return {admit,rows,describe,seal,project};
}
