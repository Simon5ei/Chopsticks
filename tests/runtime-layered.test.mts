import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRuntime} from '../src/host/runtime.mjs';
const until=async (fn?: any) =>{for(let n=0;n<400;n++){if(fn())return;await delay(5);}assert.fail('layered runtime timed out');};
const received=(id?: any,peer?: any,text?: any)=>({id,kind:'message.received',channel:`p:${peer}`,actorId:String(peer),text,meta:{addressed:true,messageId:id}});
async function setup(t?: any,options: Record<string, any>={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-runtime-'));const fishHome=path.join(dir,'fish');fs.mkdirSync(path.join(fishHome,'characters','fish'),{recursive:true});fs.writeFileSync(path.join(fishHome,'characters','current.json'),JSON.stringify({id:'fish'}));fs.writeFileSync(path.join(fishHome,'characters','fish','persona.md'),'same fish');let runtime;const deliveries=[],assessments=[];
 const controller={async inspect(){return{};},async resolveAgent(){},async selectModel(){},async cancel(){},async updateQueue(){},async prompt(input?: any){if(input.sessionId.startsWith('chopsticks-router-')){assessments.push(input);const events=JSON.parse(input.content[0].text.split('待判断事件：\n')[1]);queueMicrotask(()=>runtime.decide(input.sessionId,JSON.stringify(events.map((e)=>({eventId:e.id,kind:options.kind||'respond'})))));}else deliveries.push(input);return{accepted:true};}};
 runtime=await createRuntime({now:options.now,config:{evolution:{enabled:false},platformTurnTimeoutMs:options.timeoutMs,stateDir:path.join(dir,'state'),fishHome,routing:{layered:true},qq:{enabled:false,ownerId:'2'},bili:{enabled:false}},controller,adapterFactory:()=>({start:async()=>{},close:async()=>{},hydrateEvents(){},send:async()=>{throw Error('no real send');}})});await runtime.start();t.after(async()=>{await runtime.close();fs.rmSync(dir,{recursive:true,force:true});});return{runtime,deliveries,assessments};}
test('one QQ contact serializes source turns without changing the active binding',async (t?: any) =>{
 const f=await setup(t);await f.runtime.ingest(received('a',1,'first message'));await until(()=>f.deliveries.length===1);const first=f.deliveries[0];
 f.runtime.event({id:first.sessionId},{type:'user/message',data:{message:{source:{rpcId:first.requestId}}}});
 await f.runtime.ingest(received('b',1,'second message'));await until(()=>f.runtime.router.status().counts.dispatched===2);
 assert.equal(f.deliveries.length,1);assert.equal(f.runtime.caller(first.sessionId).eventId,'a');
 f.runtime.event({id:first.sessionId},{type:'turn/end',data:{}});await until(()=>f.deliveries.length===2);const second=f.deliveries[1];
 assert.equal(second.sessionId,first.sessionId);
 await assert.rejects(f.runtime.send(first.sessionId,{text:'late old reply'}),/ticket/i);
 f.runtime.event({id:second.sessionId},{type:'user/message',data:{message:{source:{rpcId:second.requestId}}}});
 assert.equal(f.runtime.caller(second.sessionId).eventId,'b');assert.equal(f.runtime.caller(second.sessionId).admin,false);
 assert.equal(f.runtime.state.list('platform-session').filter((r)=>r.key==='chat.qq.dm.1').length,1);
});
test('platform-private authorizations do not mix into the shared public group session',async (t?: any) =>{
 const f=await setup(t);await f.runtime.ingest(received('secret',1,'PRIVATE_FROM_A'));await until(()=>f.deliveries.length===1);
 await f.runtime.ingest({id:'g',kind:'message.received',channel:'g:3',actorId:'3',text:'group question',meta:{addressed:true}});await until(()=>f.deliveries.length===2);
 assert.notEqual(f.deliveries[0].sessionId,f.deliveries[1].sessionId);assert.doesNotMatch(f.deliveries[1].content[0].text,/PRIVATE_FROM_A/);
 assert.equal(f.runtime.router.status().layers.chat.counts.dispatched,2);
 const overview=await f.runtime.queryConsole('overview');assert.equal(overview.sessions.filter((s)=>s.role==='router').length,3);
 assert.equal(overview.sessions.filter((s)=>s.platformSession).length,2);
});

test('completed and timed-out platform turns cannot retain or restore administrator authority',async (t?: any) =>{
 let clock=1000;const f=await setup(t,{now:()=>clock,timeoutMs:100});
 await f.runtime.ingest(received('admin',2,'administrator request'));await until(()=>f.deliveries.length===1);const a=f.deliveries[0];
 f.runtime.event({id:a.sessionId},{type:'user/message',data:{source:{rpcId:a.requestId}}});assert.equal(f.runtime.caller(a.sessionId).admin,true);
 clock+=101;await f.runtime.platformSessions.tick();
 assert.throws(()=>f.runtime.caller(a.sessionId),/inactive|interrupted/i);
 await f.runtime.ingest(received('ordinary',1,'ordinary request'));await until(()=>f.deliveries.length===2);const b=f.deliveries[1];
 f.runtime.event({id:b.sessionId},{type:'user/message',data:{source:{rpcId:b.requestId}}});
 f.runtime.event({id:a.sessionId},{type:'user/message',data:{source:{rpcId:a.requestId}}});
 assert.equal(f.runtime.caller(b.sessionId).actorId,'1');assert.equal(f.runtime.caller(b.sessionId).admin,false);
 assert.throws(()=>f.runtime.development.ownerSource(b.sessionId));
 f.runtime.event({id:b.sessionId},{type:'turn/end',data:{}});
 assert.throws(()=>f.runtime.caller(b.sessionId),/inactive|interrupted/i);
 f.runtime.event({id:b.sessionId},{type:'user/message',data:{source:{rpcId:b.requestId}}});
 assert.throws(()=>f.runtime.caller(b.sessionId),/inactive|interrupted/i);
});

test('surf task decisions still consume an actual persistent platform turn instead of replacing it with a worker',async (t?: any) =>{
 const f=await setup(t,{kind:'task'});await f.runtime.ingest({id:'surf-item',kind:'timer',channel:'heybox:public',actorId:'fish',text:'item',meta:{itemId:'123',sourceTargetId:'123'}});
 await until(()=>f.deliveries.length===1);const d=f.deliveries[0];
 assert.match(d.sessionId,/^chopsticks-platform-/);assert.equal(f.runtime.state.list('platform-session')[0].key,'surf.heybox');
 assert.equal(f.runtime.state.list('platform-job')[0].action.kind,'respond');
});

test('IM Router is a real persistent session while each QQ contact has its own execution session',async (t?: any) =>{
 const f=await setup(t);await f.runtime.ingest(received('peer-a',1,'hello A'));await until(()=>f.deliveries.length===1);
 await f.runtime.ingest(received('peer-b',2,'hello B'));await until(()=>f.runtime.router.status().counts.dispatched===2);
 assert.equal(f.deliveries.length,2);assert.notEqual(f.deliveries[0].sessionId,f.deliveries[1].sessionId);
 assert.equal(f.assessments[0].sessionId,f.assessments[1].sessionId);
 const views=(await f.runtime.queryConsole('overview')).sessions.filter((s)=>s.role==='router');
 assert.ok(views.some((v)=>v.sessionId===f.assessments[0].sessionId&&v.native===true));
});

test('local reads survive a finished turn while writes still need the live one',async (t?: any) =>{
 const f=await setup(t);await f.runtime.ingest(received('a',1,'hello'));await until(()=>f.deliveries.length===1);
 const first=f.deliveries[0];
 f.runtime.event({id:first.sessionId},{type:'user/message',data:{message:{source:{rpcId:first.requestId}}}});
 assert.equal(f.runtime.caller(first.sessionId).eventId,'a');
 f.runtime.event({id:first.sessionId},{type:'turn/end',data:{}});await delay(10);
 assert.throws(()=>f.runtime.caller(first.sessionId),/inactive or interrupted/);
 assert.equal(f.runtime.caller(first.sessionId,{relaxed:true}).eventId,'a');
});
