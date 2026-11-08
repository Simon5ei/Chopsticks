import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../core/events.mjs';
import {createHostState} from '../host/state.mjs';
import {createDeliveryCompletion} from '../host/delivery-completion.mjs';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-completion-'));
 let store,state,completion;
 function reopen(){store=createEventStore({stateDir:dir});state=createHostState(store);completion=createDeliveryCompletion({store,state,now:()=>123456});}
 reopen();t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const event=store.append({id:'incoming-1',kind:'message.received',channel:'bili:dm:1234',actorId:'1234',text:'fixture',at:1000,meta:{bili:{kind:'dm',peerId:'1234'}}});
 const binding={requestId:'dispatch-1',sessionId:'session-1',eventId:event.id,channel:event.channel,actorId:event.actorId,consumed:true};
 const job={requestId:binding.requestId,event,action:{kind:'respond'},binding};
 const sent=(overrides={})=>store.append({id:'sent-1',kind:'message.sent',channel:event.channel,actorId:'fish',text:'fixture reply',meta:{messageId:'5678',inReplyTo:event.id},...overrides});
 return {get store(){return store;},get state(){return state;},get completion(){return completion;},event,binding,job,sent,restart(){store.close();reopen();}};
}

test('plain-text completion permits one durable continuation and never issues it twice after restart',t=>{
 const f=fixture(t);assert.equal(f.completion.finish(f.job).status,'retry');
 assert.equal(f.completion.finish(f.job).status,'undelivered');
 f.restart();assert.equal(f.completion.finish(f.job).status,'undelivered');
 assert.equal(f.state.get('delivery-completion','dispatch-1').status,'undelivered');
});

test('a continuation that also omits delivery is terminal even with a new request identity',t=>{
 const f=fixture(t);assert.equal(f.completion.finish(f.job).status,'retry');
 const again={...f.job,requestId:'dispatch-1:completion:1',action:{kind:'respond',completionRetry:1}};
 assert.equal(f.completion.finish(again).status,'undelivered');
});

test('only durable same-source same-channel outgoing receipts establish delivery',t=>{
 const f=fixture(t);f.sent({id:'foreign',channel:'bili:dm:9999'});
 f.sent({id:'unrelated',meta:{messageId:'99',inReplyTo:'other'}});
 assert.equal(f.completion.finish(f.job).status,'retry');
 f.sent();for(let n=0;n<205;n++)f.store.append({id:`later-${n}`,kind:'task.result',channel:f.event.channel,actorId:'worker',text:'fixture'});
 assert.equal(f.completion.finish(f.job).status,'delivered');
 f.restart();assert.equal(f.completion.finish(f.job).status,'delivered');
});

test('track records an attempt before dispatch and a trusted durable receipt after it',async t=>{
 const f=fixture(t);
 const result=await f.completion.track(f.binding,async()=>{
  assert.equal(f.state.get('delivery-attempt',f.binding.requestId).status,'attempting');return f.sent();
 });
 assert.equal(result.id,'sent-1');assert.equal(f.state.get('delivery-attempt',f.binding.requestId).status,'confirmed');
 assert.equal(f.completion.finish(f.job).status,'delivered');
 await assert.rejects(()=>f.completion.track(f.binding,async()=>assert.fail('must not resend')),/attempt/i);
});

test('an uncertain send remains terminal through restart and never stores the exception text',async t=>{
 const f=fixture(t);const error=Error('fixture-private-error');
 await assert.rejects(f.completion.track(f.binding,async()=>{throw error;}),e=>e===error);
 assert.equal(f.state.get('delivery-attempt',f.binding.requestId).status,'unknown');
 assert.equal(f.completion.finish(f.job).status,'undelivered');f.restart();
 assert.equal(f.completion.finish(f.job).status,'undelivered');
 assert.doesNotMatch(JSON.stringify(f.state.list('delivery-attempt')),/fixture-private-error/);
 await assert.rejects(()=>f.completion.track({...f.binding,requestId:'another'},async()=>assert.fail('must not resend an unknown source')),/attempt/i);
});

test('a preflight refusal or untrusted result prevents automatic retry without claiming delivery',async t=>{
 for(const value of [{sent:false,reason:'context_changed'},{kind:'message.sent',id:'invented',channel:'bili:dm:1234',meta:{inReplyTo:'incoming-1',messageId:'77'}}]){
  const f=fixture(t);assert.deepEqual(await f.completion.track(f.binding,async()=>value),value);
  assert.equal(f.state.get('delivery-attempt',f.binding.requestId).status,'refused');
  assert.equal(f.completion.finish(f.job).status,'undelivered');
 }
});

test('persisted in-flight attempt is uncertain enough to prohibit continuation after restart',t=>{
 const f=fixture(t);f.state.put('delivery-attempt',f.binding.requestId,{eventId:f.event.id,channel:f.event.channel,status:'attempting'});
 f.restart();assert.equal(f.completion.finish(f.job).status,'undelivered');
});

test('explicit consumed-source decline is durable, rejects empty reasons and never exposes private reason in finish',t=>{
 const f=fixture(t);assert.throws(()=>f.completion.decline({...f.binding,consumed:false},'decline'),/consum/i);
 assert.throws(()=>f.completion.decline(f.binding,'  '),/reason/i);
 f.completion.decline(f.binding,'fixture private reason');f.restart();
 const outcome=f.completion.finish(f.job);assert.equal(outcome.status,'declined');assert.doesNotMatch(JSON.stringify(outcome),/fixture private reason/);
});

test('newer incoming message in the same channel supersedes unsent work, even with an older platform timestamp',t=>{
 const f=fixture(t);f.store.append({id:'other-contact',kind:'message.received',channel:'bili:dm:9999',actorId:'9999',text:'fixture',at:2000});
 f.store.append({id:'new-arrival',kind:'message.received',channel:f.event.channel,actorId:f.event.actorId,text:'fixture',at:500});
 assert.equal(f.completion.finish(f.job).status,'superseded');
});

test('another channel alone does not supersede and cancellation never schedules a continuation',t=>{
 const f=fixture(t);f.store.append({id:'other-contact',kind:'message.received',channel:'bili:dm:9999',actorId:'9999',text:'fixture'});
 assert.equal(f.completion.finish(f.job).status,'retry');
 const g=fixture(t);assert.equal(g.completion.finish({...g.job,binding:{...g.binding,interrupted:true}}).status,'undelivered');
});

test('unconsumed or mismatched sources cannot enter the send or decline lifecycle',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>f.completion.track({...f.binding,consumed:false},async()=>assert.fail('unconsumed source')),/consum/i);
 await assert.rejects(()=>f.completion.track({...f.binding,channel:'bili:dm:9999'},async()=>assert.fail('wrong recipient')),/source/i);
 assert.throws(()=>f.completion.decline({...f.binding,eventId:'absent'},'fixture'),/source/i);
});

test('other kinds of work complete without entering Bili DM reply continuation policy',t=>{
 const f=fixture(t);
 for(const job of [{...f.job,event:{...f.event,channel:'g:42'}},{...f.job,event:{...f.event,kind:'timer'}},{...f.job,action:{kind:'observe'}}])assert.equal(f.completion.finish(job).status,'completed');
});

test('a malformed apparent receipt is a refusal, and cannot create a continuation',async t=>{
 const f=fixture(t);await f.completion.track(f.binding,async()=>({kind:'message.sent'}));
 assert.equal(f.state.get('delivery-attempt',f.binding.requestId).status,'refused');
 assert.equal(f.completion.finish(f.job).status,'undelivered');
});

test('an in-flight attempt excludes a competing send and cannot be relabeled as deliberate silence',async t=>{
 const f=fixture(t);let release;
 const pending=f.completion.track(f.binding,()=>new Promise(resolve=>{release=resolve;}));
 await assert.rejects(()=>f.completion.track({...f.binding,requestId:'competing-request'},async()=>assert.fail('duplicate send')),/attempt/i);
 assert.throws(()=>f.completion.decline(f.binding,'changed mind'),/attempt/i);
 assert.equal(f.completion.finish(f.job).status,'undelivered');release({sent:false});await pending;
});

test('late confirmed evidence resolves unknown delivery without retrying its send',async t=>{
 const f=fixture(t);await assert.rejects(()=>f.completion.track(f.binding,async()=>{throw Error('network');}));
 assert.equal(f.completion.finish(f.job).status,'undelivered');f.sent();
 assert.equal(f.completion.finish(f.job).status,'delivered');
});

test('retry authorization is source-scoped and a persisted interruption remains terminal',t=>{
 const f=fixture(t);assert.equal(f.completion.finish(f.job).status,'retry');
 assert.equal(f.completion.finish({...f.job,requestId:'different-dispatch'}).status,'undelivered');
 const g=fixture(t);g.state.put('request',g.binding.requestId,{...g.binding,interrupted:true});g.restart();
 assert.equal(g.completion.finish(g.job).status,'undelivered');
});
