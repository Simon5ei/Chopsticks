import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLifeOwner} from '../src/life/owner.mjs';
import {createHostState} from '../src/host/state.mjs';
import {createEventStore} from '../src/core/events.mjs';
test('a successful unpageable snapshot establishes a baseline and still admits future arrivals',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inbox-unpageable-')),store=createEventStore({stateDir:dir}),state=createHostState(store),events=[];let fresh=false;
 const owner=createLifeOwner({config:{stateDir:dir},state,store,authorize:()=>{},now:()=>2000,onEvent:(e)=>{events.push(e);return store.append(e);},platforms:{douyin:{capabilities:{inbox:true},read:async()=>({items:[{id:fresh?'new':'old',actorId:'42',visibility:'private',text:'fixture',at:fresh?3000:500}],truncated:true,warnings:[]})}}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});await owner.pollInteractions();fresh=true;await owner.pollInteractions();
 assert.equal(events.length,1);assert.equal(state.get('life-inbox','douyin:inbox:all').state,'partial');assert.equal(state.get('life-inbox','douyin:inbox:all').seeding,false);
});
test('a complete inbox catch-up drains older pages before advancing its sequence watermark',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inbox-pages-')),store=createEventStore({stateDir:dir}),state=createHostState(store),events=[],cursors=[];
 state.put('life-inbox','heybox:inbox:42',{initializedAt:1000,sequence:'1'});
 const row=(n)=>({id:`42:${n}`,sequence:String(n),actorId:'42',visibility:'private',text:`message ${n}`});
 const owner=createLifeOwner({config:{stateDir:dir,heybox:{dmPeers:['42']}},state,store,authorize:()=>{},now:()=>2000,onEvent:(e)=>{events.push(e);return store.append(e);},platforms:{heybox:{capabilities:{inbox:true},read:async({id,cursor}: { id?: any; cursor?: any; [key: string]: any })=>{if(!id)return{items:[],peers:[],warnings:[]};cursors.push(cursor);return cursor?{items:[row(2)],truncated:false,warnings:[]}:{items:[row(4),row(3)],cursor:'3',truncated:true,warnings:[]};}}}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});await owner.pollInteractions();
 assert.deepEqual(cursors,[undefined,'3']);assert.equal(events.length,3);assert.equal(state.get('life-inbox','heybox:inbox:42').sequence,'4');
});
test('an unavailable inbox cannot seed a baseline and replay old history after login',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inbox-baseline-')),store=createEventStore({stateDir:dir}),state=createHostState(store),events=[];let loggedIn=false;
 const owner=createLifeOwner({config:{stateDir:dir,heybox:{dmPeers:['42']}},state,store,authorize:()=>{},now:()=>2000,onEvent:(e)=>{events.push(e);return store.append(e);},platforms:{heybox:{capabilities:{inbox:true},read:async({id}: { id?: any; [key: string]: any })=>!id?{items:[],peers:['42'],warnings:[]}:loggedIn?{items:[{id:'old',sequence:'1',actorId:'42',visibility:'private',text:'old',at:500}],warnings:[]}:{items:[],warnings:['login_required']}}}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 await owner.pollInteractions();loggedIn=true;await owner.pollInteractions();assert.equal(events.length,0);assert.equal(state.get('life-inbox','heybox:inbox:42').sequence,'1');
});
test('Heybox discovers peers and uses per-peer sequence baselines while excluding own messages',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'heybox-inbox-')),store=createEventStore({stateDir:dir}),state=createHostState(store),events=[],reads=[];let seq='1';
 const owner=createLifeOwner({config:{stateDir:dir},state,store,authorize:()=>{},now:()=>1000,onEvent:(e)=>{events.push(e);return store.append(e);},platforms:{heybox:{capabilities:{inbox:true},read:async({id}: { id?: any; [key: string]: any })=>{reads.push(id||'discover');return id?{items:[{id:`42:${seq}`,sequence:seq,actorId:'42',visibility:'private',text:'incoming'},{id:`self:${seq}`,sequence:seq,actorId:'99',visibility:'private',text:'own',fromSelf:true}],warnings:[]}:{items:[],peers:['42'],warnings:[]};}}}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 state.put('health','life-inbox:heybox:discovery',{state:'error',at:1});
 await owner.pollInteractions();assert.deepEqual(reads,['discover','42']);assert.equal(events.length,0);assert.deepEqual(state.get('life-discovered-peers','heybox')?.peers,['42']);assert.equal(state.get('health','life-inbox:heybox:discovery').state,'ready');assert.equal(state.get('health','life-inbox:heybox:discovery').at,1000);
 seq='2';await owner.pollInteractions();assert.equal(events.length,1);assert.equal(events[0].channel,'heybox:dm:42');
});
test('incomplete Heybox discovery stays partial and a failed read stays error',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'heybox-discovery-health-')),store=createEventStore({stateDir:dir}),state=createHostState(store);let failed=false;
 const owner=createLifeOwner({config:{stateDir:dir},state,store,authorize:()=>{},now:()=>2000,platforms:{heybox:{capabilities:{inbox:true},read:async()=>failed?{items:[],warnings:['read_failed']}:{items:[],peers:[],truncated:true,warnings:[]}}}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});await owner.pollInteractions();assert.equal(state.get('health','life-inbox:heybox:discovery')?.state,'partial');failed=true;await owner.pollInteractions();assert.equal(state.get('health','life-inbox:heybox:discovery')?.state,'error');
});
test('platform inbox and notifications baseline history then route new messages to precise native source threads',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-inbox-')),store=createEventStore({stateDir:dir}),state=createHostState(store),events=[];
 let generation=0;
 const platform={capabilities:{inbox:true,notifications:true},status:async()=>({state:'ready'}),read:async({action}: { action?: any; [key: string]: any })=>({items:[{id:`${action}-${generation}`,actorId:'42',text:'fixture',at:1000+generation,visibility:action==='inbox'?'private':'public',kind:'message',targetId:'123',parentId:'456',context:{conversationId:'0:1:42:99',secUid:'MS4wTestUserLong'}}],warnings:[],truncated:false})};
 const owner=createLifeOwner({config:{stateDir:dir},state,store,platforms:{douyin:platform},authorize:()=>{},now:()=>1000,onEvent:(e)=>{events.push(e);return store.append(e);}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 assert.equal(typeof owner.pollInteractions,'function');await owner.pollInteractions();assert.equal(events.length,0);
 generation=1;await owner.pollInteractions();await owner.pollInteractions();assert.equal(events.length,2);
 const dm=events.find((e)=>e.channel==='douyin:dm:42');assert.equal(dm.meta.sourceTargetId,'42');assert.equal(dm.meta.platformContext.conversationId,'0:1:42:99');
 const notice=events.find((e)=>e.channel==='douyin:public');assert.equal(notice.meta.sourceTargetId,'123');assert.equal(notice.meta.parentId,'456');assert.equal(notice.meta.addressed,true);
});
