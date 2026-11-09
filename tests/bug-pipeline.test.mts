import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../src/core/events.mjs';
let module;try{module=await import('../src/host/'+'bug-pipeline.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
function fixture(t,options:any={}){
 assert.ok(module,'bug pipeline must exist');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bug-pipeline-')),store=createEventStore({stateDir:dir}),prompts=[];
 let busy=false,time=1000000;
 const opts={db:store.db,config:{enabled:true,sessionId:'debug',...options.config},now:()=>time,
  isIdle:async()=>!busy,inspect:async()=>({sessionId:'debug'}),
  prompt:async(p)=>{prompts.push(p);if(options.throwPrompt)throw Error('transport lost');return {accepted:true};},clean:(x)=>x.replaceAll('SECRET','[redacted]')};
 let pipeline=module.createBugPipeline(opts);
 t.after(async()=>{await pipeline.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {store,prompts,opts,get pipeline(){return pipeline},set busy(v){busy=v},advance:()=>time+=60001,
  restart:async()=>{await pipeline.close();pipeline=module.createBugPipeline(opts);},
  report:(code,extra={})=>pipeline.report({sessionId:'fish',scope:'public'},{component:'douyin',code,summary:'comment unavailable',...extra})};
}
const consume=(f)=>f.pipeline.event('debug',{type:'user/message',data:{source:{rpcId:f.prompts.at(-1).requestId}}});

test('native runtime and time context snapshots do not revoke a consumed repair batch',async t=>{
 const f=fixture(t),r=f.report('CONTROL_NOT_UNIQUE');await f.pipeline.tick();consume(f);
 for(const kind of ['runtime-context','time-context'])f.pipeline.event('debug',{type:'user/message',data:{source:{kind,form:'snapshot',sections:[]}}});
 assert.equal(f.pipeline.current().status,'running');
 assert.equal(f.pipeline.result('debug',{issueId:r.issueId,status:'blocked',evidence:'verification still required'}).persisted,true);
 f.pipeline.event('debug',{type:'user/message',data:{source:{kind:'user',rpcId:'different-user-turn'}}});
 assert.equal(f.pipeline.current().status,'uncertain');
 assert.throws(()=>f.pipeline.result('debug',{issueId:r.issueId,status:'blocked',evidence:'verification still required'}));
});
test('busy debug accumulates bugs then dispatches at most five and waits for actual results',async t=>{
 const f=fixture(t);f.busy=true;for(let i=0;i<7;i++)f.pipeline.report({sessionId:'fish-'+i,scope:'public'},{component:'runtime',code:'failure_'+i,summary:'broken'});
 await f.pipeline.tick();assert.equal(f.prompts.length,0);f.busy=false;await f.pipeline.tick();
 assert.equal(f.prompts.length,1);const batch=f.pipeline.current();assert.equal(batch.issues.length,5);
 await f.pipeline.tick();assert.equal(f.prompts.length,1);consume(f);
 for(const issue of batch.issues)f.pipeline.result('debug',{issueId:issue.id,status:'fixed',evidence:'regression and isolated model checks passed'});
 await f.pipeline.tick();assert.equal(f.prompts.length,1,'receipt must not inject work into same active turn');
 f.pipeline.event('debug',{type:'turn/end'});await f.pipeline.tick();assert.equal(f.prompts.length,2);assert.equal(f.pipeline.current().issues.length,2);
});
test('same component and error coalesce across sessions, videos and intent IDs',async t=>{
 const f=fixture(t);const a=f.report('CONTROL_NOT_UNIQUE');
 const b=f.pipeline.report({sessionId:'another',scope:'public'},{component:'douyin',code:'control_not_unique',summary:'different video'});
 assert.equal(a.issueId,b.issueId);assert.equal(b.duplicate,true);await f.pipeline.tick();assert.equal(f.pipeline.current().issues.length,1);assert.equal(f.pipeline.current().issues[0].occurrences,2);
});
test('ambiguous prompt and restart never resend a durable attempt',async t=>{
 const f=fixture(t,{throwPrompt:true});f.report('CONTROL_NOT_UNIQUE');await f.pipeline.tick();assert.equal(f.prompts.length,1);
 assert.equal(f.pipeline.current().status,'uncertain');await f.restart();await f.pipeline.tick();assert.equal(f.prompts.length,1);
 consume(f);assert.equal(f.pipeline.current().status,'running');
});
test('only consumed debug batch can complete an issue and end without receipt stays unresolved',async t=>{
 const f=fixture(t);const r=f.report('CONTROL_NOT_UNIQUE');await f.pipeline.tick();const input={issueId:r.issueId,status:'fixed',evidence:'test passed'};
 assert.throws(()=>f.pipeline.result('debug',input));consume(f);assert.throws(()=>f.pipeline.result('fish',input));
 assert.throws(()=>f.pipeline.result('debug',{...input,evidence:''}));assert.throws(()=>f.pipeline.result('debug',{...input,issueId:'unknown'}));
 f.pipeline.event('debug',{type:'turn/end'});assert.equal(f.pipeline.get(r.issueId).status,'attention_required');assert.throws(()=>f.pipeline.result('debug',input));
});
test('private bug reports do not copy private prose or source identities into debug prompts',async t=>{
 const f=fixture(t);f.pipeline.report({sessionId:'private-session',scope:'private:qq'},{component:'privacy',code:'owner_disclosure',summary:'PRIVATE_OWNER_AND_CONVERSATION',sourceEventIds:['private-event']});
 await f.pipeline.tick();const text=JSON.stringify(f.prompts);assert.doesNotMatch(text,/PRIVATE_OWNER_AND_CONVERSATION|private-event|private-session/);assert.match(text,/owner_disclosure/);
});
test('disabled queue fails explicitly, payload bounds hold and duplicates remain accepted at capacity',async t=>{
 const f=fixture(t,{config:{enabled:false}});assert.throws(()=>f.report('x'),/disabled/i);
 const g=fixture(t);assert.throws(()=>g.report('x',{summary:'a'.repeat(801)}));assert.throws(()=>g.report('bad code'));
 for(let i=0;i<256;i++)g.pipeline.report({sessionId:'source-'+i,scope:'public'},{component:'runtime',code:'x_'+i,summary:'broken'});
 assert.throws(()=>g.pipeline.report({sessionId:'fresh',scope:'public'},{component:'runtime',code:'overflow',summary:'broken'}),/capacity/i);
 assert.equal(g.pipeline.report({sessionId:'fresh',scope:'public'},{component:'runtime',code:'x_0',summary:'again'}).duplicate,true);
});
test('concurrent ticks submit one batch and late result cannot overwrite final evidence',async t=>{
 const f=fixture(t);const r=f.report('CONTROL_NOT_UNIQUE');await Promise.all([f.pipeline.tick(),f.pipeline.tick()]);assert.equal(f.prompts.length,1);consume(f);
 const input={issueId:r.issueId,status:'blocked',evidence:'operator verification required'};assert.equal(f.pipeline.result('debug',input).persisted,true);
 assert.equal(f.pipeline.result('debug',input).persisted,true);assert.throws(()=>f.pipeline.result('debug',{...input,status:'fixed'}));
});
test('old unknown batch becomes attention required only after native idleness and does not starve later bugs',async t=>{
 const f=fixture(t,{throwPrompt:true});const first=f.report('first');await f.pipeline.tick();f.report('second');
 for(let i=0;i<31;i++)f.advance();f.busy=true;await f.pipeline.tick();assert.equal(f.prompts.length,1);
 f.busy=false;await f.pipeline.tick();assert.equal(f.pipeline.get(first.issueId).status,'attention_required');assert.equal(f.prompts.length,2);
});
test('private codes cannot smuggle owner identifiers or credentials into debug context',async t=>{
 const f=fixture(t);f.pipeline.report({sessionId:'private',scope:'private:qq'},{component:'privacy',code:'owner_11223344_SECRET',summary:'redacted'});
 await f.pipeline.tick();assert.doesNotMatch(JSON.stringify(f.prompts),/11223344|SECRET/);assert.equal(f.pipeline.current().issues[0].code,'private_issue');
});
test('new occurrence after a repair requeues while replaying the same evidence does not',async t=>{
 const f=fixture(t),source={sessionId:'watchdog',scope:'internal:runtime',occurrenceId:'observation-1'},input={component:'douyin',code:'CONTROL_NOT_UNIQUE',summary:'comment failure'};
 const r=f.pipeline.report(source,input);await f.pipeline.tick();consume(f);f.pipeline.result('debug',{issueId:r.issueId,status:'fixed',evidence:'regression verified'});f.pipeline.event('debug',{type:'turn/end'});
 f.pipeline.report(source,input);await f.pipeline.tick();assert.equal(f.prompts.length,1);
 f.pipeline.report({...source,occurrenceId:'observation-2'},input);await f.pipeline.tick();assert.equal(f.prompts.length,2);
 assert.equal(f.pipeline.get(r.issueId).generation,2);assert.equal(f.store.db.prepare('SELECT status FROM bug_results WHERE issue_id=?').get(r.issueId).status,'fixed');
});
