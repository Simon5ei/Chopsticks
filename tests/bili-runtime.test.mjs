import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRuntime} from '../host/runtime.mjs';

async function until(fn){for(let i=0;i<300;i++){if(fn())return;await delay(5);}assert.fail('condition timed out');}
async function fixture(t,{events=[],feeds=[{bvid:'BV1xx411c7mD',title:'fixture'}],at='2026-11-04T08:30:00Z',layered=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chopsticks-bili-life-')),fishHome=path.join(dir,'fish');
 fs.mkdirSync(path.join(fishHome,'characters','fish'),{recursive:true});
 fs.writeFileSync(path.join(fishHome,'characters/current.json'),JSON.stringify({id:'fish'}));
 fs.writeFileSync(path.join(fishHome,'characters/fish/persona.md'),'same fish persona');
 fs.writeFileSync(path.join(fishHome,'bili.config.json'),JSON.stringify({listen:{comment:true,dm:true,dmScope:'all',allDay:true,commentIntervalSec:300}}));
 let runtime;const deliveries=[],sends=[],reads=[],created=[];let batch=events;
 const controller={async inspect(){},async resolveAgent(){},async selectModel(){},async create(v){created.push(v);return v;},async cancel(){},async updateQueue(){},async prompt(v){
  const text=v.content[0].text;
  if(v.sessionId.startsWith('chopsticks-router-')){const es=JSON.parse(text.split('待判断事件：\n')[1]);queueMicrotask(()=>runtime.decide(v.sessionId,JSON.stringify(es.map(e=>({eventId:e.id,kind:'respond'})))));}
  else deliveries.push({...v,text});return {accepted:true};
 }};
 let details={};const social={async poll(o){reads.push(o);return {events:batch,selfId:'900',...details};},async sendDM(o){await o.beforeSend?.();sends.push(o);return {status:'confirmed',kind:'dm',id:'777'};},close(){}};
 runtime=await createRuntime({config:{evolution:{enabled:false},stateDir:path.join(dir,'state'),fishHome,routing:{layered},qq:{enabled:false,ownerId:'123'},bili:{enabled:true,allowWrite:true,windows:[{start:'16:00',end:'18:00',wakes:3}],maxWakesPerDay:12,intervalMs:600000},routerTimeoutMs:500},controller,adapterFactory:()=>({start(){},close(){}}),socialFactory:()=>social,feedFactory:()=>async()=>({items:feeds}),now:()=>Date.parse(at)});
 await runtime.start();t.after(async()=>{await runtime.close();fs.rmSync(dir,{recursive:true,force:true});});
 const consume=d=>runtime.event({id:d.sessionId},{type:'user/message',data:{message:{source:{rpcId:d.requestId}}}});
 return {runtime,deliveries,sends,reads,consume,setBatch:v=>{batch=v;},setDetails:v=>{details=v;},setSender:v=>{social.sendDM=v;}};
}
const dm=(id,peer='42',text='private question')=>({id,kind:'message.received',channel:`bili:dm:${peer}`,actorId:peer,text,at:'2026-11-04T08:30:00Z',meta:{addressed:true,messageId:id,bili:{kind:'dm',peerId:peer,msgKey:id}}});

test('Shanghai feed window produces public opportunity and Bili tool instructions, not QQ send protocol',async t=>{
 const f=await fixture(t);await f.runtime.pollFeed();await until(()=>f.deliveries.length===1);
 assert.equal(f.deliveries[0].sessionId,f.runtime.biliSession);assert.match(f.deliveries[0].text,/BV1xx411c7mD/);assert.doesNotMatch(f.deliveries[0].text,/发言只用 chopsticks_send/);
 assert.equal(f.runtime.status().bili.feed.state,'ready');
});
test('empty feed does not consume an opportunity and exposes empty state',async t=>{
 const f=await fixture(t,{feeds:[]});await f.runtime.pollFeed();
 assert.equal(f.runtime.state.get('bili-wakes','2026-11-04'),undefined);assert.equal(f.runtime.status().bili.feed.state,'empty');assert.equal(f.deliveries.length,0);
});
test('layered Bili feed creates one content round per item in the same native conversation',async t=>{
 const f=await fixture(t,{layered:true,feeds:[{bvid:'BV1xx411c7mD',title:'first'},{bvid:'BV1xx411c7mE',title:'second'}]});
 await f.runtime.pollFeed();await until(()=>f.deliveries.length===1);const first=f.deliveries[0];
 await until(()=>f.runtime.platformSessions.status().length===2);
 const timers=f.runtime.store.recent({channel:'bili:public',groups:false}).filter(e=>e.kind==='timer');assert.equal(timers.length,2);assert.deepEqual(timers.map(e=>e.meta.itemId),['BV1xx411c7mD','BV1xx411c7mE']);
 assert.equal(f.runtime.state.get('bili-wakes','2026-11-04').total,1,'one feed opportunity retains original quota semantics');
 f.consume(first);f.runtime.event({id:first.sessionId},{type:'turn/end'});await until(()=>f.deliveries.length===2);
 assert.equal(first.sessionId,f.deliveries[1].sessionId);assert.notEqual(first.sessionId,f.runtime.biliSession,'new platform workspace retains the old history separately');
});
test('social first poll baselines historical inbox then a new private message routes once to a private Bili session',async t=>{
 const f=await fixture(t,{events:[dm('old')]});await f.runtime.pollSocial({force:true});assert.equal(f.deliveries.length,0);
 f.setBatch([dm('old'),dm('new')]);await f.runtime.pollSocial({force:true});await until(()=>f.deliveries.length===1);
 const d=f.deliveries[0];f.consume(d);assert.equal(f.runtime.caller(d.sessionId).role,'bili-dm');assert.match(d.text,/private question/);assert.doesNotMatch(d.text,/chopsticks_develop/);
 await f.runtime.pollSocial({force:true});await delay(20);assert.equal(f.deliveries.length,1);assert.doesNotMatch(f.runtime.store.context({channel:'g:1'}).text,/private question/);
});
test('private reply is bound to consumed source, confirms once, and never uses QQ transport',async t=>{
 const f=await fixture(t);await f.runtime.ingest(dm('new-dm'));await until(()=>f.deliveries.length===1);const d=f.deliveries[0];
 await assert.rejects(()=>f.runtime.replyBiliDM(d.sessionId,{text:'hello'}),/consum|来源/);
 f.consume(d);const one=await f.runtime.replyBiliDM(d.sessionId,{text:'hello'}),two=await f.runtime.replyBiliDM(d.sessionId,{text:'hello'});
 assert.equal(one.meta.messageId,'777');assert.equal(two.id,one.id);assert.equal(f.sends.length,1);assert.equal(f.sends[0].peerId,'42');
 assert.equal(f.runtime.store.recent({channel:'bili:dm:42',groups:false}).filter(e=>e.kind==='message.sent').length,1);
});
test('public comment reply takes only canonical source coordinates and records platform receipt',async t=>{
 const f=await fixture(t);const ev={id:'notice-one',kind:'message.received',channel:'bili:public',actorId:'43',text:'public reply',meta:{addressed:true,bili:{kind:'comment',oid:'99',type:17,root:'888',parent:'889',dynamicId:'1234567890123456789'}}};
 await f.runtime.ingest(ev);await until(()=>f.deliveries.length===1);f.consume(f.deliveries[0]);const calls=[];
 const receipt=await f.runtime.replyBiliComment(f.deliveries[0].sessionId,{text:'thanks'},undefined,async args=>{calls.push(args);return {structuredContent:{receipt:{status:'confirmed',kind:'comment',id:'555',url:'https://t.bilibili.com/1234567890123456789#reply555'}}};});
 assert.equal(calls.length,1);assert.equal(calls[0].dynamicId,ev.meta.bili.dynamicId);assert.equal(calls[0].parent,'889');assert.equal(receipt.meta.messageId,'555');
 await assert.rejects(()=>f.runtime.replyBiliDM(f.deliveries[0].sessionId,{text:'wrong'}),/private|私信/);
});
test('partial inbox remains explicit and persisted notice keys are supplied on later polls',async t=>{
 const f=await fixture(t);f.setBatch([{...dm('seed'),meta:{addressed:true,bili:{kind:'dm',peerId:'42'}}}]);f.setDetails({truncated:true,warnings:[{phase:'deadline'}]});
 await f.runtime.pollSocial({force:true});assert.equal(f.runtime.status().bili.inbox.state,'partial');assert.equal(f.runtime.state.get('bili-inbox','dm').complete,false);
 f.setDetails({});f.setBatch([{id:'known-comment',kind:'message.received',channel:'bili:public',actorId:'43',text:'hi',at:'2026-11-04T08:30:00Z',meta:{notificationKeys:['reply:123','at:456'],bili:{kind:'comment'}}}]);
 await f.runtime.pollSocial({force:true});await f.runtime.pollSocial({force:true});assert.deepEqual([...f.reads.at(-1).seenNotificationKeys].sort(),['at:456','reply:123']);
});
test('messages discovered after initial truncation but older than baseline are not replayed',async t=>{
 const f=await fixture(t);f.setDetails({truncated:true});await f.runtime.pollSocial({force:true});
 f.setDetails({});f.setBatch([{...dm('previous-history'),at:'2026-11-03T08:30:00Z'}]);await f.runtime.pollSocial({force:true});await delay(20);assert.equal(f.deliveries.length,0);
});
test('shutdown cancels an active Bili reply before closing its durable send state',async t=>{
 const f=await fixture(t);let started=false,aborted=false;
 f.setSender(async({signal})=>{started=true;return new Promise((_ok,no)=>{signal?.addEventListener('abort',()=>{aborted=true;no(new Error('fixture cancelled'));},{once:true});});});
 await f.runtime.ingest(dm('closing-dm'));await until(()=>f.deliveries.length===1);f.consume(f.deliveries[0]);
 const send=f.runtime.replyBiliDM(f.deliveries[0].sessionId,{text:'hello'});send.catch(()=>{});await until(()=>started);
 await Promise.race([f.runtime.close(),delay(300)]);assert.equal(aborted,true,'runtime must own and abort each reply signal');
 await assert.rejects(send,/cancelled/);
});
test('a plain-text Bili DM turn gets one explicit delivery continuation and can decline without sending',async t=>{
 const f=await fixture(t,{layered:true});await f.runtime.ingest(dm('missing-tool'));await until(()=>f.deliveries.length===1);
 const first=f.deliveries[0];f.consume(first);f.runtime.event({id:first.sessionId},{type:'turn/end'});await until(()=>f.deliveries.length===2);
 const second=f.deliveries[1];assert.equal(second.sessionId,first.sessionId);assert.match(second.text,/上一轮.*没有.*发送/);
 f.consume(second);f.runtime.noReply(second.sessionId,{reason:'这条消息自然收尾，无需再回复'});
 f.runtime.event({id:second.sessionId},{type:'turn/end'});await delay(30);assert.equal(f.deliveries.length,2);assert.equal(f.sends.length,0);
 assert.equal(f.runtime.state.get('delivery-completion',second.requestId).status,'declined');
});
test('a trusted task result replies to original Bili peer with its own delivery identity',async t=>{
 const f=await fixture(t,{layered:true});const original=dm('task-original');f.runtime.store.append({...original,meta:{...original.meta,passive:true}});
 f.runtime.state.put('result-source','worker-result',{eventId:original.id,channel:original.channel,actorId:original.actorId,ticketId:'ticket'});
 await f.runtime.ingest({id:'worker-result',kind:'task.result',channel:original.channel,actorId:'fish-worker',text:'verified task result',meta:{route:true,ticketId:'ticket',taskSourceEventId:original.id}});
 await until(()=>f.deliveries.length===1);f.consume(f.deliveries[0]);const r=await f.runtime.replyBiliDM(f.deliveries[0].sessionId,{text:'这是查到的结果'});
 assert.equal(r.meta.inReplyTo,'worker-result');assert.equal(f.sends[0].peerId,'42');assert.equal(f.sends[0].expectedMsgKey,'task-original');
});
