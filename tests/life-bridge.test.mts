import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPlatformBridge,requestPlatform} from '../src/life/bridge.mjs';

async function setup(t?: any, handle?: any, opts: Record<string, any>={}) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-bridge-'));
 const socketPath=process.platform==='win32'?`\\\\.\\pipe\\life-${randomUUID()}`:path.join(dir,'private','platform.sock');
 const bridge=createPlatformBridge({socketPath,handle,...opts}); await bridge.start();
 t.after(async()=>{await bridge.close();await fs.rm(dir,{recursive:true,force:true});});
 return socketPath;
}
test('private endpoints distinguish actor and operator and reject actor login',async (t?: any) =>{
 const seen=[]; const socketPath=await setup(t,async (req?: any,ctx?: any)=>{seen.push([req,ctx]);return {state:'ready'};});
 assert.deepEqual(await requestPlatform({socketPath,platform:'qq',operation:'status',args:{}}),{state:'ready'});
 await assert.rejects(requestPlatform({socketPath,platform:'qq',operation:'login',args:{operator:true}}));
 assert.deepEqual(await requestPlatform({socketPath,platform:'qq',operation:'login',args:{action:'start'},operator:true}),{state:'ready'});
 assert.deepEqual(seen.map((x)=>x[1].operator),[false,true]);assert.ok(seen.every((x)=>x[1].signal instanceof AbortSignal));
 if(process.platform!=='win32'){assert.equal((await fs.stat(socketPath)).mode&0o777,0o600);assert.equal((await fs.stat(path.dirname(socketPath))).mode&0o777,0o700);assert.equal((await fs.stat(socketPath+'.operator')).mode&0o777,0o600);}
});

test('live tests are available only on the operator endpoint',async (t?: any) =>{
 let context;const socketPath=await setup(t,async(_req?: any,ctx?: any)=>{context=ctx;return {state:'prepared'};});
 await assert.rejects(requestPlatform({socketPath,platform:'qzone',operation:'live_test',args:{operator:true}}));
 assert.equal((await requestPlatform({socketPath,platform:'qzone',operation:'live_test',args:{revision:'a'.repeat(64),mode:'prepare'},operator:true})).state,'prepared');assert.equal(context.operator,true);
 const http=await import('node:http');const body=JSON.stringify({platform:'qzone',operation:'live_test',args:{revision:'a'.repeat(64),mode:'execute'},operator:true});
 const status=await new Promise<any | void>((resolve?: any,reject?: any)=>{const req=http.request({socketPath,path:'/',method:'POST',headers:{'content-length':Buffer.byteLength(body)}},(res)=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(body);});assert.equal(status,400);
});

test('publisher diagnostics are operator-only and retain no actor elevation path',async (t?: any) =>{
 let operator;const socketPath=await setup(t,async(_req?: any,ctx?: any)=>{operator=ctx.operator;return {state:'observed'};});
 await assert.rejects(requestPlatform({socketPath,platform:'douyin',operation:'diagnostics',args:{action:'publish_controls',operator:true}}));
 assert.equal((await requestPlatform({socketPath,platform:'douyin',operation:'diagnostics',args:{action:'publish_controls'},operator:true})).state,'observed');assert.equal(operator,true);
});
test('direct DM commands remain on the operator socket even with forged JSON authority',async (t?: any) =>{
 let calls=0;const socketPath=await setup(t,async(_req?: any,ctx?: any)=>{calls++;assert.equal(ctx.operator,true);return {confirmed:true};});
 await assert.rejects(requestPlatform({socketPath,platform:'douyin',operation:'direct_message',args:{operator:true}}));
 const http=await import('node:http'),body=JSON.stringify({platform:'douyin',operation:'direct_message',operator:true,args:{}});
 const status=await new Promise<any | void>((resolve?: any,reject?: any)=>{const req=http.request({socketPath,path:'/',method:'POST',headers:{'content-length':Buffer.byteLength(body)}},(res)=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(body);});assert.equal(status,400);assert.equal(calls,0);
 assert.equal((await requestPlatform({socketPath,platform:'douyin',operation:'direct_message',args:{},operator:true})).confirmed,true);assert.equal(calls,1);
});
test('rejects invalid platforms, bounds requests, sanitizes handler errors and aborts',async (t?: any) =>{
 const socketPath=await setup(t,async ({operation}: { operation?: any; [key: string]: any })=>{if(operation==='read')throw Error('secret-cookie');return new Promise<any | void>(()=>{});},{maxBytes:512});
 await assert.rejects(requestPlatform({socketPath,platform:'other',operation:'status',args:{}}));
 await assert.rejects(requestPlatform({socketPath,platform:'qq',operation:'read',args:{}}),(e: any) =>!e.message.includes('secret-cookie'));
 await assert.rejects(requestPlatform({socketPath,platform:'qq',operation:'read',args:{x:'x'.repeat(1000)}}));
 const c=new AbortController();const p=requestPlatform({socketPath,platform:'qq',operation:'status',args:{},signal:c.signal});c.abort();await assert.rejects(p);
});

test('status and operator output expose only safe fields',async (t?: any) =>{
 const socketPath=await setup(t,async()=>({state:'ready',accountId:'a',capabilities:{feed:true},privateValue:'credential-value',qrImagePath:'/private/qr.png',expiresAt:123}));
 const actor=await requestPlatform({socketPath,platform:'qq',operation:'status',args:{}});
 assert.deepEqual(actor,{state:'ready',accountId:'a',capabilities:{feed:true}});
 const operator=await requestPlatform({socketPath,platform:'qq',operation:'login',args:{action:'start'},operator:true});
 assert.deepEqual(operator,{state:'ready',qrImagePath:'/private/qr.png',expiresAt:123});
});

test('status preserves authentication versus operation failures through IPC without arbitrary data',async (t?: any) =>{
 const socketPath=await setup(t,async()=>({state:'ready',authentication:{state:'ready',cookie:'secret'},operations:{detail:{state:'verification_required',code:'verification_required',checkedAt:123,text:'private'},publish:{state:'unknown',code:'bad cookie=secret'},secretOperation:{state:'ready'}},secret:'private'}));
 const result: any=await requestPlatform({socketPath,platform:'heybox',operation:'status'});
 assert.deepEqual(result.authentication,{state:'ready'});assert.deepEqual(result.operations,{detail:{state:'verification_required',code:'verification_required',checkedAt:123},publish:{state:'unknown'}});assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('secret'));
});

test('raw actor endpoint cannot elevate by supplying operator in JSON',async (t?: any) =>{
 const http=await import('node:http');let calls=0;const socketPath=await setup(t,async()=>{calls++;return {state:'ready'};});
 const body=JSON.stringify({platform:'qq',operation:'login',args:{action:'start'},operator:true});
 const status=await new Promise<any | void>((resolve?: any,reject?: any)=>{const req=http.request({socketPath,path:'/',method:'POST',headers:{'content-length':Buffer.byteLength(body)}},(res)=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end(body);});
 assert.equal(status,400);assert.equal(calls,0);
});

test('an existing non-private socket directory is refused rather than changed', {skip:process.platform==='win32'}, async (t?: any) =>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-public-'));await fs.chmod(dir,0o755);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const bridge=createPlatformBridge({socketPath:path.join(dir,'platform.sock'),handle:async()=>({})});
 await assert.rejects(bridge.start());assert.equal((await fs.stat(dir)).mode&0o777,0o755);
});

test('client disconnect aborts an in-flight bridge handler',async (t?: any) =>{
 let started;const entered=new Promise<any | void>((r)=>started=r);let observed;const aborted=new Promise<any | void>((r)=>observed=r);
 const socketPath=await setup(t,async(_req?: any,ctx?: any)=>{started();return await new Promise<any | void>((resolve)=>{ctx.signal?.addEventListener('abort',()=>{observed();resolve({state:'error'});},{once:true});});});
 const c=new AbortController();const request=requestPlatform({socketPath,platform:'qq',operation:'status',signal:c.signal});await entered;c.abort();await assert.rejects(request);
 assert.equal(await Promise.race([aborted.then(()=>true),new Promise<any | void>((r)=>setTimeout(()=>r(false),100))]),true);
});

test('bridge timeout aborts in-flight handler',async (t?: any) =>{
 let observed;const aborted=new Promise<any | void>((r)=>observed=r);const socketPath=await setup(t,async(_req?: any,ctx?: any)=>new Promise<any | void>((resolve)=>ctx.signal?.addEventListener('abort',()=>{observed();resolve({state:'error'});},{once:true})),{timeoutMs:30});
 await assert.rejects(requestPlatform({socketPath,platform:'qq',operation:'status'}));
 assert.equal(await Promise.race([aborted.then(()=>true),new Promise<any | void>((r)=>setTimeout(()=>r(false),100))]),true);
});

test('recovers sockets left by a killed owner, but refuses a live owner', {skip:process.platform==='win32'}, async (t?: any) =>{
 const {spawn}=await import('node:child_process');const {once}: any=await import('node:events');const {pathToFileURL}=await import('node:url');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-stale-'));const socketPath=path.join(dir,'platform.sock');const url=pathToFileURL(fileURLToPath(new URL('../src/life/bridge.mjs',import.meta.url))).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {createPlatformBridge} from ${JSON.stringify(url)};const b=createPlatformBridge({socketPath:process.argv[1],handle:async()=>({state:'ready'})});await b.start();console.log('ready');`,socketPath],{stdio:['ignore','pipe','pipe']});t.after(async()=>{child.kill('SIGKILL');await fs.rm(dir,{recursive:true,force:true});});
 await once(child.stdout,'data');const contender=createPlatformBridge({socketPath,handle:async()=>({state:'ready'})});await assert.rejects(contender.start());
 assert.equal((await requestPlatform({socketPath,platform:'qq',operation:'status'})).state,'ready');
 child.kill('SIGKILL');await once(child,'exit');const recovered=createPlatformBridge({socketPath,handle:async()=>({state:'ready'})});await recovered.start();t.after(()=>recovered.close());
 assert.equal((await requestPlatform({socketPath,platform:'qq',operation:'status'})).state,'ready');await recovered.close();
});

test('does not unlink a non-socket at the bridge path', {skip:process.platform==='win32'},async (t?: any) =>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'life-ordinary-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const socketPath=path.join(dir,'platform.sock');await fs.writeFile(socketPath,'preserve');
 const bridge=createPlatformBridge({socketPath,handle:async()=>({})});await assert.rejects(bridge.start());assert.equal(await fs.readFile(socketPath,'utf8'),'preserve');
});
