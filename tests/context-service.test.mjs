import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEventStore} from '../core/events.mjs';
import {createContextService} from '../host/context-service.mjs';
import {createHostState} from '../host/state.mjs';

function fixture(t,coordinator){
 const dir=mkdtempSync(join(tmpdir(),'context-test-')),store=createEventStore({stateDir:dir});
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const add=(id,channel,text=id)=>store.append({id,channel,text,kind:'message.received',actorId:'1'});
 return {store,add,service:createContextService({store,state:{list(){throw Error('No memory scans');}},coordinator})};
}
test('public evidence crosses public groups and platforms; router role grants no private access',t=>{
 const {add,service}=fixture(t);
 for(const channel of ['g:1','wechat:group:other','bili:public','p:1','operator:root'])add(channel,channel,'needle');
 const result=service.search({role:'router',channel:'g:2'},{query:'needle'});
 assert.deepEqual(result.events.map(e=>e.id),['bili:public','wechat:group:other','g:1']);
 assert.equal(result.events[0].threadId,'bili:public');
 assert.throws(()=>service.read({role:'router',channel:'g:2'},{kind:'event',id:'p:1'}),/not found/i);
 assert.throws(()=>service.search({role:'router'},{query:'needle'}),/scope/i);
});
test('private sources require exact trusted channel even with platform private sharing enabled',t=>{
 const {add,service}=fixture(t);add('a','p:1','needle');add('b','p:2','needle');add('c','g:1','needle');
 assert.deepEqual(service.search({chatKey:'p:1'},{query:'needle'}).events.map(e=>e.id),['a']);
 assert.throws(()=>service.read({channel:'p:1'},{kind:'thread',id:'p:2'}),/not found/i);
});
test('reads page by sequence and reject missing, invalid references or cursors',t=>{
 const {add,service}=fixture(t),caller={channel:'g:1'};for(let i=0;i<5;i++)add(`e${i}`,'g:1');
 const first=service.read(caller,{kind:'thread',id:'g:1',limit:2});
 assert.deepEqual(first.events.map(e=>e.id),['e4','e3']);assert.equal(first.truncated,true);
 assert.deepEqual(service.read(caller,{kind:'thread',id:'g:1',limit:2,beforeSeq:first.nextBeforeSeq}).events.map(e=>e.id),['e2','e1']);
 for(const args of [{kind:'event',id:'missing'},{kind:'thread',id:''},{kind:'thread',id:'g:1',beforeSeq:'oops'},{kind:'unknown',id:'g:1'}])assert.throws(()=>service.read(caller,args));
});
test('long evidence and search inputs remain bounded before materialization',t=>{
 const {add,service}=fixture(t);for(let i=0;i<30;i++)add(`e${i}`,'g:1','needle '+ 'x'.repeat(90000));
 const result=service.search({channel:'g:1'},{query:'needle',limit:99999});
 assert.ok(JSON.stringify(result).length<16000);assert.ok(result.events.length<=12);assert.equal(result.events[0].truncated,true);
 assert.equal(service.read({channel:'g:1'},{kind:'event',id:'e0'}).events[0].text.length,4096);
 assert.throws(()=>service.search({channel:'g:1'},{query:''}));
});
test('task API receives trusted caller and compact overview omits worker detail',async t=>{
 const calls=[],caller={channel:'g:1',role:'router'},coordinator={knowledge(c,a){calls.push([c,a]);return {tasks:[{id:'task1',state:'running',summary:'brief',secret:'never'}]};}};
 const {service}=fixture(t,coordinator);
 await service.read(caller,{kind:'task',id:'task1',limit:2});assert.deepEqual(calls[0],[caller,{id:'task1',limit:2}]);
 const overview=await service.overview(caller);assert.equal(overview.tasks[0].id,'task1');assert.doesNotMatch(JSON.stringify(overview),/secret|never/);
});
test('older event references expand independently of bounded search coverage',t=>{
 const {add,service}=fixture(t),caller={channel:'g:1'};
 add('old','g:2','ancient matching fact');
 for(let i=0;i<2050;i++)add(`noise${i}`,'g:1','noise');
 const result=service.search(caller,{query:'ancient'});
 assert.deepEqual(result.events,[]);assert.equal(result.coverage.maxRows,2048);
 assert.match(service.read(caller,{kind:'event',id:'old'}).events[0].text,/ancient/);
 assert.throws(()=>service.read(caller,{kind:'event',id:'old',beforeSeq:1}),/not found/i);
});
test('overview bounds escaped large task cards and never consults persona state',async t=>{
 const {service}=fixture(t,{knowledge:()=>Array.from({length:20},(_,i)=>({id:`task${i}`,state:'running',summary:'\u0001'.repeat(10000),persona:'hidden'}))});
 const result=await service.overview({channel:'p:1'});
 assert.ok(result.tasks.length<=5);assert.ok(JSON.stringify(result).length<=2000);assert.doesNotMatch(JSON.stringify(result),/persona|hidden/);
});
test('development and unknown task results remain source-only across every evidence API',t=>{
 const {store,service}=fixture(t),state=createHostState(store),other={channel:'g:2'},source={channel:'g:1'};
 state.put('task-source','dev',{mode:'development'});state.put('task-source','research',{mode:'research'});
 for(const ticketId of ['dev','research','unknown'])store.append({id:ticketId,channel:'g:1',kind:'task.result',actorId:'fish-worker',text:'result needle '+ticketId,meta:{ticketId}});
 assert.deepEqual(service.search(other,{query:'needle'}).events.map(e=>e.id),['research']);
 assert.deepEqual(service.read(other,{kind:'thread',id:'g:1'}).events.map(e=>e.id),['research']);
 for(const id of ['dev','unknown'])assert.throws(()=>service.read(other,{kind:'event',id}),/not found/i);
 for(const id of ['dev','unknown','research'])assert.equal(service.read(source,{kind:'event',id}).events[0].id,id);
});
