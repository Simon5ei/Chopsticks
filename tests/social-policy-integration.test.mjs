import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../core/events.mjs';
import {createHostState} from '../host/state.mjs';
import {createSocialPolicy} from '../host/social-policy.mjs';
import {createBiliService} from '../bili/mcp/service.mjs';
import {createLifeOwner} from '../life/owner.mjs';
import {createRuntime} from '../host/runtime.mjs';

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'social-integration-'));
 const store=createEventStore({stateDir:dir}),state=createHostState(store),now=()=>Date.parse('2026-11-07T04:00:00Z');
 const policy=createSocialPolicy({store,now,scope:'platform'});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,store,state,now,policy};
}
const comment={bvid:'BV1xx411c7mD',oid:'99',message:'fixture comment',mode:'go'};
const caller={sessionId:'fixture-session',requestId:'fixture-request',eventId:'fixture-source',role:'bili',canWrite:true};
function seed(policy,count,platform='bili',action='comment'){for(let i=0;i<count;i++)policy.reserve({platform,action,intentId:`seed:${platform}:${action}:${i}`});}
function bili(f,runner){return createBiliService({fishHome:f.dir,socialPolicy:f.policy,runner});}
const confirmedRunner=async(_script,_args,{env})=>{fs.writeFileSync(env.CHOPSTICKS_BILI_RECEIPT,JSON.stringify({status:'confirmed',kind:'comment',id:'123',url:'https://www.bilibili.com/video/BV1xx411c7mD/#reply123'}));return {code:0,stdout:'ok'};};

test('Bili actual comments share the content budget and dry previews do not consume it',async t=>{
 const f=fixture(t);seed(f.policy,9);let actual=0;
 const service=bili(f,async(...a)=>{if(a[1].includes('--go')){actual++;return confirmedRunner(...a);}return {code:0,stdout:'preview'};});
 assert.equal((await service.call('bili_comment',{...comment,mode:'dry'},caller)).isError,undefined);
 assert.equal((await service.call('bili_comment',comment,caller)).isError,undefined);
 const denied=await service.call('bili_comment',{...comment,message:'another comment'},{...caller,requestId:'request2'});
 assert.equal(denied.isError,true);assert.equal(actual,1);assert.equal(denied.structuredContent?.deliveryState,'not_sent');
});

test('ambiguous Bili runner outcomes retain the last slot and stable canonical intent forbids replay',async t=>{
 const f=fixture(t);seed(f.policy,8);let calls=0;
 const service=bili(f,async()=>{calls++;throw Error('transport interrupted');});
 assert.equal((await service.call('bili_comment',comment,caller)).isError,true);
 assert.equal((await service.call('bili_comment',{...comment,bvid:'https://www.bilibili.com/video/BV1xx411c7mD/'},caller)).isError,true);
 assert.equal(calls,1);
 assert.equal((await service.call('bili_comment',{...comment,message:'another intentional reply'},{...caller,requestId:'different'})).isError,true);
 assert.equal(calls,2);
 assert.equal((await service.call('bili_comment',{...comment,message:'third reply'},{...caller,requestId:'third'})).isError,true);
 assert.equal(calls,2);
});

test('Bili service with policy rejects unbounded trusted identity before invoking runner',async t=>{
 const f=fixture(t);let calls=0;const service=bili(f,async(...args)=>{calls++;return confirmedRunner(...args);});
 assert.equal((await service.call('bili_comment',comment,{...caller,requestId:'x'.repeat(257)})).isError,true);assert.equal(calls,0);
});

function owner(f,t,write){
 const binding={platform:'heybox',scope:'public',channel:'heybox:public',eventId:'source',requestId:'request',targetId:'item'};
 const value=createLifeOwner({config:{stateDir:f.dir},state:f.state,store:f.store,socialPolicy:f.policy,now:f.now,authorize:()=>binding,platforms:{heybox:{capabilities:{comment:true,reply:true,like:true},write}}});
 t.after(()=>value.close());
 const send=(text,action='comment')=>value.handle({platform:'heybox',operation:'write',args:{ticket:'ticket',action,targetId:'item',text,intentId:text}});
 return {value,send};
}

test('life owner blocks the next actual write at shared hourly capacity without spending daily capacity',async t=>{
 const f=fixture(t);seed(f.policy,9,'heybox');let calls=0;
 const o=owner(f,t,async a=>{calls++;return {confirmed:true,platformId:String(calls),targetId:a.targetId,visibility:'public'};});
 await o.send('one','reply');await assert.rejects(o.send('two'));
 assert.equal(calls,1);assert.equal(f.state.get('life-quota','heybox:2026-11-07:comments').count,1);
});

test('life owner releases only explicitly not-sent refusal and retains ambiguous refusals',async t=>{
 const f=fixture(t);seed(f.policy,9,'heybox');let calls=0;
 const o=owner(f,t,async()=>{calls++;return calls===1?{confirmed:false,state:'refused',deliveryState:'not_sent'}:{confirmed:false,state:'refused'};});
 assert.equal((await o.send('proved refusal')).confirmed,false);
 assert.equal((await o.send('ambiguous refusal')).confirmed,false);
 await assert.rejects(o.send('third'));assert.equal(calls,2);
});

test('life likes do not consume comment slots',async t=>{
 const f=fixture(t);seed(f.policy,10,'heybox');const o=owner(f,t,async a=>({confirmed:true,platformId:'like',targetId:a.targetId,visibility:'public'}));
 assert.equal((await o.send('like','like')).confirmed,true);
});

async function dmRuntime(t,{uncertain=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'social-dm-integration-'));let calls=0;
 const now=()=>Date.parse('2026-11-07T04:00:00Z');
 const runtime=await createRuntime({config:{stateDir:path.join(dir,'state'),fishHome:dir,evolution:{enabled:false},qq:{enabled:false},bili:{enabled:true,allowWrite:true}},controller:{inspect:async()=>{},cancel:async()=>{}},adapterFactory:()=>({close(){}}),socialFactory:()=>({close(){},async sendDM({beforeSend}){await beforeSend();calls++;if(uncertain)throw Error('network outcome unknown');return {status:'confirmed',kind:'dm',id:String(100+calls)};}}),now});
 t.after(async()=>{await runtime.close();fs.rmSync(dir,{recursive:true,force:true});});
 const policy=createSocialPolicy({store:runtime.store,now,scope:'platform'});
 const send=id=>{runtime.store.append({id,kind:'message.received',channel:'bili:dm:42',actorId:'42',text:'fixture source',meta:{bili:{kind:'dm',peerId:'42',msgKey:id}}});runtime.state.bind('dm-session',{eventId:id,requestId:`request:${id}`,actorId:'42',channel:'bili:dm:42',role:'bili-dm',consumed:true,revision:runtime.store.context({channel:'bili:dm:42'}).revision});return runtime.replyBiliDM('dm-session',{text:'fixture reply'});};
 return {runtime,policy,send,get calls(){return calls;}};
}

test('Bili DM final beforeSend gate respects existing ledger without spending daily budget',async t=>{
 const f=await dmRuntime(t);seed(f.policy,30,'bili','dm');
 await assert.rejects(f.send('exhausted'));assert.equal(f.calls,0);
 assert.equal(f.runtime.state.get('bili-dm-quota','2026-11-07'),undefined);
 assert.equal(f.runtime.store.db.prepare('SELECT state FROM host_sends WHERE id=?').get('bili-dm-reply:exhausted').state,'not_sent');
});

test('Bili DM unknown outcome consumes its slot and cannot fall back to another source',async t=>{
 const f=await dmRuntime(t,{uncertain:true});seed(f.policy,29,'bili','dm');
 await assert.rejects(f.send('unknown'));await assert.rejects(f.send('next'));assert.equal(f.calls,1);
});
