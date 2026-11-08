import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../src/core/events.mjs';
import {createHostState} from '../src/host/state.mjs';
test('confirmed send persisted, replay idempotent across restart and changed payload refused',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-host-'));const store=createEventStore({stateDir:dir});
 const state=createHostState(store);let calls=0;
 const send=async()=>{calls++;return store.append({id:'qq:sent:1',kind:'message.sent',channel:'g:1',actorId:'fish',text:'rice',meta:{messageId:'1'}});};
 const input={channel:'g:1',text:'rice'};
 await state.send('call1',input,send);await createHostState(store).send('call1',input,send);assert.equal(calls,1);
 await assert.rejects(state.send('call1',{...input,text:'other'},send),/changed/);
 store.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('uncertain send never retried; fresh context fences stale outgoing text',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-host-'));const store=createEventStore({stateDir:dir});const state=createHostState(store);
 let calls=0;const fail=async()=>{calls++;throw Object.assign(Error('network'),{code:'SEND_UNCERTAIN'});};
 await assert.rejects(state.send('x',{channel:'g:1',text:'x'},fail));await assert.rejects(state.send('x',{channel:'g:1',text:'x'},fail),/uncertain/);assert.equal(calls,1);
 state.bind('session',{channel:'g:2',revision:0,eventId:'inbound'});
 store.append({id:'A',kind:'message.sent',channel:'g:1',actorId:'fish',text:'刚在A吃饭',meta:{messageId:'A'}});
 assert.equal(state.fresh('session').changed,true);assert.equal(state.fresh('session').changed,false);
 store.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('read watermark cannot acknowledge beyond actually returned snapshot',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-host-'));const store=createEventStore({stateDir:dir});const state=createHostState(store);
 store.append({id:'1',kind:'message.received',channel:'g:1',actorId:'a',text:'old'});
 const snapshot=state.read('g:1');store.append({id:'2',kind:'message.received',channel:'g:1',actorId:'a',text:'new'});
 assert.throws(()=>state.markRead('g:1',2),/unseen/);state.markRead('g:1',snapshot.readThroughSeq);
 assert.equal(state.read('g:1',{unread:true}).events.length,1);
 store.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('proven preflight refusal is recorded not_sent with safe diagnostics and never auto replayed',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'send-boundary-')),store=createEventStore({stateDir:dir}),state=createHostState(store);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 let attempts=0;const input={text:'pong'};const perform=async()=>{attempts++;throw Object.assign(Error('private cookie must not persist'),{deliveryState:'not_sent',code:'BILI_API',apiCode:-101,endpoint:'/x/web-interface/nav'});};
 await assert.rejects(state.send('preflight',input,perform));
 const row=store.db.prepare('SELECT state,value FROM host_sends WHERE id=?').get('preflight');assert.equal(row.state,'not_sent');assert.deepEqual(JSON.parse(row.value as string),{deliveryState:'not_sent',code:'BILI_API',apiCode:-101,endpoint:'/x/web-interface/nav'});
 await assert.rejects(createHostState(store).send('preflight',input,perform),/not sent|not_sent/i);assert.equal(attempts,1);
});
