import test from 'node:test';
import assert from 'node:assert/strict';
let createNativeDesktopSource;
try {({createNativeDesktopSource}=await import('../src/host/desktop-source.mjs'));} catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const start={type:'turn/start',data:{turn:1}};
const message=(rpcId?: any,principal?: any)=>({type:'user/message',data:{source:{kind:'user',rpcId,...principal?{principal}:{}}}});
function fixture(){assert.equal(typeof createNativeDesktopSource,'function');const released=[];const source=createNativeDesktopSource({eligible:(id)=>id==='fish',knownRequest:(id)=>id==='scheduled',release:(c)=>released.push(c.requestId)});return {source,released};}
test('only a live consumed trusted native input supplies desktop context',()=>{
 const {source}=fixture();source.event('fish',message('direct'));assert.equal(source.caller('fish'),undefined);
 source.event('fish',start);assert.equal(source.caller('fish'),undefined);
 source.event('fish',message('direct'));assert.deepEqual(source.caller('fish'),{sessionId:'fish',requestId:'direct',consumed:true});
 source.event('fish',{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});assert.equal(source.caller('fish'),undefined);
 source.event('fish',message('replayed'));assert.equal(source.caller('fish'),undefined);
});
test('scheduled inputs, non-owner remote principals, and other sessions do not get a native override',()=>{
 for(const [id,ev] of [['fish',message('scheduled')],['fish',message('direct',{kind:'agent',id:'remote'})],['worker',message('direct')],['fish',message('')],['fish',{type:'user/message',data:{source:{kind:'system',rpcId:'fake'}}}]]){
  const {source}=fixture();source.event(id,start);source.event(id,ev);assert.equal(source.caller(id),undefined);
 }
});
test('new input releases previous lease and termination/close clear all grants',()=>{
 const {source,released}=fixture();source.event('fish',start);source.event('fish',message('a'));source.event('fish',message('b'));assert.deepEqual(released,['a']);
 source.event('fish',{type:'turn/end',data:{turn:0}});assert.equal(source.caller('fish').requestId,'b');
 source.event('fish',{type:'turn/start',data:{turn:2}});assert.equal(source.caller('fish'),undefined);assert.deepEqual(released,['a','b']);
 source.event('fish',message('c'));source.close();assert.equal(source.caller('fish'),undefined);assert.deepEqual(released,['a','b','c']);
});
test('SDK supplemental runtime context preserves the consumed user grant; a new untrusted user revokes it',()=>{
 const {source,released}=fixture();source.event('fish',start);source.event('fish',message('direct'));
 source.event('fish',{type:'user/message',data:{source:{kind:'runtime-context'},content:[]}});
 assert.equal(source.caller('fish')?.requestId,'direct');assert.deepEqual(released,[]);
 source.event('fish',message('remote',{kind:'agent',id:'other'}));assert.equal(source.caller('fish'),undefined);assert.deepEqual(released,['direct']);
});

test('explicitly designated debug session receives only live native desktop context',()=>{
 const designated='session-11111111-2222-4333-8444-555555555555',released=[];
 const source=createNativeDesktopSource({eligible:()=>false,operatorSessionId:designated,knownRequest:(id)=>id==='scheduled',release:(c)=>released.push(c.requestId)});
 source.event(designated,message('early'));assert.equal(source.caller(designated),undefined);
 source.event(designated,start);source.event(designated,message('owner'));
 assert.deepEqual(source.caller(designated),{sessionId:designated,requestId:'owner',consumed:true});
 const other='session-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';source.event(other,start);source.event(other,message('owner'));assert.equal(source.caller(other),undefined);
 source.event(designated,message('remote',{kind:'agent',id:'other'}));assert.equal(source.caller(designated),undefined);
 source.event(designated,message('scheduled'));assert.equal(source.caller(designated),undefined);
 source.event(designated,message('next'));source.event(designated,{type:'turn/end',data:{turn:1}});assert.equal(source.caller(designated),undefined);
 assert.deepEqual(released,['owner','next']);
});

test('malformed debug session configuration cannot expand native eligibility',()=>{
 for(const operatorSessionId of ['',true,{},'session-*','fish']){
  const source=createNativeDesktopSource({eligible:()=>false,operatorSessionId,knownRequest:()=>false,release:()=>{}});
  source.event(operatorSessionId,start);source.event(operatorSessionId,message('owner'));assert.equal(source.caller(operatorSessionId),undefined);
 }
});

