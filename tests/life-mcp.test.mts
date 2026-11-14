import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createPlatformBridge} from '../src/life/bridge.mjs';

test('real MCP stdio exposes only actor operations and forwards an opaque ticket',async (t?: any) =>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-mcp-'));const socketPath=process.platform==='win32'?`\\\\.\\pipe\\life-${randomUUID()}`:path.join(dir,'life','platform.sock');
 const config=path.join(dir,'config.json');await fs.writeFile(config,JSON.stringify({stateDir:dir,life:{socketPath}}));
 const calls=[];const bridge=createPlatformBridge({socketPath,handle:async(req?: any,ctx?: any)=>{calls.push([req,ctx]);return {state:'ready'};}});await bridge.start();
 const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/life/mcp.mjs',import.meta.url)),'--platform','qq'],env:{...process.env,CHOPSTICKS_CONFIG:config},stderr:'pipe'});const client=new Client({name:'fixture',version:'1'});
 t.after(async()=>{await client.close();await bridge.close();await fs.rm(dir,{recursive:true,force:true});});await client.connect(transport);
 assert.deepEqual((await client.listTools()).tools.map((x)=>x.name),['qq_status','qq_read','qq_write']);
 const result=await client.callTool({name:'qq_write',arguments:{ticket:'opaque',action:'reply',targetId:'a',text:'hi'}});assert.equal(result.isError,undefined);
 assert.equal(calls[0][0].args.ticket,'opaque');assert.equal(calls[0][1].operator,false);
 const forbidden=await client.callTool({name:'qq_login',arguments:{operator:true,action:'start'}});assert.equal(forbidden.isError,true);
 const injected=await client.callTool({name:'qq_status',arguments:{operator:true}});assert.equal(injected.isError,true);
});

test('operator CLI uses private listener and emits a restricted login result',async (t?: any) =>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-operator-'));const socketPath=process.platform==='win32'?`\\\\.\\pipe\\life-${randomUUID()}`:path.join(dir,'life','platform.sock');const config=path.join(dir,'config.json');await fs.writeFile(config,JSON.stringify({stateDir:dir,life:{socketPath}}));
 const calls=[];const bridge=createPlatformBridge({socketPath,handle:async(req?: any,ctx?: any)=>{calls.push([req,ctx]);return {state:'waiting',qrImagePath:'/private/qr.png',expiresAt:123,cookie:'secret'};}});await bridge.start();t.after(async()=>{await bridge.close();await fs.rm(dir,{recursive:true,force:true});});
 const {stdout}=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../src/life/operator.mjs',import.meta.url)),'login','heybox','start'],{env:{...process.env,CHOPSTICKS_CONFIG:config}});
 assert.deepEqual(JSON.parse(stdout),{state:'waiting',qrImagePath:'/private/qr.png',expiresAt:123});assert.equal(calls[0][1].operator,true);assert.equal(calls[0][0].args.action,'start');
});

test('MCP cancellation reaches the active bridge handler',async (t?: any) =>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-mcp-cancel-'));const socketPath=process.platform==='win32'?`\\\\.\\pipe\\life-${randomUUID()}`:path.join(dir,'life','platform.sock');const config=path.join(dir,'config.json');await fs.writeFile(config,JSON.stringify({stateDir:dir,life:{socketPath}}));
 let started,observed;const entered=new Promise<any | void>((r)=>started=r),aborted=new Promise<any | void>((r)=>observed=r);
 const bridge=createPlatformBridge({socketPath,handle:async(_req?: any,ctx?: any)=>{started();return new Promise<any | void>((resolve)=>ctx.signal?.addEventListener('abort',()=>{observed();resolve({state:'error'});},{once:true}));}});await bridge.start();
 const client=new Client({name:'fixture',version:'1'}), transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/life/mcp.mjs',import.meta.url)),'--platform','qq'],env:{...process.env,CHOPSTICKS_CONFIG:config},stderr:'pipe'});
 t.after(async()=>{await client.close();await bridge.close();await fs.rm(dir,{recursive:true,force:true});});await client.connect(transport);
 const c=new AbortController(),pending=client.callTool({name:'qq_status',arguments:{}},undefined,{signal:c.signal});await entered;c.abort();await assert.rejects(pending);
 assert.equal(await Promise.race([aborted.then(()=>true),new Promise<any | void>((r)=>setTimeout(()=>r(false),150))]),true);
});

test('a refused platform call returns a bounded reason code instead of one opaque sentence',async (t?: any) =>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-mcp-fail-'));const socketPath=process.platform==='win32'?`\\\\.\\pipe\\life-${randomUUID()}`:path.join(dir,'life','platform.sock');
 const config=path.join(dir,'config.json');await fs.writeFile(config,JSON.stringify({stateDir:dir,life:{socketPath}}));
 const bridge=createPlatformBridge({socketPath,handle:async()=>{throw Object.assign(Error('ticket expired'),{code:'TICKET_REJECTED'});}});await bridge.start();
 const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/life/mcp.mjs',import.meta.url)),'--platform','qq'],env:{...process.env,CHOPSTICKS_CONFIG:config},stderr:'pipe'});const client=new Client({name:'fixture',version:'1'});
 t.after(async()=>{await client.close();await bridge.close();await fs.rm(dir,{recursive:true,force:true});});await client.connect(transport);
 const result=await client.callTool({name:'qq_read',arguments:{ticket:'t',action:'feed'}});
 assert.equal(result.isError,true);const body=JSON.parse(result.content[0].text);
 assert.equal(body.code,'TICKET_REJECTED');assert.equal(body.ok,false);assert.doesNotMatch(result.content[0].text,/expired/i);
});
