import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLifeOwner} from '../src/life/owner.mjs';
import {createEventStore} from '../src/core/events.mjs';
import {createHostState} from '../src/host/state.mjs';
import {buildLiveSourceManifest} from '../src/life/live-platforms.mjs';
function directFixture(t?: any,{receipt,platform='douyin'}: { receipt?: any; platform?: string; [key: string]: any }={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-direct-')),store=createEventStore({stateDir:dir}),state=createHostState(store),calls=[],events=[],reservations=[];
 const owner=createLifeOwner({config:{stateDir:dir},state,store,authorize:()=>{throw Error('No fabricated inbound ticket');},platforms:{[platform]:{capabilities:{dm:true},write:async (args?: any) =>{calls.push(args);return receipt??{confirmed:true,platformId:'444444444',targetId:args.targetId,kind:'dm'};}}},socialPolicy:{reserve:(args)=>{reservations.push(args);return args;},settle(){},release(){}},onEvent:(e)=>{events.push(e);return store.append(e);}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const args=platform==='heybox'?{accountId:'42',targetId:'9',text:'hello',intentId:'admin-test-1'}:{accountId:'111111111',targetId:'222222222',secUid:'MS4wLjABAAAAfixture',conversationId:'0:1:111111111:222222222',text:'hello',intentId:'admin-test-1'};
 return {owner,state,store,calls,events,reservations,args,run:(changes: Record<string, any>={},operator: boolean=true)=>owner.handle({platform,operation:'direct_message',args:{...args,...changes}},{operator})};
}
test('operator Heybox DM binds account and peer through the same journal and quota',async (t?: any) =>{
 const f=directFixture(t,{platform:'heybox'});await assert.rejects(f.run({},false));await assert.rejects(f.run({secUid:'arbitrary'}));assert.equal((await f.run()).confirmed,true);assert.equal(f.calls[0].context.accountId,'42');assert.equal(f.calls[0].context.sourceActor,'9');assert.equal(f.events[0].channel,'heybox:dm:9');assert.equal(f.reservations[0].platform,'heybox');await f.run();assert.equal(f.calls.length,1);await assert.rejects(f.run({text:'changed'}));
});
test('operator Heybox DM cannot resend an unknown effect by changing its label',async (t?: any) =>{
 const f=directFixture(t,{platform:'heybox',receipt:{confirmed:false,state:'unknown',code:'verification_required'}});await assert.rejects(f.run());await assert.rejects(f.run({intentId:'new-label'}));assert.equal(f.calls.length,1);assert.equal(f.events.length,0);
});
test('operator DM uses the existing adapter, quota and canonical confirmed journal without an inbound ticket',async (t?: any) =>{
 const f=directFixture(t);const result: any=await f.run();assert.equal(result.confirmed,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].context.accountId,f.args.accountId);assert.equal(f.calls[0].context.secUid,f.args.secUid);assert.equal(f.calls[0].context.conversationId,f.args.conversationId);assert.equal(f.events[0].channel,'douyin:dm:222222222');assert.ok(f.events[0].meta.operatorCommandId);assert.equal(f.events[0].meta.sourceEventId,undefined);assert.equal(f.reservations[0].action,'dm');assert.equal(f.state.list('life-quota')[0].count,1);
 assert.deepEqual(await f.run(),result);assert.equal(f.calls.length,1);assert.equal(f.events.length,1);
});
test('operator DM rejects non-operators, changed command payloads and arbitrary context',async (t?: any) =>{
 const f=directFixture(t);await assert.rejects(f.run({},false));for(const bad of [{ticket:'t'},{context:{}},{accountId:'bad'},{targetId:f.args.accountId},{conversationId:'0:1:111111111:333333333'},{text:'x'.repeat(1001)}])await assert.rejects(f.run(bad));assert.equal(f.calls.length,0);await f.run();await assert.rejects(f.run({text:'changed'}));await assert.rejects(f.run({targetId:'333333333',conversationId:'0:1:111111111:333333333'}));assert.equal(f.calls.length,1);
});
test('operator DM retains uncertain outcomes and cannot replay with a changed intent label',async (t?: any) =>{
 const f=directFixture(t,{receipt:{confirmed:false,state:'uncertain',code:'UNVERIFIED_RECEIPT'}});await assert.rejects(f.run());await assert.rejects(f.run());await assert.rejects(f.run({intentId:'admin-test-2'}));assert.equal(f.calls.length,1);assert.equal(f.events.length,0);
});
function fixture(t?: any,{read,write,scope='public',time=Date.parse('2026-11-05T01:00:00Z')}: { read?: any; write?: any; scope?: string; time?: any; [key: string]: any }={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-owner-'));const store=createEventStore({stateDir:dir});const state=createHostState(store);let calls=0;const events=[];
 const platform={platform:'heybox',capabilities:{feed:true,detail:true,like:true,comment:true,publish:true},status:async()=>({state:'ready',capabilities:{feed:true,detail:true,like:true,comment:true,publish:true}}),read:read|| (async()=>({items:[{id:'a',text:'hello',kind:'post',visibility:'public'}],truncated:false,warnings:[]})),write:async (a?: any) =>{calls++;return write?write(a):{confirmed:true,platformId:'receipt',targetId:a.targetId,kind:a.action,visibility:'public'};},close:async()=>{}};
 const binding={platform:'heybox',scope,channel:scope==='public'?'heybox:public':'qzone:friends',eventId:'source',requestId:'request',targetId:'a'};
 const owner=createLifeOwner({config:{stateDir:dir,heybox:{enabled:true}},state,store,platforms:{heybox:platform},authorize:()=>binding,onEvent:(e)=>{events.push(e);return store.append(e);},now:()=>time});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {owner,events,state,store,get calls(){return calls;},binding,advance(ms?: any){time+=ms;}};
}
test('detail records one stable experienced source while feeds do not',async (t?: any) =>{const f=fixture(t);const req=(action?: any)=>f.owner.handle({platform:'heybox',operation:'read',args:{ticket:'ticket',action,id:'a'}});await req('feed');assert.equal(f.events.length,0);const a: any=await req('detail');const b: any=await req('detail');assert.equal(a.sourceEventId,b.sourceEventId);assert.equal(f.events[0].meta.experienced,true);assert.equal(f.events[0].channel,'heybox:public');});

test('detail URL resolves only the canonical source target and rejects conflicting ID or host',async (t?: any) =>{
 let seen;const f=fixture(t,{read:async (args?: any) =>{seen=args;return {items:[{id:'12345',text:'content',visibility:'public'}],warnings:[]};}});f.binding.targetId='12345';
 await f.owner.handle({platform:'heybox',operation:'read',args:{ticket:'t',action:'detail',url:'https://www.xiaoheihe.cn/app/bbs/link/12345'}});assert.equal(seen.id,'12345');
 for(const url of ['https://www.xiaoheihe.cn/app/bbs/link/67890','https://attacker.invalid/app/bbs/link/12345'])await assert.rejects(f.owner.handle({platform:'heybox',operation:'read',args:{ticket:'t',action:'detail',id:'12345',url}}));
});

test('actual operation failure is available to watchdog without private content',async (t?: any) =>{
 const f=fixture(t,{read:async()=>({items:[],truncated:true,warnings:['verification_required']})});await f.owner.handle({platform:'heybox',operation:'read',args:{ticket:'t',action:'detail',id:'a'}});
 assert.equal(f.state.get('health','life-operation:heybox:detail').state,'verification_required');
});

test('unknown write retains safe accepted ID and operation health without enabling replay',async (t?: any) =>{
 const f=fixture(t,{write:()=>({confirmed:false,state:'unknown',code:'readback_verification_required',receiptId:'222'})});
 const req={platform:'heybox',operation:'write',args:{ticket:'ticket',action:'comment',targetId:'a',text:'hello',intentId:'uncertain-id'}};
 await assert.rejects(f.owner.handle(req));await assert.rejects(f.owner.handle(req));assert.equal(f.calls,1);
 const health=f.state.get('health','life-operation:heybox:comment');assert.equal(health.state,'verification_required');assert.equal(health.receiptId,'222');
 const row=f.store.db.prepare('SELECT state,value FROM host_sends').get();assert.equal(row.state,'uncertain');assert.equal(JSON.parse(row.value as string).receiptId,'222');
});

test('thrown read transport errors update watchdog operation health without leaking messages',async (t?: any) =>{
 const f=fixture(t,{read:async()=>{throw Error('private cookie=secret');}});
 await assert.rejects(f.owner.handle({platform:'heybox',operation:'read',args:{ticket:'ticket',action:'detail',id:'a'}}));
 const health=f.state.get('health','life-operation:heybox:detail');assert.equal(health?.state,'unknown');assert.ok(!JSON.stringify(health).includes('secret'));
});

test('owner routes fixed live preparation only from operator context and requires source manifest',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-live-owner-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let writes=0,auths=0;const adapter={capabilities:{publish:true,feed:true,detail:true},status:async()=>({state:'ready',accountId:'123'}),read:async()=>({items:[],warnings:[]}),write:async()=>{writes++;}};
 const owner=createLifeOwner({config:{stateDir:dir},state:{put(){}},store:{},authorize:()=>{auths++;},platforms:{heybox:adapter}});t.after(()=>owner.close());
 const manifest=await buildLiveSourceManifest();fs.writeFileSync(path.join(dir,'life','source-revision.json'),JSON.stringify(manifest));
 const req={platform:'heybox',operation:'live_test',args:{mode:'prepare',revision:manifest.revision}};
 await assert.rejects(owner.handle(req));assert.equal((await owner.handle(req,{operator:true})).state,'prepared');
 await assert.rejects(owner.handle({...req,args:{...req.args,platform:'qzone'}},{operator:true}));assert.equal(writes,0);assert.equal(auths,0);
});

test('owner diagnostics admits only fixed Douyin publisher controls for operators',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-publisher-diagnostics-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let calls=0;
 const owner=createLifeOwner({config:{stateDir:dir},state:{},store:{},authorize:()=>{throw Error('not an actor operation');},platforms:{douyin:{diagnostics:async()=>{calls++;return {state:'observed'};}}}});t.after(()=>owner.close());
 const req={platform:'douyin',operation:'diagnostics',args:{action:'publish_controls'}};
 await assert.rejects(owner.handle(req));await assert.rejects(owner.handle({...req,args:{...req.args,url:'https://other.invalid'}},{operator:true}));
 assert.equal((await owner.handle(req,{operator:true})).state,'observed');assert.equal(calls,1);
});
test('private items are never returned to a public caller',async (t?: any) =>{const f=fixture(t,{read:async()=>({items:[{id:'secret',text:'secret',kind:'post',visibility:'friends'}],truncated:false,warnings:[]})});const result: any=await f.owner.handle({platform:'heybox',operation:'read',args:{ticket:'ticket',action:'detail',id:'a'}});assert.equal(result.items.length,0);assert.equal(f.events.length,0);});
test('uncertain writes are persisted and cannot be resent',async (t?: any) =>{const f=fixture(t,{write:()=>({confirmed:false,state:'uncertain',code:'TIMEOUT'})});const req={platform:'heybox',operation:'write',args:{ticket:'ticket',action:'comment',targetId:'a',text:'hi',intentId:'1'}};await assert.rejects(f.owner.handle(req));await assert.rejects(f.owner.handle(req));assert.equal(f.calls,1);});
test('poll emits distinct bounded proposals once and never marks them experienced',async (t?: any) =>{const f=fixture(t);await f.owner.poll();await f.owner.poll();assert.equal(f.events.length,1);assert.equal(f.events[0].kind,'timer');assert.notEqual(f.events[0].meta.experienced,true);});

test('missing receipts are uncertain and never retried',async (t?: any) =>{const f=fixture(t,{write:()=>({confirmed:true,targetId:'a'})});const req={platform:'heybox',operation:'write',args:{ticket:'ticket',action:'comment',targetId:'a',text:'hi',intentId:'missing'}};await assert.rejects(f.owner.handle(req));await assert.rejects(f.owner.handle(req));assert.equal(f.calls,1);});
test('daily comment quota applies to distinct intents',async (t?: any) =>{const f=fixture(t);for(let i=0;i<8;i++)await f.owner.handle({platform:'heybox',operation:'write',args:{ticket:'ticket',action:'comment',targetId:'a',text:`hello ${i}`,intentId:String(i)}});await assert.rejects(f.owner.handle({platform:'heybox',operation:'write',args:{ticket:'ticket',action:'comment',targetId:'a',text:'hello',intentId:'9'}}));assert.equal(f.calls,8);});
test('detail is restricted to its trusted source target',async (t?: any) =>{const f=fixture(t);await assert.rejects(f.owner.handle({platform:'heybox',operation:'read',args:{ticket:'ticket',action:'detail',id:'other'}}));});
test('proposal dedup persists across later opportunities',async (t?: any) =>{const f=fixture(t);await f.owner.poll();f.advance(21*60*1000);await f.owner.poll();assert.equal(f.events.length,1);});
test('detail refuses an adapter result for a different item',async (t?: any) =>{const f=fixture(t,{read:async()=>({items:[{id:'other',text:'wrong',kind:'post',visibility:'public'}],truncated:false,warnings:[]})});const result: any=await f.owner.handle({platform:'heybox',operation:'read',args:{ticket:'ticket',action:'detail',id:'a'}});assert.equal(result.items.length,0);assert.equal(f.events.length,0);});
function qzoneFixture(t?: any,{scope='qzone:friends',receipt,allowedOwnTarget='own-friends',validation=false,validationPlatforms=[]}: { scope?: string; receipt?: any; allowedOwnTarget?: string; validation?: boolean; validationPlatforms?: any[]; [key: string]: any }={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-owner-qzone-'));const store=createEventStore({stateDir:dir});const state=createHostState(store);const events=[];let calls=0;
 const platform={platform:'qzone',capabilities:{publish:true},status:async()=>({state:'ready',capabilities:{publish:true}}),write:async()=>{calls++;return receipt??{confirmed:true,platformId:'post-id',targetId:'post-id',kind:'publish',visibility:'friends'};},close:async()=>{}};
 const binding={platform:'qzone',scope,channel:scope==='qzone:friends'?'qzone:friends':'qzone:public',eventId:'source',requestId:'request',targetId:'source-item',allowedOwnTarget};
 const owner=createLifeOwner({config:{stateDir:dir,validation},state,store,platforms:{qzone:platform},validationPlatforms,authorize:(_?: any,request?: any)=>{if(request.targetId!=='own-friends')throw Error('denied');return binding;},onEvent:(e)=>{events.push(e);return store.append(e);}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {owner,events,state,store,get calls(){return calls;}};
}
test('qzone own-friends publish is confirmed only in friends scope',async (t?: any) =>{const f=qzoneFixture(t);const r: any=await f.owner.handle({platform:'qzone',operation:'write',args:{ticket:'t',action:'publish',targetId:'own-friends',visibility:'friends',intentId:'p',text:'hello'}});assert.equal(r.confirmed,true);assert.equal(f.events[0].kind,'message.sent');assert.equal(f.events[0].channel,'qzone:friends');});
test('qzone publishing refuses public visibility and wrong targets',async (t?: any) =>{const f=qzoneFixture(t);for(const args of [{targetId:'own-friends',visibility:'public'},{targetId:'own-public',visibility:'friends'},{targetId:'source-item',visibility:'friends'}])await assert.rejects(f.owner.handle({platform:'qzone',operation:'write',args:{ticket:'t',action:'publish',intentId:'p',text:'hello',...args}}));assert.equal(f.calls,0);});
test('qzone publication with non-friends receipt is uncertain',async (t?: any) =>{const f=qzoneFixture(t,{receipt:{confirmed:true,platformId:'p',targetId:'p',visibility:'public'}});const req={platform:'qzone',operation:'write',args:{ticket:'t',action:'publish',targetId:'own-friends',intentId:'p',text:'hello'}};await assert.rejects(f.owner.handle(req));await assert.rejects(f.owner.handle(req));assert.equal(f.calls,1);});


test('qzone publication requires explicit own target grant',async (t?: any) =>{const f=qzoneFixture(t,{allowedOwnTarget:'none'});await assert.rejects(f.owner.handle({platform:'qzone',operation:'write',args:{ticket:'t',action:'publish',targetId:'own-friends',intentId:'p',text:'hello'}}));assert.equal(f.calls,0);});
test('qzone publication refuses a mismatched ticket scope',async (t?: any) =>{const f=qzoneFixture(t,{scope:'public'});await assert.rejects(f.owner.handle({platform:'qzone',operation:'write',args:{ticket:'t',action:'publish',targetId:'own-friends',intentId:'p',text:'hello'}}));assert.equal(f.calls,0);});
function hostFixture(t?: any,{journal='valid'}: { journal?: string; [key: string]: any }={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-host-'));const store=createEventStore({stateDir:dir});const state=createHostState(store);const events=[],contexts=[];
 const binding={platform:'qq',scope:'private:qq',channel:'p:42',eventId:'source',requestId:'req',targetId:'42'};
 const adapter={platform:'qq',capabilities:{dm:true,inbox:true},read:async (a?: any) =>{contexts.push(a.context);return {items:[],truncated:false,warnings:[]};},write:async (a?: any) =>{contexts.push(a.context);const id=`sent-${a.intentId}`;store.append({id,kind:journal==='wrong-kind'?'task.result':'message.sent',channel:journal==='wrong-channel'?'p:43':'p:42',actorId:'fish',text:'hi',meta:{messageId:journal==='wrong-id'?'wrong':id}});return {confirmed:true,platformId:id,targetId:'42',kind:'dm',journaledEventId:id};},close:async()=>{}};
 const owner=createLifeOwner({config:{stateDir:dir},state,store,platforms:{qq:adapter},authorize:()=>binding,onEvent:(e)=>{events.push(e);return store.append(e);}});t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {owner,events,contexts,binding};
}
test('host adapters receive trusted binding and reuse canonical receipts without life quotas',async (t?: any) =>{const f=hostFixture(t);await f.owner.handle({platform:'qq',operation:'read',args:{ticket:'ticket',action:'inbox',context:{channel:'p:99'}}});for(let i=0;i<9;i++){const r: any=await f.owner.handle({platform:'qq',operation:'write',args:{ticket:'ticket',action:'dm',targetId:'42',text:`hi ${i}`,intentId:String(i),context:{channel:'p:99'}}});assert.equal(r.journaledEventId,`sent-${i}`);}assert.equal(f.events.length,0);assert.equal(f.contexts.length,10);for(const c of f.contexts)assert.equal(c,f.binding);});
test('host receipts with a mismatched canonical event are rejected and not replayed',async (t?: any) =>{for(const journal of ['wrong-kind','wrong-channel','wrong-id']){const f=hostFixture(t,{journal});const req={platform:'qq',operation:'write',args:{ticket:'ticket',action:'dm',targetId:'42',text:'hi',intentId:'x'}};await assert.rejects(f.owner.handle(req));await assert.rejects(f.owner.handle(req));assert.equal(f.events.length,0);}});
test('operator login start does not invoke login when verification is required or already ready',async (t?: any) =>{for(const status of ['verification_required','ready']){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-gate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let calls=0;const platform={platform:'douyin',capabilities:{},status:async()=>({state:status,capabilities:{}}),login:async()=>{calls++;return {state:'login_required'};},close:async()=>{}};const owner=createLifeOwner({config:{stateDir:dir},state:{},store:{},authorize:()=>{},platforms:{douyin:platform}});t.after(()=>owner.close());assert.deepEqual(await owner.handle({platform:'douyin',operation:'login',args:{action:'start'}},{operator:true}),{state:status});assert.equal(calls,0);}});
test('operator login poll uses the existing session without a status check',async (t?: any) =>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-gate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let statusCalls=0,loginCalls=0;const platform={status:async()=>{statusCalls++;return {state:'verification_required'};},login:async (a?: any) =>{loginCalls++;assert.equal(a.action,'poll');return {state:'login_required'};},close:async()=>{}};const owner=createLifeOwner({config:{stateDir:dir},state:{},store:{},authorize:()=>{},platforms:{douyin:platform}});t.after(()=>owner.close());assert.deepEqual(await owner.handle({platform:'douyin',operation:'login',args:{action:'poll'}},{operator:true}),{state:'login_required'});assert.equal(statusCalls,0);assert.equal(loginCalls,1);});
test('changing intent ID cannot replay an uncertain equivalent side effect',async (t?: any) =>{const f=fixture(t,{write:()=>({confirmed:false,state:'uncertain',code:'TIMEOUT'})});const args={ticket:'ticket',action:'comment',targetId:'a',text:'same',intentId:'first'};await assert.rejects(f.owner.handle({platform:'heybox',operation:'write',args}));await assert.rejects(f.owner.handle({platform:'heybox',operation:'write',args:{...args,intentId:'second'}}));assert.equal(f.calls,1);});
test('equivalent confirmed write reuses receipt while a changed body or source can send',async (t?: any) =>{const f=fixture(t);const args={ticket:'ticket',action:'comment',targetId:'a',text:'same',intentId:'first'};const run=(a)=>f.owner.handle({platform:'heybox',operation:'write',args:a});const first=await run(args);const second=await run({...args,intentId:'second'});assert.deepEqual(second,first);assert.equal(f.calls,1);assert.equal(f.events.length,1);await run({...args,text:'different',intentId:'third'});f.binding.requestId='next-source';await run({...args,intentId:'fourth'});assert.equal(f.calls,3);});
test('empty or failed polls back off without consuming daily opportunity quota',async (t?: any) =>{let count=0;const f=fixture(t,{time:Date.parse('2026-11-05T12:00:00Z'),read:async()=>{count++;if(count%2)throw Error('offline');if(count<=4)return {items:[],truncated:false,warnings:[]};return {items:[{id:'later',text:'hello',kind:'post',visibility:'public'}],truncated:false,warnings:[]};}});await f.owner.poll();await f.owner.poll();assert.equal(count,1);for(let i=0;i<5;i++){f.advance(21*60*1000);await f.owner.poll();}assert.equal(count,6);assert.equal(f.events.length,1);});
test('validation mode disables uninjected platform writes before submission',async (t?: any) =>{const f=qzoneFixture(t,{validation:true});const r=await f.owner.handle({platform:'qzone',operation:'write',args:{ticket:'t',action:'publish',targetId:'own-friends',intentId:'p',text:'hello'}});assert.deepEqual(r,{confirmed:false,state:'refused',code:'VALIDATION_WRITES_DISABLED'});assert.equal(f.calls,0);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM host_sends').get().n,0);assert.deepEqual(f.state.list('life-quota'),[]);});
test('validation mode allows explicitly injected fake platform writes',async (t?: any) =>{const f=qzoneFixture(t,{validation:true,validationPlatforms:['qzone']});const r: any=await f.owner.handle({platform:'qzone',operation:'write',args:{ticket:'t',action:'publish',targetId:'own-friends',intentId:'p',text:'hello'}});assert.equal(r.confirmed,true);assert.equal(f.calls,1);});

test('aborted authorization does not submit a late write',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-abort-'));const store=createEventStore({stateDir:dir}),state=createHostState(store);let finishAuth,entered;const enteredP=new Promise<any | void>((r)=>entered=r);let writes=0;
 const adapter={capabilities:{comment:true},write:async()=>{writes++;return {confirmed:true,platformId:'id',targetId:'a'};},close:async()=>{}};
 const owner=createLifeOwner({config:{stateDir:dir},state,store,platforms:{heybox:adapter},authorize:()=>{entered();return new Promise<any | void>((r)=>finishAuth=r);}});t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const c=new AbortController();const pending=owner.handle({platform:'heybox',operation:'write',args:{ticket:'t',action:'comment',targetId:'a',text:'hi',intentId:'i'}},{signal:c.signal});await enteredP;c.abort();finishAuth({platform:'heybox',scope:'public',channel:'heybox:public',eventId:'e',targetId:'a'});await assert.rejects(pending);assert.equal(writes,0);
});

test('refunding a refused concurrent write preserves another confirmed reservation',async (t?: any) =>{
 let finishFirst,started;const entered=new Promise<any | void>((r)=>started=r);const f=fixture(t,{write:(a)=>a.text==='first'?(started(),new Promise<any | void>((r)=>finishFirst=r)):{confirmed:true,platformId:'second-receipt',targetId:'a',kind:'comment',visibility:'public'}});
 const run=(text?: any)=>f.owner.handle({platform:'heybox',operation:'write',args:{ticket:'t',action:'comment',targetId:'a',text,intentId:text}});
 const first=run('first');await entered;await run('second');finishFirst({confirmed:false,state:'refused',code:'NO'});await first;
 const quotas=f.state.list('life-quota');assert.equal(quotas.length,1);assert.equal(quotas[0].count,1);
});

test('cancellation after submission records uncertainty and never retries',async (t?: any) =>{
 let entered;const started=new Promise<any | void>((r)=>entered=r);let sawAbort=false;
 const f=fixture(t,{write:({signal}: { signal?: any; [key: string]: any })=>{entered();return new Promise<any | void>((resolve)=>signal.addEventListener('abort',()=>{sawAbort=true;resolve({confirmed:false,state:'uncertain',code:'CANCELLED_AFTER_SUBMIT'});},{once:true}));}});
 const req={platform:'heybox',operation:'write',args:{ticket:'t',action:'comment',targetId:'a',text:'cancelled',intentId:'i'}};const c=new AbortController();const first=f.owner.handle(req,{signal:c.signal});await started;c.abort();await assert.rejects(first);assert.equal(sawAbort,true);await assert.rejects(f.owner.handle(req));assert.equal(f.calls,1);
});

test('confirmed receipt after cancellation is still persisted and not resent',async (t?: any) =>{
 let entered,complete;const started=new Promise<any | void>((r)=>entered=r);const f=fixture(t,{write:()=>{entered();return new Promise<any | void>((r)=>complete=r);}});
 const req={platform:'heybox',operation:'write',args:{ticket:'t',action:'comment',targetId:'a',text:'late receipt',intentId:'i'}};const c=new AbortController();const first=f.owner.handle(req,{signal:c.signal});await started;c.abort();complete({confirmed:true,platformId:'stable-receipt',targetId:'a',kind:'comment',visibility:'public'});
 const receipt: any=await first;assert.equal(receipt.confirmed,true);const again=await f.owner.handle(req);assert.deepEqual(again,receipt);assert.equal(f.calls,1);assert.equal(f.events.length,1);
});
