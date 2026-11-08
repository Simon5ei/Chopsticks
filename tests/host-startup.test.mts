import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRuntime} from '../src/host/runtime.mjs';
import {createMaiBotBridge} from '../src/maibot/bridge.mjs';
import {registerConsole} from '../src/host/console.mjs';
import {createRouterNative} from '../src/host/router-native.mjs';

test('a failed console registration closes the already acquired plugin child and SQLite runtime',async (t?: any) =>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-startup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const runner=path.join(dir,'child.mjs');fs.writeFileSync(runner,`import readline from 'node:readline';for await(const line of readline.createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.method==='init')console.log(JSON.stringify({id:m.id,result:{tools:[]}}));if(m.method==='close')break;}`);
 const config={stateDir:path.join(dir,'state'),fishHome:path.join(dir,'fish'),qq:{enabled:false},bili:{enabled:false},maibot:{enabled:true,python:process.execPath,runnerPath:runner,plugins:[{kind:'date',root:dir}]}};
 let runtime,bridge;const request=(name)=>name==='@deepseek-ai/dsh-tools'?{defineTool:(v)=>v}:{};request.resolve=()=>runner;
 const source=fs.readFileSync(new URL('../src/host/index.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'').replaceAll('export ','');
 const context={fs,path,process:{env:{CHOPSTICKS_CONFIG:'fixture',DSH_RUNTIME_PACKAGE:runner},argv:[]},createRequire:()=>request,readJSON:()=>config,createRouterNative,registerConsole,
  createMaiBotBridge:(options)=>(bridge=createMaiBotBridge(options)),createRuntime:async (options?: any) =>(runtime=await createRuntime({...options,adapterFactory:()=>({close(){},async start(){}})})),console};
 vm.createContext(context);vm.runInContext(source,context);
 const ctx={sessionController:{},get(){},inject(){throw Error('fixture registration failed');},effect:(fn)=>fn()};
 try{await assert.rejects(vm.runInContext('apply',context)(ctx),/fixture registration failed/);await assert.rejects(bridge.call('mcp__maibot_date__query_date',{}),/closed/i);assert.throws(()=>runtime.store.db.prepare('SELECT 1'),/closed|open/i);}
 finally{await bridge?.close();await runtime?.close();}
});
