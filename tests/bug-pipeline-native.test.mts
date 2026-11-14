import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createRuntime} from '../src/host/runtime.mjs';
import {apply as guard} from '../src/host/guard.mjs';
test('every managed preset can report a bug but cannot mark repairs completed',()=>{
 for(const mode of ['qq','bili','bili-dm','qzone','heybox','douyin','diary','evolution','router','worker','development']){
  let check;guard({tools:{view:()=>({visible:new Map()}),restrict:()=>()=>{},guard:fn=>check=fn},on(){},effect(){}},{mode});
  assert.equal(check({name:'chopsticks_bug_report'}),undefined,mode);
  assert.ok(check({name:'chopsticks_bug_result'}),mode);
 }
});
test('runtime wires native operator queue, watchdog input and persisted completion without external sends',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bug-native-')),fishHome=path.join(dir,'fish'),stateDir=path.join(dir,'state');
 fs.mkdirSync(path.join(fishHome,'characters','fish'),{recursive:true});fs.writeFileSync(path.join(fishHome,'characters','current.json'),JSON.stringify({id:'fish'}));
 const live=new Set(['debug']),prompts=[];
 const controller={async inspect(id){if(!live.has(id))throw Object.assign(Error('missing'),{code:'session/not-found'});return {sessionId:id};},async create(a){live.add(a.sessionId);return a;},async resolveAgent(){},async selectModel(){},async cancel(){},async prompt(p){prompts.push(p);return {accepted:true};}};
 const runtime=await createRuntime({config:{stateDir,fishHome,routing:{layered:true},qq:{enabled:false},bugPipeline:{enabled:true,sessionId:'debug'}},controller,adapterFactory:()=>({async start(){},async close(){}})});
 t.after(async()=>{await runtime.close();fs.rmSync(dir,{recursive:true,force:true});});
 runtime.state.put('health','life-operation:douyin:comment',{state:'unknown',code:'CONTROL_NOT_UNIQUE',at:Date.now()+1});await runtime.start();
 const bugs=runtime['bugs'];assert.ok(bugs,'runtime must wire the bug pipeline');const batch=bugs.current();assert.equal(batch.issues.length,1);
 assert.equal(prompts.filter(p=>p.sessionId==='debug').length,1);assert.throws(()=>bugs.result('debug',{issueId:batch.issues[0].id,status:'fixed',evidence:'unconsumed'}));
 runtime.event({id:'debug'},{type:'user/message',data:{source:{rpcId:batch.id}}});
 assert.equal(bugs.result('debug',{issueId:batch.issues[0].id,status:'blocked',evidence:'isolated fixture; no production sends'}).persisted,true);
 runtime.event({id:'debug'},{type:'turn/end'});assert.equal(bugs.current(),undefined);
});
