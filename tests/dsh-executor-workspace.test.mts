import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDshExecutor} from '../src/tasks/dsh-executor.mjs';

test('new workers share a fixed workspace cwd and register its native workspace before create',async (t?: any) =>{
 const workerRoot=fs.mkdtempSync(path.join(os.tmpdir(),'fixed-worker-root-'));t.after(()=>fs.rmSync(workerRoot,{recursive:true,force:true}));
 const created=[],prepared=[];
 const executor=createDshExecutor({workerRoot,prepareWorkspace:async (input?: any) =>{assert.ok(fs.statSync(input.cwd).isDirectory());prepared.push(input);return 'workspace-worker';},controller:{async inspect(){throw Object.assign(Error('missing'),{code:'session/not-found'});},async create(r?: any){assert.equal(prepared.length,created.length+1);created.push(r);return {sessionId:r.sessionId};}}});
 await executor.ensureSession({sessionId:'worker-one'});await executor.ensureSession({sessionId:'worker-two'});
 assert.deepEqual(prepared,[{cwd:workerRoot,title:'后台任务'},{cwd:workerRoot,title:'后台任务'}]);
 assert.ok(created.every((r)=>r.workspaceId==='workspace-worker'&&!('cwd' in r)));assert.deepEqual(fs.readdirSync(workerRoot),[]);
});

test('new workers without workspace registration still use the fixed root as cwd',async (t?: any) =>{
 const workerRoot=fs.mkdtempSync(path.join(os.tmpdir(),'fixed-worker-root-'));t.after(()=>fs.rmSync(workerRoot,{recursive:true,force:true}));let request;
 const executor=createDshExecutor({workerRoot,controller:{async inspect(){throw Object.assign(Error('missing'),{code:'session/not-found'});},async create(r?: any){request=r;return {sessionId:r.sessionId};}}});
 await executor.ensureSession({sessionId:'worker-one'});assert.equal(request.cwd,workerRoot);
});

test('restored workers preserve old native cwd and do not register a replacement workspace',async()=>{
 const selected=[];const executor=createDshExecutor({workerRoot:'/unused/new',model:{provider:'fixture',model:'fixture'},prepareWorkspace:async()=>assert.fail('must not relocate history'),controller:{async inspect(){return {meta:{cwd:'/old/session/root'}};},async create(){assert.fail('must not recreate');},async selectModel(r?: any){selected.push(r);}}});
 await executor.ensureSession({sessionId:'old-worker'});assert.equal(selected.length,1);
});

test('cancellation while preparing the workspace prevents native session creation',async (t?: any) =>{
 const workerRoot=fs.mkdtempSync(path.join(os.tmpdir(),'fixed-worker-root-'));t.after(()=>fs.rmSync(workerRoot,{recursive:true,force:true}));const control=new AbortController();
 const executor=createDshExecutor({workerRoot,prepareWorkspace:async()=>{control.abort();return 'workspace';},controller:{async inspect(){throw Object.assign(Error('missing'),{code:'session/not-found'});},async create(){assert.fail('cancelled launch');}}});
 await assert.rejects(()=>executor.ensureSession({sessionId:'worker',signal:control.signal}),(e: any) =>e.name==='AbortError');
});

test('native resume result errors prohibit prompt admission',async()=>{
 const failure=Object.assign(Error('missing'),{code:'session/not-found'});
 const executor=createDshExecutor({controller:{async resolveAgent(){return {error:failure};},async prompt(){assert.fail('missing native agent');}}});
 await assert.rejects(()=>executor.prompt({sessionId:'worker',text:'fixture',deliveryId:'prompt:fixture'}),(e)=>e===failure);
});

test('new development workers isolate cwd by stable ticket while restored sessions stay put',async (t?: any) =>{
 const workerRoot=fs.mkdtempSync(path.join(os.tmpdir(),'dev-worker-root-'));t.after(()=>fs.rmSync(workerRoot,{recursive:true,force:true}));const created=[];
 const executor=createDshExecutor({workerRoot,resolveWorker:()=>({mode:'development'}),controller:{async inspect(){throw Object.assign(Error('missing'),{code:'session/not-found'});},async create(r?: any){created.push(r);return {sessionId:r.sessionId};}}});
 await executor.ensureSession({sessionId:'dev-a',ticket:{id:'ticket-a'}});await executor.ensureSession({sessionId:'dev-b',ticket:{id:'ticket-b'}});
 assert.notEqual(created[0].cwd,workerRoot);assert.notEqual(created[0].cwd,created[1].cwd);assert.equal(path.dirname(created[0].cwd),path.join(workerRoot,'tasks'));
});

test('missing attached native agent is unknown rather than proof of idle',async()=>{
 const executor=createDshExecutor({controller:{},getAgent:()=>undefined});
 assert.deepEqual(await executor.isRunning({sessionId:'cold'}),{running:null,pending:null});
});

test('new development workspace is published only after confirmed session creation',async (t?: any) =>{
 const workerRoot=fs.mkdtempSync(path.join(os.tmpdir(),'dev-workspace-callback-'));t.after(()=>fs.rmSync(workerRoot,{recursive:true,force:true}));const published=[];let created=false;
 const executor=createDshExecutor({workerRoot,resolveWorker:()=>({mode:'development'}),onWorkspace:async (value?: any) =>{assert.equal(created,true);published.push(value);},controller:{async inspect(){throw Object.assign(Error('missing'),{code:'session/not-found'});},async create(r?: any){created=true;return {sessionId:r.sessionId};}}});
 await executor.ensureSession({sessionId:'dev',ticket:{id:'stable-ticket'}});assert.equal(published.length,1);assert.equal(published[0].ticketId,'stable-ticket');assert.equal(published[0].sessionId,'dev');assert.equal(path.dirname(published[0].cwd),path.join(workerRoot,'tasks'));
 const restored=createDshExecutor({workerRoot,resolveWorker:()=>({mode:'development'}),onWorkspace:async()=>assert.fail('existing session must retain its cwd'),controller:{async inspect(){return {};}}});await restored.ensureSession({sessionId:'old',ticket:{id:'old'}});
 const mismatch=createDshExecutor({workerRoot,resolveWorker:()=>({mode:'development'}),onWorkspace:async()=>assert.fail('unconfirmed mapping'),controller:{async inspect(){throw Object.assign(Error('missing'),{code:'session/not-found'});},async create(){return {sessionId:'different'};}}});await assert.rejects(mismatch.ensureSession({sessionId:'requested',ticket:{id:'requested'}}),/映射/);
});
