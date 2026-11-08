import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../core/events.mjs';
import {createReminders} from '../host/reminders.mjs';

function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-reminders-')),store=createEventStore({stateDir:dir});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});const source={id:'source',kind:'message.received',channel:'p:100',actorId:'100',text:'明天提醒我读书'};store.append(source);const caller={role:'qq',channel:'p:100',actorId:'100',eventId:'source',consumed:true};let now=Date.parse('2026-11-03T02:00:00Z');const events=[];const make=ingest=>createReminders({store,now:()=>now,ingest:ingest|| (async e=>{events.push(e);return store.append(e);}),isAllowedChannel:c=>['p:100','p:200','g:1'].includes(c)});return{store,caller,events,make,setNow:v=>now=Date.parse(v)};}

test('reminders persist, scope list/cancel to source actor and replay tool calls idempotently',t=>{
 const f=fixture(t),r=f.make(),args={at:'2026-11-04T10:00:00+08:00',text:'读书'};
 const one=r.schedule(f.caller,args,'call1');assert.equal(r.schedule(f.caller,args,'call1').id,one.id);assert.throws(()=>r.schedule(f.caller,{...args,text:'changed'},'call1'),/changed/i);
 assert.equal(f.make().list(f.caller).length,1);
 const other={...f.caller,channel:'p:200',actorId:'200'};assert.deepEqual(r.list(other),[]);assert.throws(()=>r.cancel(other,one.id),/scope|owner|source/i);
 assert.equal(r.cancel(f.caller,one.id).cancelled,true);assert.equal(r.cancel(f.caller,one.id).cancelled,true);assert.deepEqual(r.list(f.caller),[]);
});

test('worker, unconsumed source, invalid time and extra destination cannot schedule effects',t=>{
 const f=fixture(t),r=f.make(),args={at:'2026-11-04T10:00:00+08:00',text:'读书'};
 assert.throws(()=>r.schedule({...f.caller,role:'worker'},args,'a'),/source|QQ|permission/i);
 assert.throws(()=>r.schedule({...f.caller,consumed:false},args,'a'),/source|consumed/i);
 assert.throws(()=>r.schedule(f.caller,{...args,at:'2026-11-04T10:00:00'},'a'),/timezone|时区/i);
 assert.throws(()=>r.schedule(f.caller,{...args,at:'2020-01-01T00:00:00Z'},'a'),/future|未来/i);
 assert.throws(()=>r.schedule(f.caller,{...args,channel:'p:200'},'a'),/argument|destination|unknown/i);
 assert.throws(()=>r.schedule(f.caller,{...args,text:' '.repeat(5)},'a'),/text|内容/i);
 assert.equal(r.list(f.caller).length,0);
});

test('overdue restart feeds one stable durable timer and cannot forge sent receipts',async t=>{
 const f=fixture(t),one=f.make().schedule(f.caller,{at:'2026-11-03T10:00:01+08:00',text:'读书'},'c');f.setNow('2026-11-03T02:00:05Z');const restarted=f.make();await Promise.all([restarted.tick(),restarted.tick()]);
 assert.equal(f.events.length,1);assert.equal(f.events[0].id,'reminder:'+one.id);assert.equal(f.events[0].kind,'timer');assert.equal(f.events[0].channel,'p:100');assert.equal(f.events[0].meta.sourceEventId,'source');assert.equal(f.store.recent({channel:'p:100',groups:false}).filter(e=>e.kind==='message.sent').length,0);
 await f.make().tick();assert.equal(f.events.length,1);assert.deepEqual(restarted.list(f.caller),[]);
});

test('ingestion failure keeps reminder due and retries only the same journal event id',async t=>{
 const f=fixture(t);let fail=true;const ids=[],r=f.make(async e=>{ids.push(e.id);if(fail){fail=false;throw Error('journal busy');}return f.store.append(e);});r.schedule(f.caller,{at:'2026-11-03T10:00:01+08:00',text:'读书'},'c');f.setNow('2026-11-03T02:00:05Z');
 await assert.rejects(r.tick(),/journal/);assert.equal(r.list(f.caller).length,1);await r.tick();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(r.list(f.caller).length,0);
});

test('replaying a completed scheduling call after its deadline returns its original result',async t=>{
 const f=fixture(t),r=f.make(),args={at:'2026-11-03T10:00:01+08:00',text:'读书'},one=r.schedule(f.caller,args,'c');f.setNow('2026-11-03T02:00:05Z');await r.tick();
 const replay=r.schedule(f.caller,args,'c');assert.equal(replay.id,one.id);assert.equal(replay.status,'fired');assert.equal(f.events.length,1);
});

test('invalid calendar dates are refused instead of normalized to another day',t=>{
 const f=fixture(t),r=f.make();assert.throws(()=>r.schedule(f.caller,{at:'2027-02-31T10:00:00+08:00',text:'读书'},'c'),/date|日期/i);assert.equal(r.list(f.caller).length,0);
});

test('cancelling a later due row during another ingestion prevents its timer event',async t=>{
 const f=fixture(t);let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const r=f.make(async event=>{entered();await gate;return f.store.append(event);});
 const args={at:'2026-11-03T10:00:01+08:00',text:'读书'};r.schedule(f.caller,args,'first');const later=r.schedule(f.caller,{...args,text:'第二项'},'second');f.setNow('2026-11-03T02:00:05Z');
 const tick=r.tick();await started;assert.equal(r.cancel(f.caller,later.id).cancelled,true);release();await tick;assert.equal(f.store.get('reminder:'+later.id),undefined);
});

test('cancellation cannot report success once the canonical timer append has begun',async t=>{
 const f=fixture(t);let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const r=f.make(async event=>{f.store.append(event);entered();await gate;return event;});
 const one=r.schedule(f.caller,{at:'2026-11-03T10:00:01+08:00',text:'读书'},'first');f.setNow('2026-11-03T02:00:05Z');const tick=r.tick();await started;
 const cancellation=r.cancel(f.caller,one.id);release();await tick;assert.equal(cancellation.cancelled,false);assert.ok(f.store.get('reminder:'+one.id));
});
