import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createEventStore} from '../src/core/events.mjs';
import {createRouter} from '../src/core/router.mjs';
const event=(id?: any,channel?: any)=>({id,channel,kind:'message.received',actorId:'1',text:id});
async function until(fn?: any){for(let i=0;i<300;i++){if(fn())return;await delay(5);}assert.fail('router did not finish');}
function setup(t?: any){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-layers-')),store=createEventStore({stateDir:dir,sharePlatformPrivate:true});let router;t.after(async()=>{await router?.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return{store,make:(options)=>router=createRouter({store,...options})};}
test('overall attention selects a domain and distinct domain assessors handle platform batches',async (t?: any) =>{
 const f=setup(t),seen=[],attention=[];
 f.store.append(event('a','p:1'));f.store.append(event('b','p:2'));f.store.append(event('v','bili:public'));
 const router=f.make({hierarchy:{select:async (input?: any) =>{attention.push(input);return{domain:'chat',reason:'incoming messages first'};}},assess:async({events,domain,route}: { events?: any; domain?: any; route?: any; [key: string]: any })=>{seen.push({ids:events.map((e)=>e.id),domain,key:route?.sessionKey});return{actions:events.map((e)=>({eventId:e.id,kind:'observe'}))};},dispatch:async()=>{}});
 await until(()=>router.status().counts.observed===3);
 assert.equal(attention.length,1);assert.equal(JSON.stringify(attention).includes('"text"'),false,'overall only gets domain metadata');
 assert.deepEqual(seen,[{ids:['a'],domain:'chat',key:'chat.qq.dm.1'},{ids:['b'],domain:'chat',key:'chat.qq.dm.2'},{ids:['v'],domain:'surf',key:'surf.bili'}]);
 assert.equal(router.status().layers.chat.counts.observed,2);assert.equal(router.status().layers.surf.counts.observed,1);
 assert.equal(router.status().layers.overall.decisions,1);
});
test('uncontended work avoids a redundant overall model turn and surf items each advance once',async (t?: any) =>{
 const f=setup(t),batches=[];let selections=0;
 f.store.append(event('v1','douyin:public'));f.store.append(event('v2','douyin:public'));
 const router=f.make({hierarchy:{select:async()=>{selections++;return{domain:'surf'};}},assess:async({events,domain}: { events?: any; domain?: any; [key: string]: any })=>{batches.push({ids:events.map((e)=>e.id),domain});return{actions:events.map((e)=>({eventId:e.id,kind:'observe'}))};},dispatch:async()=>{}});
 await until(()=>router.status().counts.observed===2);
 assert.equal(selections,0);assert.deepEqual(batches,[{ids:['v1'],domain:'surf'},{ids:['v2'],domain:'surf'}]);
});
test('domain selector chooses a platform without seeing event contents and caches a decided batch',async (t?: any) =>{const f=setup(t),seen=[],calls=[];f.store.append(event('old','bili:public'));f.store.append(event('new','heybox:public'));const router=f.make({hierarchy:{selectPlatform:async (input?: any) =>{calls.push(input);return{platform:'heybox',reason:'interest'};}},assess:async({events}: { events?: any; [key: string]: any })=>{seen.push(events[0].id);return{actions:events.map((e)=>({eventId:e.id,kind:'respond'}))};},dispatch:async()=>{}});await until(()=>router.status().counts.dispatched===2);assert.deepEqual(seen,['new','old']);assert.equal(calls.length,1);assert.equal(calls[0].domain,'surf');assert.deepEqual(calls[0].platforms.map((x)=>x.platform).sort(),['bili','heybox']);assert.equal(JSON.stringify(calls[0]).includes('new'),false);assert.equal(router.status().layers.surf.selections,1);assert.equal(router.status().layers.surf.lastSelection.platform,'heybox');assert.equal(router.status().layers.overall.decisions,0);});
test('invalid platform selection falls back to the oldest ready platform and IM contacts remain separate',async (t?: any) =>{const f=setup(t),seen=[];let calls=0;f.store.append(event('a','p:1'));f.store.append(event('b','p:2'));f.store.append(event('c','wechat:dm:3'));const router=f.make({hierarchy:{selectPlatform:async()=>{calls++;return{platform:'unknown'};}},assess:async({events}: { events?: any; [key: string]: any })=>{seen.push(events.map((e)=>e.id));return{actions:events.map((e)=>({eventId:e.id,kind:'observe'}))};},dispatch:async()=>{}});await until(()=>router.status().counts.observed===3);assert.deepEqual(seen,[['a'],['b'],['c']]);assert.equal(calls,1);assert.equal(router.status().layers.chat.lastSelection.platform,'qq');});
test('one ready platform requires no platform selection',async (t?: any) =>{const f=setup(t);let calls=0;f.store.append(event('a','p:1'));f.store.append(event('b','p:2'));const router=f.make({hierarchy:{selectPlatform:async()=>{calls++;}},assess:async({events}: { events?: any; [key: string]: any })=>({actions:events.map((e)=>({eventId:e.id,kind:'observe'}))}),dispatch:async()=>{}});await until(()=>router.status().counts.observed===2);assert.equal(calls,0);assert.equal(router.status().layers.chat.selections,0);});
test('Router persists explicit ticket attachment as a structured dispatch',async (t?: any) =>{
 const f=setup(t),calls=[];f.store.append(event('follow','p:1'));
 const router=f.make({assess:async()=>({actions:[{eventId:'follow',kind:'attach',ticketId:'ticket-123'}]}),dispatch:async (action?: any) =>calls.push(action)});
 await until(()=>router.status().counts.observed+router.status().counts.dispatched===1);
 assert.equal(calls.length,1);assert.equal(calls[0].kind,'attach');assert.equal(calls[0].ticketId,'ticket-123');
});
test('selector failure falls back to oldest and its selection survives reopening',async (t?: any) =>{const f=setup(t);f.store.append(event('older','bili:public'));f.store.append(event('newer','heybox:public'));const seen=[];const opts={hierarchy:{selectPlatform:async()=>{throw Error('provider failure');}},assess:async({events}: { events?: any; [key: string]: any })=>{seen.push(events[0].id);return{actions:events.map((e)=>({eventId:e.id,kind:'observe'}))}},dispatch:async()=>{}};let router=f.make(opts);await until(()=>router.status().counts.observed===2);assert.deepEqual(seen,['older','newer']);assert.equal(router.status().layers.surf.lastSelection.platform,'bili');await router.close();router=f.make(opts);assert.equal(router.status().layers.surf.selections,1);assert.equal(router.status().layers.surf.lastSelection.platform,'bili');});
