import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../core/events.mjs';
import {createHostState} from '../host/state.mjs';
import {createEvolution} from '../host/evolution.mjs';
const issue=(id='sample')=>({id,title:'Sample failure',symptom:'x'.repeat(700),confirmedFacts:['Observed failure'],hypotheses:['Possible cause'],recovery:['Inspect before recovery'],status:'open'});
test('more than twelve known issues remain readable and every issue reaches a review batch',async t=>{
 const f=fixture(t),issues=Array.from({length:40},(_,n)=>({...issue(`case-${n}`),symptom:'Observed failure'}));
 f.write(issues);await f.evo.poll();
 assert.equal(f.evo.status().issueMemory.state,'ready');
 assert.equal(f.evo.status().issueMemory.count,40);
 const reviewed=new Set();
 for(let batch=0;batch<3;batch++){
  const sources=f.jobs.at(-1).event.meta.sourceEventIds.slice(1);
  assert.ok(sources.length<=19);
  for(const id of sources)reviewed.add(JSON.parse(f.store.get(id).text).issue.id);
  f.complete();f.advance();await f.evo.poll();
 }
 assert.equal(reviewed.size,40);
 assert.ok(issues.every(issue=>reviewed.has(issue.id)));
 assert.equal(f.jobs.length,3);
});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'watchdog-issues-')),file=path.join(dir,'issues.json'),store=createEventStore({stateDir:dir}),state=createHostState(store),jobs=[];let time=1000000;const config={knownIssuesFile:file,reviewIntervalMs:60000};const opts={state,store,config,now:()=>time,sessions:{enqueue:async j=>jobs.push(j)},caller:()=>({consumed:true,role:'evolution',...jobs.at(-1).binding,consumed:true,requestId:jobs.at(-1).action.dispatchId})};let evo=createEvolution(opts);t.after(async()=>{await evo.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {file,store,state,jobs,write:issues=>fs.writeFileSync(file,JSON.stringify({version:1,issues})),get evo(){return evo},advance:()=>time+=60001,restart:async()=>{await evo.close();evo=createEvolution(opts)},complete(){const job=jobs.at(-1);state.put('platform-job',job.action.dispatchId,{sessionId:'session',status:'starting'});return evo.report('session',{scope:'internal:runtime',facts:[{text:'Reviewed',sourceEventIds:job.event.meta.sourceEventIds}],hypotheses:[]});}};}
test('known issues are complete canonical private evidence, persist and do not replay after restart',async t=>{const f=fixture(t);f.write([issue()]);await f.evo.poll();assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].binding.scope,'internal:runtime');const ids=f.jobs[0].event.meta.sourceEventIds;assert.equal(ids.length,2);const source=f.store.get(ids[1]);assert.equal(source.meta.provenance,'operator-maintained');assert.equal(JSON.parse(source.text).issue.symptom.length,700);f.complete();const read=f.evo.read('session');assert.equal(JSON.parse(read.sources[1].text).issue.symptom.length,700);assert.equal(read.reports.length,1);await f.restart();f.advance();await f.evo.poll();assert.equal(f.jobs.length,1);});
test('updates observed while a watchdog job is pending are retained until reviewed',async t=>{const f=fixture(t);f.write([issue()]);await f.evo.poll();f.write([{...issue(),status:'investigating'}]);await f.evo.poll();f.write([{...issue(),status:'resolved'}]);await f.evo.poll();assert.equal(f.jobs.length,1);f.complete();f.advance();await f.evo.poll();assert.equal(f.jobs.length,2);const statuses=f.jobs[1].event.meta.sourceEventIds.slice(1).map(id=>JSON.parse(f.store.get(id).text).issue.status);assert.deepEqual(statuses,['investigating','resolved']);f.complete();f.advance();await f.evo.poll();assert.equal(f.jobs.length,2);});
test('malformed and missing files expose bounded health errors without losing previous sources',async t=>{const f=fixture(t);f.write([issue()]);await f.evo.poll();f.complete();fs.writeFileSync(f.file,'{"secret":"private"');f.advance();await f.evo.poll();assert.equal(f.evo.status().issueMemory.state,'error');assert.equal(f.evo.status().issueMemory.code,'invalid_document');const source=f.store.get(f.jobs.at(-1).event.meta.sourceEventIds[0]);assert.equal(JSON.parse(source.text).issueMemory.state,'error');assert.doesNotMatch(source.text,/private/);assert.equal(f.state.list('evolution-snapshot').filter(x=>x.issueMemory).length,1);f.complete();fs.unlinkSync(f.file);f.advance();await f.evo.poll();assert.equal(f.evo.status().issueMemory.code,'read_failed');});
test('strict schema and size failures never register an invalid issue',async t=>{for(const invalid of [{...issue(),status:'execute'}, {...issue(),id:'../unsafe'}, {...issue(),extra:'instruction'}, {...issue(),confirmedFacts:['a'.repeat(401)]}]){const f=fixture(t);f.write([invalid]);await f.evo.poll();assert.equal(f.evo.status().issueMemory.state,'error');assert.equal(f.jobs[0].event.meta.sourceEventIds.length,1);}const f=fixture(t);fs.writeFileSync(f.file,' '.repeat(65537));await f.evo.poll();assert.equal(f.evo.status().issueMemory.code,'too_large');});
test('backlog drains in bounded batches and a new report cannot cite an earlier unbound version',async t=>{const f=fixture(t);f.write([issue()]);await f.evo.poll();const oldId=f.jobs[0].event.meta.sourceEventIds[1];for(let n=0;n<25;n++){f.write([{...issue(),title:`Revision ${n}`}]);await f.evo.poll();}f.complete();await f.restart();f.advance();await f.evo.poll();assert.equal(f.jobs[1].event.meta.sourceEventIds.length,20);f.complete();assert.throws(()=>f.evo.report('session',{scope:'internal:runtime',facts:[{text:'Old',sourceEventIds:[oldId]}]}),/outside bound scope/);f.advance();await f.evo.poll();assert.equal(f.jobs[2].event.meta.sourceEventIds.length,7);f.complete();f.advance();await f.evo.poll();assert.equal(f.jobs.length,3);});
test('escaped evidence batches stay within the canonical event text bound',async t=>{const f=fixture(t);f.write([issue()]);await f.evo.poll();for(let n=0;n<20;n++){f.write([{...issue(),title:`Version ${n}`,symptom:'\\'.repeat(700),confirmedFacts:Array(3).fill('\\'.repeat(200))}]);await f.evo.poll();assert.equal(f.evo.status().issueMemory.state,'ready');}f.complete();f.advance();await f.evo.poll();assert.ok(f.jobs.at(-1).event.text.length<90000);});
test('unseen B survives A-B-A and exhausted A recovery, without retrying attempted versions forever',async t=>{
 const f=fixture(t),finish=()=>{const requestId=f.jobs.at(-1).action.dispatchId;f.state.put('platform-job',requestId,{requestId,status:'completed'});f.evo.finish({requestId});};
 f.write([issue()]);await f.evo.poll();f.write([{...issue(),status:'investigating'}]);await f.evo.poll();f.write([issue()]);await f.evo.poll();
 finish();f.advance();await f.evo.poll();assert.equal(f.jobs.length,2);finish();await f.restart();f.advance();await f.evo.poll();assert.equal(f.jobs.length,3);
 const third=f.jobs.at(-1);assert.notEqual(third.action.dispatchId,f.jobs[0].action.dispatchId);assert.deepEqual(third.event.meta.sourceEventIds.slice(1).map(id=>JSON.parse(f.store.get(id).text).issue.status),['investigating']);
 finish();f.advance();await f.evo.poll();assert.equal(f.jobs.length,4);finish();await f.restart();for(let n=0;n<3;n++){f.advance();await f.evo.poll();}assert.equal(f.jobs.length,4);
});
