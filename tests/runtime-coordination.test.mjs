import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRuntime} from '../host/runtime.mjs';
const until=async fn=>{for(let i=0;i<250;i++){if(await fn())return;await delay(8);}assert.fail('coordination timed out');};
async function setup(t,{onAssess,kind='respond'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coordination-')),fishHome=path.join(dir,'fish');fs.mkdirSync(path.join(fishHome,'characters','fish'),{recursive:true});fs.writeFileSync(path.join(fishHome,'characters/current.json'),JSON.stringify({id:'fish'}));fs.writeFileSync(path.join(fishHome,'characters/fish/persona.md'),'大肥鱼');
 let r;const assessments=[],deliveries=[],cancels=[];
 const controller={async inspect(){return{};},async resolveAgent(){},async selectModel(){},async cancel(a){cancels.push(a);},async updateQueue(){},async prompt(input){if(input.sessionId.startsWith('chopsticks-router-')){assessments.push({...input,observedAt:Date.now()});await onAssess?.(r,input);const events=JSON.parse(input.content[0].text.split('待判断事件：\n')[1]);queueMicrotask(()=>r.decide(input.sessionId,JSON.stringify(events.map(e=>({eventId:e.id,kind})))));}else deliveries.push(input);return {accepted:true};}};
 r=await createRuntime({config:{stateDir:path.join(dir,'state'),fishHome,routing:{layered:true,batchWindowMs:250},qq:{enabled:false,ownerId:'2'},bili:{enabled:false},evolution:{enabled:false}},controller,adapterFactory:()=>({start:async()=>{},close:async()=>{},hydrateEvents(){}})});await r.start();t.after(async()=>{await r.close();fs.rmSync(dir,{recursive:true,force:true});});return {r,assessments,deliveries,cancels};
}
const e=(id,actorId='1',channel='g:3')=>({id,actorId,channel,kind:'message.received',text:id,meta:{addressed:true}});
test('runtime batches before LLM, preserves original actor, and links every source to dispatch',async t=>{
 const f=await setup(t);await f.r.ingest(e('ordinary'));await f.r.ingest(e('admin','2'));const deadline=f.r.store.db.prepare('SELECT deadline FROM core_batches WHERE id=?').get('batch:ordinary').deadline;await until(()=>f.deliveries.length===1);assert.equal(f.assessments.length,1);assert.ok(f.assessments[0].observedAt>=deadline);
 const d=f.deliveries[0],binding=f.r.state.get('request',d.requestId);assert.equal(binding.actorId,'1');assert.equal(binding.admin,false);assert.deepEqual(binding.eventIds,['ordinary','admin']);assert.ok(binding.batchId);
 const view=await f.r.queryConsole('pipeline',{eventId:'admin'});assert.ok(view.items.some(x=>x.kind==='batch.sealed'));assert.ok(view.items.some(x=>x.kind==='router.dispatch'));assert.equal(view.metrics.reportedTotalTokens,null);
});
test('active Router reads only its canonical source scope, and loses access on completion',async t=>{
 let id,checked=false;const f=await setup(t,{onAssess(r,input){id=input.sessionId;const c=r.contextCaller(id);assert.equal(c.chatKey,'p:1');assert.equal(c.admin,false);assert.equal(r.contextService.search(c,{query:'PRIVATE_OTHER'}).events.length,0);assert.throws(()=>r.contextCaller(id,'other'),/source/i);checked=true;}});
 f.r.store.append({...e('other','9','p:9'),text:'PRIVATE_OTHER',meta:{passive:true}});await f.r.ingest(e('current','1','p:1'));await until(()=>f.deliveries.length===1);assert.ok(checked);assert.throws(()=>f.r.contextCaller(id),/binding|evaluation/i);
});
test('owner explicit task stop bypasses batch delay without a model call',async t=>{
 const f=await setup(t);const task=await f.r.coordinator.submit({sessionId:'source',characterId:'fish',role:'qq',chatKey:'g:3'},{prompt:'read research',requestId:'task-origin'});const before=f.assessments.length;
 await f.r.ingest({...e('stop','2'),text:`/stop ${task.id}`});assert.equal(f.assessments.length,before);assert.equal((await f.r.coordinator.status({sessionId:'source',characterId:'fish',role:'qq',chatKey:'g:3'},task.id)).state,'stopped');assert.ok(f.r.queryConsole('pipeline',{eventId:'stop'}).items.some(x=>x.kind==='task.stop'));
});
test('unaddressed group follow-up inside an open window joins the same batch',async t=>{
 const f=await setup(t);await f.r.ingest(e('addressed'));await f.r.ingest({...e('continuation'),meta:{}});await until(()=>f.deliveries.length===1);
 assert.deepEqual(f.r.state.get('request',f.deliveries[0].requestId).eventIds,['addressed','continuation']);
});
test('queued worker input cannot steal the active turn trace source',async t=>{
 const f=await setup(t);const owner={sessionId:'source',characterId:'fish',role:'qq',chatKey:'g:3'};
 const task=await f.r.coordinator.submit(owner,{prompt:'read research',requestId:'task-first'});await f.r.coordinator.flush();const first=f.deliveries[0];assert.ok(first);
 f.r.event({id:first.sessionId},{type:'user/message',data:{message:{source:{rpcId:first.requestId}}}});
 await f.r.coordinator.follow(owner,task.id,'extra context');await f.r.coordinator.flush();const second=f.deliveries[1];assert.ok(second);
 f.r.event({id:first.sessionId},{type:'assistant/message',seq:11,data:{message:{content:[{type:'text',text:'old turn result'}]}}});
 const view=f.r.queryConsole('pipeline',{requestId:first.requestId});assert.ok(view.items.some(x=>x.kind==='model.response'));assert.equal(f.r.queryConsole('pipeline',{requestId:second.requestId}).metrics.modelResponses,0);
 f.r.event({id:first.sessionId},{type:'user/message',data:{message:{source:{rpcId:second.requestId}}}});
 f.r.event({id:first.sessionId},{type:'assistant/message',seq:13,data:{message:{content:[{type:'text',text:'new turn result'}]}}});assert.equal(f.r.queryConsole('pipeline',{requestId:second.requestId}).metrics.modelResponses,1);
});
