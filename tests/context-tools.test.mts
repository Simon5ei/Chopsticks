import {BUG_REPORT_RULE} from '../src/host/bug-pipeline.mjs';
import {OWNER_PRIVACY_RULE} from '../src/host/owner-privacy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {apply as guard} from '../src/host/guard.mjs';

const names=['chopsticks_context_search','chopsticks_context_read','chopsticks_tasks'];
test('context tools are read-only additions to supported execution modes',()=>{
 for(const mode of ['router','qq','bili','bili-dm','qzone','heybox','douyin','worker','development','evolution','diary','unknown']){
  let allow,policy;guard({tools:{view:()=>({visible:new Map([...names,'chopsticks_exec','chopsticks_decide'].map((n)=>[n,{}]))}),restrict:(o)=>{allow=o.allow;},guard:(fn)=>{policy=fn;}},on(){},effect(){}},{mode});
  for(const name of names){const expected=!['evolution','diary','unknown'].includes(mode);assert.equal(allow.includes(name),expected,`${mode} ${name}`);assert.equal(policy({name})===undefined,expected);}
  assert.equal(policy({name:'chopsticks_exec'})===undefined,mode==='development');
 }
});

async function hostFixture(){
 const tools=new Map(),hooks=new Map(),calls=[],trusted={role:'qq',channel:'g:7',sessionId:'session'};
 const runtime={state:{list:()=>[],binding:()=>null},store:{},desktopLease:{release(){}},start(){},close(){},caller:()=>trusted,
  contextCaller:(...a)=>{calls.push(['caller',...a]);if(a[1]==='forged')throw Error('inactive source');return trusted;},
  contextService:{search:(...a)=>{calls.push(['search',...a]);return {events:[]};},read:(...a)=>{calls.push(['read',...a]);return {events:[]};},overview:async (c?: any) =>{calls.push(['overview',c]);return {tasks:[{id:'task',state:'running',summary:'brief'}]};}},
  coordinator:{knowledge:(...a)=>{calls.push(['knowledge',...a]);return [];}}};
 const config={stateDir:'fixture',fishHome:'fixture'},req=(n)=>n==='@deepseek-ai/dsh-tools'?{defineTool:(v)=>v}:{createMcpToolDefinition:(_c?: any,v?: any)=>v};req.resolve=()=>import.meta.filename;
 const source=fs.readFileSync(new URL('../src/host/index.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replaceAll('export ','');
 const context={fs,path,OWNER_PRIVACY_RULE,BUG_REPORT_RULE,process:{env:{CHOPSTICKS_CONFIG:'fixture',DSH_RUNTIME_PACKAGE:import.meta.filename},argv:[]},createRequire:()=>req,readJSON:()=>config,
  createRuntime:async()=>runtime,createRouterNative:()=>({}),registerConsole(){},registerManagement(){},createMemory:()=>({}),createBiliService:()=>({listTools:()=>[]}),createContentRounds:()=>({}),createNativeDesktopSource:()=>({close(){}}),liveConversationContext:()=>({revision:1,text:'recent experiences'}),console};
 vm.createContext(context);vm.runInContext(source,context);
 await vm.runInContext('apply',context)({tools:{register:(v)=>{tools.set(v.name,v);},guard(){}},effect(){},on:(n?: any,fn?: any)=>{hooks.set(n,fn);},sessionController:{}});
 return {tools,hooks,calls,runtime,trusted};
}
test('context tools resolve trusted active source and forward only their read parameters',async()=>{
 const {tools,calls,trusted}=await hostFixture(),exec={agent:{session:{id:'router'}}};
 for(const name of names)assert.ok(tools.has(name),name);
 const search={query:'history',limit:3,eventId:'source'};
 await tools.get(names[0]).execute(search,exec);
 assert.deepEqual(calls[0],['caller','router','source']);assert.equal(calls[1][1],trusted);assert.deepEqual({...calls[1][2]},{query:'history',limit:3});
 await tools.get(names[1]).execute({kind:'thread',id:'g:7',beforeSeq:9,limit:2,eventId:'source'},exec);
 assert.deepEqual({...calls.at(-1)[2]},{kind:'thread',id:'g:7',beforeSeq:9,limit:2});
 await tools.get(names[2]).execute({query:'research',id:'task',limit:2,eventId:'source'},exec);
 assert.equal(calls.at(-1)[0],'knowledge');assert.equal(calls.at(-1)[1],trusted);assert.deepEqual({...calls.at(-1)[2]},{query:'research',id:'task',limit:2});
 assert.throws(()=>tools.get(names[0]).execute({query:'x',eventId:'forged'},exec),/inactive source/);
});
test('prompt keeps recent context and appends only compact task cards for ordinary sources',async()=>{
 const {hooks,runtime,calls}=await hostFixture(),assemble=hooks.get('system-prompt/assemble'),ctx={agent:{session:{id:'session'}}};
 const result=await assemble({},ctx);assert.equal(result.contexts.find(c=>c.name==='chopsticks-live').text,'recent experiences');
 assert.match(result.contexts.find((c)=>c.name==='chopsticks-tasks')?.text||'',/task/);
 runtime.contextService.overview=async()=>({tasks:[]});const empty=await assemble(result,ctx);assert.deepEqual(Array.from(empty.contexts,(c:any)=>c.name).sort(),['chopsticks-live','chopsticks-safety']);
 runtime.contextCaller=()=>{throw Error('source event required');};
 const ambiguous=await assemble({},ctx);assert.deepEqual(Array.from(ambiguous.contexts,(c:any)=>c.name).sort(),['chopsticks-live','chopsticks-safety']);
 runtime.caller=(()=>({role:'diary',channel:'diary:public'}) as any);const before=calls.length;const diary=await assemble({},ctx);assert.deepEqual(Array.from(diary.contexts,(c:any)=>c.name),['chopsticks-safety']);assert.equal(calls.length,before);
});
