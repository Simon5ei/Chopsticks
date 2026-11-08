import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCoordinator} from '../src/tasks/coordinator.mjs';

const caller={role:'bili-dm',sessionId:'native-contact',chatKey:'bili:dm:1234',characterId:'fish'};
const source=(eventId?: any,decision: string='accept',extra: Record<string, any>={})=>({eventId,threadId:'discussion',text:`source ${eventId}`,decision,requestId:`route-${eventId}`,...extra});
function fixture(t?: any){
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'tasks-source-')),prompts=[],results=[];
 const options={stateDir,autoStart:false,executor:{async ensureSession(){},async prompt(p?: any){prompts.push(p);return {accepted:true};},async abort(){}},deliverResult:async (r?: any) =>{results.push(r);return {accepted:true};}};
 let coordinator=createCoordinator(options);
 t.after(async()=>{await coordinator.close();fs.rmSync(stateDir,{recursive:true,force:true});});
 function records(kind?: any){const db=new DatabaseSync(path.join(stateDir,'superagent.sqlite'),{readOnly:true});try{return db.prepare('SELECT value FROM records WHERE kind=?').all(kind).map((r)=>JSON.parse(r.value as string));}finally{db.close();}}
 return {get coordinator(){return coordinator;},prompts,results,records,async restart(){await coordinator.close();coordinator=createCoordinator(options);}};
}

test('explicit accepts on one real source Thread create separate tickets without subscription fanout',async (t?: any) =>{
 const f=fixture(t),one=await f.coordinator.routeSource(caller,source('one'));
 await f.coordinator.flush();const two=await f.coordinator.routeSource(caller,source('two'));await f.coordinator.flush();
 assert.notEqual(one.ticketId,two.ticketId);assert.equal(f.prompts.length,2);
 assert.doesNotMatch(f.prompts[0].text,/source two/);assert.doesNotMatch(f.prompts[1].text,/source one/);
 const threads=f.records('thread');assert.equal(threads.length,1);assert.deepEqual(new Set<any>(threads[0].subscriptions),new Set<any>([one.ticketId,two.ticketId]));
 assert.deepEqual(one.source,{eventId:'one',threadId:'discussion'});
 assert.deepEqual(one.subscriptions,[{threadId:'discussion',chatKey:caller.chatKey,characterId:'fish'}]);
});

test('explicit attach selects one existing ticket and never feeds its sibling subscription',async (t?: any) =>{
 const f=fixture(t),one=await f.coordinator.routeSource(caller,source('one')),two=await f.coordinator.routeSource(caller,source('two'));await f.coordinator.flush();
 const attached=await f.coordinator.routeSource(caller,source('three','attach',{ticketId:one.ticketId}));await f.coordinator.flush();
 assert.equal(attached.ticketId,one.ticketId);assert.equal(f.prompts.length,3);
 assert.equal(f.coordinator.getWorkerContext(f.prompts[2].sessionId).ticketId,one.ticketId);assert.match(f.prompts[2].text,/source three/);
 assert.equal(f.records('ticket').find((t)=>t.id===two.ticketId).inputs.length,1);
});

test('source event replay is idempotent across request IDs and restart but changed facts conflict',async (t?: any) =>{
 const f=fixture(t),input=source('one'),one=await f.coordinator.routeSource(caller,input);await f.coordinator.flush();await f.restart();
 const same=await f.coordinator.routeSource({...caller,sessionId:'restored-native'}, {...input,requestId:'different-request'});
 assert.equal(same.ticketId,one.ticketId);await f.coordinator.flush();assert.equal(f.prompts.length,1);
 for(const change of [{text:'changed'},{threadId:'changed'},{decision:'ignore'}])await assert.rejects(()=>f.coordinator.routeSource(caller,{...input,...change}),/conflict/i);
 await assert.rejects(()=>f.coordinator.routeSource(caller,source('two','accept',{requestId:input.requestId})),/conflict/i);
 assert.equal(f.records('trigger').length,1);
});

test('ignore persists a source decision without waking any subscribed worker',async (t?: any) =>{
 const f=fixture(t);await f.coordinator.routeSource(caller,source('one'));await f.coordinator.flush();
 const ignored=await f.coordinator.routeSource(caller,source('two','ignore'));await f.coordinator.flush();
 assert.equal(ignored.decision,'ignore');assert.equal(f.prompts.length,1);assert.equal(f.records('trigger').length,2);
 assert.ok(f.records('decision').some((d)=>d.kind==='ignore'));
});

test('attach and stop require exact character and channel even for an operator',async (t?: any) =>{
 const f=fixture(t),one=await f.coordinator.routeSource(caller,source('one'));
 for(const foreign of [{...caller,chatKey:'bili:dm:9999'},{...caller,characterId:'other-fish'},{...caller,role:'operator',chatKey:'bili:public'}])for(const decision of ['attach','stop']){
  await assert.rejects(()=>f.coordinator.routeSource(foreign,source('cross',decision,{ticketId:one.ticketId})),/scope/i);
 }
 assert.equal(f.records('trigger').length,1);
 const stopped=await f.coordinator.routeSource(caller,source('stop','stop',{ticketId:one.ticketId}));assert.equal(stopped.state,'stopped');await f.coordinator.flush();assert.equal(f.prompts.length,0);
 await assert.rejects(()=>f.coordinator.routeSource(caller,source('late','attach',{ticketId:one.ticketId})),/stopped/i);
});

test('same external thread labels are isolated across platform, private target and character',async (t?: any) =>{
 const f=fixture(t);
 for(const c of [caller,{...caller,chatKey:'bili:dm:9999'},{...caller,chatKey:'bili:public'},{...caller,characterId:'other-fish'}])await f.coordinator.routeSource(c,source('one'));
 assert.equal(f.records('thread').length,4);assert.equal(f.records('ticket').length,4);
});

test('extended social caller roles retain read-only workers and routed result provenance',async (t?: any) =>{
 const f=fixture(t);
 for(const role of ['bili-dm','douyin','heybox','qzone','wechat']){
  const c={...caller,role,chatKey:`${role}:source`};
  const task=await f.coordinator.routeSource(c,source(role));await f.coordinator.flush();
  const prompt=f.prompts.at(-1),worker=f.coordinator.getWorkerContext(prompt.sessionId);assert.equal(worker.canWrite,false);
  await assert.rejects(()=>f.coordinator.routeSource(worker,source('nested')),/worker/i);
  await f.coordinator.report(worker,{ticketId:task.ticketId,state:'ready',summary:'verified fixture',deliveryId:prompt.deliveryId});await f.coordinator.flush();
  assert.equal(f.results.at(-1).origin.chatKey,c.chatKey);assert.equal(f.results.at(-1).ticketId,task.ticketId);
  assert.equal(f.results.at(-1).origin.eventId,role);assert.equal(f.results.at(-1).origin.threadId,'discussion');
 }
});

test('explicit task follow-up targets only its chosen task on a shared source Thread',async (t?: any) =>{
 const f=fixture(t),one=await f.coordinator.routeSource(caller,source('one')),two=await f.coordinator.routeSource(caller,source('two'));await f.coordinator.flush();
 await f.coordinator.follow(caller,one.ticketId,'chosen follow-up');await f.coordinator.flush();
 assert.equal(f.prompts.length,3);assert.equal(f.coordinator.getWorkerContext(f.prompts[2].sessionId).ticketId,one.ticketId);
 assert.equal(f.records('ticket').find((t)=>t.id===two.ticketId).inputs.length,1);
});

test('source trigger preserves exact text and rejects even whitespace changes on event replay',async (t?: any) =>{
 const f=fixture(t),input=source('original','accept',{text:'  exact source\n'});
 await f.coordinator.routeSource(caller,input);assert.equal(f.records('trigger')[0].text,'  exact source\n');
 await assert.rejects(()=>f.coordinator.routeSource(caller,{...input,text:'exact source'}),/conflict/i);
});

test('attaching a verified second content object adds its Thread subscription while preserving result origin',async (t?: any) =>{
 const f=fixture(t),publicCaller={...caller,role:'bili',chatKey:'bili:public'};
 const first=await f.coordinator.routeSource(publicCaller,source('article-one','accept',{threadId:'verified-object-one'}));await f.coordinator.flush();
 const attached=await f.coordinator.routeSource(publicCaller,source('article-two','attach',{threadId:'verified-object-two',ticketId:first.ticketId}));await f.coordinator.flush();
 assert.deepEqual(attached.subscriptions.map((s)=>s.threadId).sort(),['verified-object-one','verified-object-two']);
 assert.deepEqual(attached.source,{eventId:'article-one',threadId:'verified-object-one'});
 const prompt=f.prompts.at(-1),worker=f.coordinator.getWorkerContext(prompt.sessionId);
 await f.coordinator.report(worker,{ticketId:first.ticketId,state:'ready',summary:'both sources verified',deliveryId:prompt.deliveryId});await f.coordinator.flush();
 assert.equal(f.results.length,1);assert.equal(f.results[0].origin.eventId,'article-one');assert.equal(f.results[0].origin.threadId,'verified-object-one');
});
