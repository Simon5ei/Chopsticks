import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const obs=await import('../host/observability.mjs').catch(()=>({}));
const api=await import('../host/console.mjs').catch(()=>({}));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-trace-'));t.after(()=>setImmediate(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50})));return dir;}
test('trace store persists redacted bounded native reasoning and tool results with source links',t=>{
 assert.equal(typeof obs.createObservability,'function');const dir=fixture(t),o=obs.createObservability({stateDir:dir,secrets:['configured-secret'],maxRows:4});t.after(()=>o.close());
 o.native('worker',{type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'actual configured-secret'},{type:'text',text:'answer'}]}}},{eventId:'source',channel:'g:1',requestId:'request'});
 o.native('worker',{type:'tool/call',data:{callId:'call',name:'read',arguments:'{"token":"unsafe"}'}},{eventId:'source'});
 o.native('worker',{type:'tool/result',data:{message:{toolCallId:'call',content:[{type:'text',text:'result'},{type:'image',data:'a'.repeat(500)}]}}},{eventId:'source'});
 let rows=o.query({}).items;assert.equal(rows.length,4);assert.equal(rows.find(r=>r.kind==='reasoning').eventId,'source');assert.equal(rows.find(r=>r.kind==='tool.result').callId,'call');assert.ok(!JSON.stringify(rows).includes('configured-secret'));assert.ok(!JSON.stringify(rows).includes('unsafe'));assert.ok(!JSON.stringify(rows).includes('a'.repeat(500)));
 o.native('worker',{type:'user/message',data:{content:[{type:'text',text:'private prompt'}]}},{});assert.equal(o.query({}).items.length,4);
 o.record({kind:'turn.end',text:'x'.repeat(100000)});rows=o.query({limit:1000}).items;assert.equal(rows.length,4);assert.ok(rows[0].text.length<=8000);assert.equal(o.query({beforeSeq:rows.at(-1).seq}).items.length,0);
 o.close();const reopened=obs.createObservability({stateDir:dir});assert.equal(reopened.query({eventId:'source',limit:1}).items.length,1);reopened.close();
});
test('malformed/cyclic native events never escape and metadata logs contain no body',t=>{
 assert.equal(typeof obs.createObservability,'function');const emitted=[],o=obs.createObservability({stateDir:fixture(t),logger:{info:v=>emitted.push(v)}});t.after(()=>o.close());
 const cycle={};cycle.x=cycle;assert.doesNotThrow(()=>o.native('s',{type:'tool/result',data:cycle},{}));o.record({kind:'turn.start',text:'body secret',data:{password:'hide'}});assert.ok(!JSON.stringify(emitted).includes('body secret'));assert.ok(!JSON.stringify(emitted).includes('hide'));
});
test('RPC validates envelopes and permits only fixed read endpoints',async()=>{
 assert.equal(typeof api.registerConsole,'function');let registration;api.registerConsole({inject(_deps,fn){fn({connection:{fetch:{register(r){registration=r;}}}});}},{queryConsole(endpoint,payload){assert.equal(endpoint,'traces');return {items:[],limit:payload.limit};}});
 assert.equal(registration.path,'/api/chopsticks-console');const request=value=>new Request('http://localhost/api/chopsticks-console',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await registration.fetch(request({}))).status,400);
 const response=await registration.fetch(request({type:'client-request',rpcId:'r',method:'chopsticks-console',payload:{endpoint:'traces',payload:{limit:20}}}));assert.deepEqual(await response.json(),{type:'server-response',rpcId:'r',result:{ok:true,value:{items:[],limit:20}}});
 const invalid=await registration.fetch(request({type:'client-request',rpcId:'r',method:'chopsticks-console',payload:{endpoint:'send'}}));assert.equal((await invalid.json()).result.ok,false);
});


test('runtime queries canonical events with bounded pagination and source session association',async t=>{
 const {createRuntime}=await import('../host/runtime.mjs');const dir=fixture(t);const runtime=await createRuntime({config:{stateDir:dir,fishHome:dir,qq:{enabled:false}},controller:{},adapterFactory:()=>({close:async()=>{}})});t.after(()=>runtime.close());
 runtime.store.append({id:'source',kind:'message.received',channel:'g:1',actorId:'u',text:'searchable'});
 runtime.state.put('request','request',{channel:'g:1',eventId:'source',requestId:'request'});runtime.event({id:'worker'},{type:'user/message',data:{source:{rpcId:'request'}}});
 runtime.event({id:'worker'},{type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'actual thought'}]}}});
 const row=runtime.queryConsole('traces',{eventId:'source'}).items[0];assert.equal(row.sessionId,'worker');assert.equal(row.channel,'g:1');assert.equal(row.data.requestId,'request');
 assert.equal(runtime.queryConsole('events',{query:'searchable',sessionId:'worker'}).items[0].sessionId,'worker');assert.equal((await runtime.queryConsole('overview',{})).sessions[0].sessionId,'worker');
});

test('query filters, cursor and literal wildcard search are bounded; unavailable telemetry is inert',t=>{
 const o=obs.createObservability({stateDir:fixture(t),logger:{info(){throw Error('logger unavailable');}}});t.after(()=>o.close());
 for(let i=0;i<5;i++)o.record({kind:'turn.start',sessionId:i%2?'other':'worker',eventId:'e',channel:'g:1',text:i===2?'literal %_':'row '+i});
 const first=o.query({limit:2});assert.equal(first.items.length,2);assert.equal(first.nextBeforeSeq,4);assert.deepEqual(o.query({beforeSeq:first.nextBeforeSeq,limit:2}).items.map(r=>r.seq),[3,2]);assert.equal(o.query({query:'%_'}).items.length,1);assert.equal(o.query({sessionId:'worker',eventId:'e',channel:'g:1'}).items.length,3);
 const dead=obs.createObservability({stateDir:path.join(fixture(t),'missing','bad\0')});assert.doesNotThrow(()=>dead.record({kind:'x'}));assert.deepEqual(dead.query(),{items:[],nextBeforeSeq:null});dead.close();
});

test('console event pages retain requested row count and cursor without gaps',async t=>{
 const {createRuntime}=await import('../host/runtime.mjs');const dir=fixture(t),r=await createRuntime({config:{stateDir:dir,fishHome:dir,qq:{enabled:false},bili:{enabled:true,sessionId:'bili'}},controller:{},adapterFactory:()=>({close:async()=>{}})});t.after(()=>r.close());for(let i=0;i<60;i++)r.store.append({id:'e'+i,kind:'message.received',channel:'g:1',actorId:'u',text:'x'});const page=r.queryConsole('events',{limit:50});assert.equal(page.items.length,50);assert.equal(r.queryConsole('events',{limit:50,beforeSeq:page.nextBeforeSeq}).items.length,10);assert.ok((await r.queryConsole('overview')).sessions.some(s=>s.sessionId==='bili'));
});

test('bound Bili session keeps its Bili role in console overview',async t=>{
 const {createRuntime}=await import('../host/runtime.mjs');const dir=fixture(t);
 const r=await createRuntime({config:{stateDir:dir,fishHome:dir,qq:{enabled:false},bili:{enabled:true,sessionId:'bili'}},controller:{},adapterFactory:()=>({close:async()=>{}})});t.after(()=>r.close());
 r.state.bind('bili',{channel:'bili:public',eventId:'bili-event'});
 assert.equal((await r.queryConsole('overview')).sessions.find(s=>s.sessionId==='bili').role,'bili');
});

test('historical source filters survive newer consumed bindings and runtime restart',async t=>{
 const {createRuntime}=await import('../host/runtime.mjs');const dir=fixture(t),options={config:{stateDir:dir,fishHome:dir,qq:{enabled:false}},controller:{},adapterFactory:()=>({close:async()=>{}})};let r=await createRuntime(options);
 for(const id of ['first','second']){r.store.append({id,kind:'message.received',channel:'g:1',actorId:'u',text:id});r.state.put('request',id,{eventId:id,channel:'g:1',requestId:id});r.event({id:'chat'},{type:'user/message',data:{source:{rpcId:id}}});r.event({id:'chat'},{type:'turn/start',data:{turn:1}});}
 assert.deepEqual(r.queryConsole('events',{sessionId:'chat'}).items.map(x=>x.id),['second','first']);await r.close();r=await createRuntime(options);t.after(()=>r.close());assert.deepEqual(r.queryConsole('events',{sessionId:'chat'}).items.map(x=>x.id),['second','first']);
});
test('nested credential leaves are masked even with generic child names',async t=>{
 const {createRuntime}=await import('../host/runtime.mjs');const dir=fixture(t),r=await createRuntime({config:{stateDir:dir,fishHome:dir,qq:{enabled:false,token:{http:'nested-http-credential',ws:'nested-ws-credential'}}},controller:{},adapterFactory:()=>({close:async()=>{}})});t.after(()=>r.close());r.state.bind('chat',{eventId:'e',channel:'g:1'});r.event({id:'chat'},{type:'assistant/message',data:{message:{content:[{type:'text',text:'nested-http-credential nested-ws-credential'}]}}});assert.ok(!JSON.stringify(r.queryConsole('traces',{})).includes('nested-http-credential'));
});
test('delayed task launch retains submitted source after chat binding changes',async t=>{
 const {createRuntime}=await import('../host/runtime.mjs');const dir=fixture(t);fs.mkdirSync(path.join(dir,'characters'),{recursive:true});fs.writeFileSync(path.join(dir,'characters/current.json'),JSON.stringify({id:'fish'}));const r=await createRuntime({config:{stateDir:dir,fishHome:dir,qq:{enabled:false}},controller:{inspect:async()=>({}),prompt:async()=>({accepted:true})},adapterFactory:()=>({close:async()=>{}})});t.after(()=>r.close());r.state.put('request','call',{eventId:'first',channel:'g:1',requestId:'call'});r.state.bind('chat',{eventId:'second',channel:'g:1'});await r.coordinator.submit({sessionId:'chat',characterId:'fish',chatKey:'g:1',role:'qq'},{prompt:'read task',requestId:'call'});r.state.bind('chat',{eventId:'second',channel:'g:1'});await r.coordinator.flush();assert.equal(r.queryConsole('traces',{}).items.find(x=>x.kind==='task.prompt').eventId,'first');
});

test('trace endpoint shows nonempty model content and tools while logs retain lifecycle',async t=>{
 const {createRuntime}=await import('../host/runtime.mjs');const dir=fixture(t),r=await createRuntime({config:{stateDir:dir,fishHome:dir,qq:{enabled:false}},controller:{},adapterFactory:()=>({close:async()=>{}})});t.after(()=>r.close());r.state.bind('chat',{eventId:'e',channel:'g:1'});r.event({id:'chat'},{type:'turn/start',data:{turn:1}});r.event({id:'chat'},{type:'assistant/message',data:{message:{content:[{type:'reasoning',text:''},{type:'reasoning',text:'   '},{type:'reasoning',text:'actual emitted reasoning'}]}}});const rows=r.queryConsole('traces',{}).items;assert.equal(rows.length,1);assert.equal(rows[0].text,'actual emitted reasoning');assert.equal(r.queryConsole('logs',{}).items[0].kind,'turn.start');
});
