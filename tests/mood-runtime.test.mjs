import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRuntime} from '../host/runtime.mjs';

const dims={relevance:.8,congruence:.8,novelty:.4,certainty:.8,agency:.5,control:.7,norm:.5,urgency:.2,magnitude:.6};
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await delay(5);}assert.fail('runtime timed out');}
async function setup(t,{kind='respond',updates='valid'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mood-runtime-'));const fishHome=path.join(dir,'fish');
 fs.mkdirSync(path.join(fishHome,'characters','fish'),{recursive:true});fs.writeFileSync(path.join(fishHome,'characters/current.json'),JSON.stringify({id:'fish'}));fs.writeFileSync(path.join(fishHome,'characters/fish/persona.md'),'ORIGINAL_FISH');
 let runtime;const assessments=[],deliveries=[];
 const controller={async inspect(){return{};},async resolveAgent(){},async selectModel(){},async cancel(){},async updateQueue(){},async prompt(input){
  if(input.sessionId.startsWith('chopsticks-router-')){
   assessments.push(input);const events=JSON.parse(input.content[0].text.split('待判断事件：\n')[1]);
   queueMicrotask(()=>runtime.decide(input.sessionId,JSON.stringify(events.map(e=>({eventId:e.id,kind}))),updates==='valid'?JSON.stringify([{sourceEventIds:events.map(e=>e.id),appraisal:dims}]):'not json'));
  }else deliveries.push(input);
  return {accepted:true};
 }};
 runtime=await createRuntime({config:{stateDir:path.join(dir,'state'),fishHome,routing:{layered:true},evolution:{enabled:false},cerebrum:{enabled:true},qq:{enabled:false},bili:{enabled:false}},controller,adapterFactory:()=>({start:async()=>{},close:async()=>{},hydrateEvents(){}})});
 await runtime.start();t.after(async()=>{await runtime.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {runtime,assessments,deliveries};
}
const received=(id,channel='g:1')=>({id,channel,kind:'message.received',actorId:'42',text:'聊完一个有意思的话题',meta:{addressed:true}});

test('one existing layered Router call persists mood and passes only fixed expression hints to actor',async t=>{
 const f=await setup(t);await f.runtime.ingest(received('public'));await until(()=>f.deliveries.length===1);
 assert.equal(f.assessments.length,1);assert.match(f.assessments[0].content[0].text,/moodUpdatesJson/);
 const value=f.runtime.queryConsole('mood',{});assert.equal(value.history.length,1);assert.equal(value.mode,'express');
 assert.match(f.deliveries[0].content[0].text,/ORIGINAL_FISH/);assert.match(f.deliveries[0].content[0].text,/心境/);
 assert.equal(f.runtime.state.list('platform-session').filter(s=>s.workspace==='tasks').length,0);
});
test('observe decision still saves mood without launching an actor',async t=>{
 const f=await setup(t,{kind:'observe'});await f.runtime.ingest(received('observe'));await until(()=>f.runtime.router.status().counts.observed===1);
 assert.equal(f.assessments.length,1);assert.equal(f.deliveries.length,0);assert.equal(f.runtime.queryConsole('mood',{}).history.length,1);
});
test('malformed optional mood and private inputs preserve normal Router dispatch',async t=>{
 const f=await setup(t,{updates:'bad'});await f.runtime.ingest(received('bad'));await until(()=>f.deliveries.length===1);
 assert.equal(f.runtime.queryConsole('mood',{}).history.length,0);
 await f.runtime.ingest(received('private','p:42'));await until(()=>f.deliveries.length===2);
 assert.doesNotMatch(f.assessments[1].content[0].text,/moodUpdatesJson/);assert.doesNotMatch(f.deliveries[1].content[0].text,/心境参考/);
 assert.equal(f.runtime.queryConsole('mood',{}).history.length,0);
});
