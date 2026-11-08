import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createEventStore} from '../src/core/events.mjs';
import {createRouter} from '../src/core/router.mjs';

async function until(fn?: any){for(let i=0;i<250;i++){if(fn())return;await delay(5);}assert.fail('Router timed out');}
function fixture(t?: any){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mood-router-'));
 const store=createEventStore({stateDir:dir});let router;
 t.after(async()=>{await router?.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {store,make:(options)=>router=createRouter({store,...options})};
}
const event=(id)=>({id,channel:'g:1',kind:'message.received',actorId:'2',text:'真实群聊 fixture'});

test('Router offers mood evidence in the existing assessment and commits observe with mood before dispatch',async (t?: any) =>{
 const f=fixture(t);let prepared=0,committed=0,assessments=0,offered;
 f.store.db.exec('CREATE TABLE mood_fixture (event_id TEXT PRIMARY KEY)');
 const mood={prepare(events?: any){prepared++;return {prompt:'PUBLIC_EVIDENCE',sourceEventIds:events.map((e)=>e.id)};},commit(updates?: any,ids?: any){committed++;assert.deepEqual(ids,['one']);assert.equal(updates[0].sourceEventIds[0],'one');f.store.db.prepare('INSERT INTO mood_fixture VALUES(?)').run('one');}};
 const router=f.make({mood,assess:async({events,moodEvidence}: { events?: any; moodEvidence?: any; [key: string]: any })=>{assessments++;offered=moodEvidence;return {actions:[{eventId:events[0].id,kind:'observe'}],moodUpdates:[{sourceEventIds:['one'],appraisal:{}}]};},dispatch:async()=>assert.fail('observe must not dispatch')});
 await router.ingest(event('one'));await until(()=>router.status().counts.observed===1);
 assert.equal(assessments,1);assert.equal(prepared,1);assert.equal(committed,1);assert.equal(offered.prompt,'PUBLIC_EVIDENCE');
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM mood_fixture').get().n,1);
 await router.ingest(event('one'));await delay(20);assert.equal(assessments,1);
});

test('mood persistence and Router decision roll back together on failed commit',async (t?: any) =>{
 const f=fixture(t);f.store.db.exec('CREATE TABLE mood_fixture (event_id TEXT PRIMARY KEY)');
 let dispatched=0;
 const router=f.make({policy:{maxAttempts:1},mood:{prepare:()=>({sourceEventIds:['bad']}),commit(){f.store.db.prepare('INSERT INTO mood_fixture VALUES(?)').run('bad');throw Error('disk fixture failure');}},assess:async()=>({actions:[{eventId:'bad',kind:'respond'}],moodUpdates:[]}),dispatch:async()=>{dispatched++;}});
 await router.ingest(event('bad'));await until(()=>router.status().counts.failed+router.status().counts.dispatched===1);
 assert.equal(dispatched,0);assert.equal(router.status().counts.failed,1);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM mood_fixture').get().n,0);
 assert.equal(f.store.db.prepare('SELECT action FROM core_router WHERE event_id=?').get('bad').action,null);
});
