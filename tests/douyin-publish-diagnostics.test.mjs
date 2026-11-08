import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as actions from '../platforms/douyin/actions.mjs';
import {createBrowserTransport} from '../platforms/douyin/transport.mjs';
import {createDouyinPlatform} from '../platforms/douyin/index.mjs';
import {sanitizePublisherDiagnostics} from '../platforms/douyin/publish-diagnostics.mjs';

function pageFixture({uploads=[{type:'file',accept:'image/*',visible:false}],editors=[{visible:true}],buttons=[{visible:true}]}={}) {
 const mutations=[];let url='https://www.douyin.com/';
 const locator=rows=>({count:async()=>rows.length,isVisible:async()=>!!rows[0]?.visible,getAttribute:async k=>rows[0]?.[k]??null,nth:i=>locator(rows.slice(i,i+1)),first(){return this;},waitFor:async()=>{},setInputFiles:async()=>mutations.push('upload'),fill:async()=>mutations.push('fill'),click:async()=>mutations.push('click')});
 const p={isClosed:()=>false,setDefaultTimeout(){},url:()=>url,goto:async value=>{url=value;mutations.push('navigate');},locator:selector=>locator(selector.includes('input')?uploads:editors),getByRole:()=>locator(buttons)};
 return {p,mutations};
}

test('publisher diagnostics navigates only fixed creator page and reads bounded control attributes without submitting',async()=>{
 assert.equal(typeof actions.publisherDiagnostics,'function');const f=pageFixture({uploads:[{type:'file',accept:'.png,.jpg',visible:false},{type:'file',accept:'image/*',visible:false}]});
 const result=await actions.publisherDiagnostics(f.p);
 assert.equal(result.state,'observed');assert.equal(result.url,'https://creator.douyin.com/creator-micro/content/upload');assert.equal(result.controls.upload.count,2);assert.equal(result.controls.upload.items[0].accept,'.png,.jpg');assert.deepEqual(f.mutations,['navigate']);
});

test('publish control refusal records exact pre-submit stage and never reaches the request gate',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'douyin-pre-submit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'pong.png');await fs.writeFile(file,Buffer.alloc(20));
 for(const [options,phase] of [[{uploads:[]},'publish_upload_control'],[{editors:[{visible:true},{visible:true}]},'publish_editor_control'],[{buttons:[{visible:true},{visible:true}]},'publish_button_control']]){
  const f=pageFixture(options);f.p.route=async()=>{throw Error('Publish gate must not be reached');};
  const result=await actions.advancedWrite({p:f.p,input:{action:'publish',targetId:'own-public',text:'pong',context:{media:[{path:file}]}},identity:async()=>'123456',receipts:{}});
  assert.equal(result.code,'CONTROL_NOT_UNIQUE');assert.equal(result.phase,phase);assert.equal(result.deliveryState,'not_sent');assert.equal(result.submitted,false);assert.ok(!f.mutations.includes('click'));
 }
});

test('diagnostics uses only existing owned browser and does not launch an owner',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'douyin-diagnostic-owner-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let launches=0;
 const f=pageFixture();f.p.evaluate=async()=>'123456';
 const transport=createBrowserTransport({stateDir:dir,config:{douyin:{chromePath:'fake'}},chromium:{launchPersistentContext:async()=>{launches++;return {pages:()=>[f.p],close:async()=>{}};}}});t.after(()=>transport.close());
 assert.equal(typeof transport.diagnostics,'function');assert.equal((await transport.diagnostics()).code,'OWNER_NOT_RUNNING');assert.equal(launches,0);
 await transport.status();assert.equal((await transport.diagnostics()).state,'observed');assert.equal(launches,1);
});

test('adapter preserves only validated pre-submit refusal evidence and serializes diagnostics',async()=>{
 const source={confirmed:false,state:'refused',code:'CONTROL_NOT_UNIQUE',phase:'publish_upload_control',deliveryState:'not_sent',submitted:false,control:{count:0,visibleCount:0},cookie:'secret'};
 const platform=createDouyinPlatform({stateDir:'unused',idleMs:0,transport:{write:async()=>source,diagnostics:async()=>({state:'observed',url:'https://creator.douyin.com/creator-micro/content/upload',controls:{upload:{count:0,visibleCount:0,items:[]}},cookie:'secret'})}});
 const result=await platform.write({action:'publish',targetId:'own-public',text:'pong',intentId:'one'});assert.equal(result.deliveryState,'not_sent');assert.equal(result.phase,'publish_upload_control');assert.equal(result.cookie,undefined);
 assert.equal(typeof platform.diagnostics,'function');assert.equal((await platform.diagnostics()).cookie,undefined);await platform.close();
});

function delayedUploadFixture({count=1,timeout=false}={}) {
 const f=pageFixture({editors:[{visible:true},{visible:true}]});let attached=false;
 const input={count:async()=>attached?count:0,isVisible:async()=>false,getAttribute:async k=>k==='type'?'file':k==='accept'?'image/*':null,nth(){return this;},first(){return this;},waitFor:async options=>{
  assert.equal(options.state,'attached');assert.ok(Number.isFinite(options.timeout)&&options.timeout>0&&options.timeout<=8000);
  if(timeout){const error=Error('not attached');error.name='TimeoutError';throw error;}
  await new Promise(resolve=>setImmediate(resolve));attached=true;
 },setInputFiles:async()=>{assert.equal(attached,true);f.mutations.push('upload');}};
 const base=f.p.locator;f.p.locator=selector=>selector.includes('input[type="file"]')?input:base(selector);
 return {...f,input};
}

test('diagnostics waits for SPA file inputs to attach after DOMContentLoaded before reporting controls',async()=>{
 const f=delayedUploadFixture();assert.equal(await f.input.count(),0);
 const result=await actions.publisherDiagnostics(f.p);
 assert.equal(result.controls.upload.count,1);assert.equal(result.controls.fileInputs.count,1);assert.deepEqual(f.mutations,['navigate']);
});

test('publish waits for delayed input attachment but preserves duplicate and timeout refusals before submit',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'douyin-attached-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'pong.png');await fs.writeFile(file,Buffer.alloc(20));
 for(const [options,phase,uploaded] of [[{},'publish_editor_control',true],[{count:2},'publish_upload_control',false],[{timeout:true},'publish_upload_control',false]]){
  const f=delayedUploadFixture(options);assert.equal(await f.input.count(),0);
  const result=await actions.advancedWrite({p:f.p,input:{action:'publish',targetId:'own-public',text:'pong',context:{media:[{path:file}]}},identity:async()=>'123456',receipts:{}});
  assert.equal(result.code,'CONTROL_NOT_UNIQUE');assert.equal(result.phase,phase);assert.equal(result.submitted,false);assert.equal(result.deliveryState,'not_sent');assert.equal(f.mutations.includes('upload'),uploaded);assert.ok(!f.mutations.includes('click'));
 }
});

test('diagnostics retains zero control evidence after bounded attachment timeout without mutations',async()=>{
 const f=delayedUploadFixture({timeout:true});const result=await actions.publisherDiagnostics(f.p);
 assert.equal(result.state,'observed');assert.equal(result.controls.upload.count,0);assert.equal(result.controls.fileInputs.count,0);assert.deepEqual(f.mutations,['navigate']);
});

test('diagnostics classifies navigation timeout and closed page without exposing exception details',async()=>{
 for(const closed of [false,true]){
  const f=pageFixture();f.p.isClosed=()=>closed;
  f.p.goto=async()=>{throw Object.assign(Error('secret token and private body'),{name:'TimeoutError'});};
  const result=await actions.publisherDiagnostics(f.p);
  assert.deepEqual(result,{state:'error',code:'DIAGNOSTICS_FAILED',phase:'navigation',errorKind:closed?'page_closed':'timeout'});
 }
});

test('diagnostics identifies the failing DOM control and drops untrusted phase/error values',async()=>{
 const f=pageFixture();const base=f.p.locator;
 f.p.locator=selector=>selector.includes('accept')?{count:async()=>{throw Error('secret');}}:base(selector);
 const result=await actions.publisherDiagnostics(f.p);
 assert.equal(result.phase,'control_upload');assert.equal(result.errorKind,'dom_failed');
 assert.equal(JSON.stringify(result).includes('secret'),false);
 assert.deepEqual(sanitizePublisherDiagnostics({state:'error',code:'DIAGNOSTICS_FAILED',phase:'secret',errorKind:'private body',message:'token'}),{state:'error',code:'DIAGNOSTICS_FAILED'});
});

test('diagnostic deadline returns while a browser operation stalls and never starts later controls',async()=>{
 const f=pageFixture();let release,controls=0;
 f.p.goto=()=>new Promise(resolve=>release=resolve);f.p.locator=()=>{controls++;throw Error('late browser access');};
 const platform=createDouyinPlatform({stateDir:'unused',idleMs:0,diagnosticsTimeoutMs:10,transport:{diagnostics:options=>actions.publisherDiagnostics(f.p,options)}});
 const result=await Promise.race([platform.diagnostics(),new Promise(resolve=>setTimeout(()=>resolve({hung:true}),100))]);
 assert.equal(result.errorKind,'deadline');assert.equal(result.phase,'navigation');
 release();await new Promise(resolve=>setImmediate(resolve));assert.equal(controls,0);await platform.close();
});

test('diagnostics deadline distinguishes an idle-close queue stall and does not execute after expiry',async()=>{
 let release,entered,diagnostics=0;const closing=new Promise(resolve=>entered=resolve);
 const platform=createDouyinPlatform({stateDir:'unused',idleMs:1,diagnosticsTimeoutMs:10,transport:{status:async()=>({state:'ready'}),idleClose:()=>{entered();return new Promise(resolve=>release=resolve);},diagnostics:async()=>{diagnostics++;return {state:'observed'};}}});
 await platform.status();await closing;
 const result=await Promise.race([platform.diagnostics(),new Promise(resolve=>setTimeout(()=>resolve({hung:true}),100))]);
 assert.equal(result.phase,'owner_queue');assert.equal(result.errorKind,'deadline');assert.equal(diagnostics,0);
 release();await new Promise(resolve=>setImmediate(resolve));assert.equal(diagnostics,0);await platform.close();
});

test('diagnostic timeout keeps serial ownership until the underlying operation actually settles',async()=>{
 let release,reads=0;const platform=createDouyinPlatform({stateDir:'unused',idleMs:0,diagnosticsTimeoutMs:10,transport:{diagnostics:()=>new Promise(resolve=>release=resolve),read:async()=>{reads++;return {items:[]};}}});
 const result=await Promise.race([platform.diagnostics(),new Promise(resolve=>setTimeout(()=>resolve({hung:true}),100))]);
 assert.equal(result.phase,'owner_operation');assert.equal(result.errorKind,'deadline');
 const next=platform.read({action:'feed'});await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,0);
 release({state:'observed'});await next;assert.equal(reads,1);await platform.close();
});

test('worker close after a diagnostic deadline still cancels and drains the real browser operation',async()=>{
 const {createWorkerHandler}=await import('../platforms/douyin/user-worker.mjs');let release,cancels=0,closed=false;
 const platform=createDouyinPlatform({stateDir:'unused',idleMs:0,diagnosticsTimeoutMs:10,transport:{status:async()=>({state:'ready'}),diagnostics:()=>new Promise(resolve=>release=resolve),cancel:async()=>{cancels++;release({state:'error'});},close:async()=>{closed=true;}}});
 const handler=createWorkerHandler({createPlatform:()=>platform});await handler({id:1,method:'status',args:{}});
 assert.equal((await handler({id:2,method:'diagnostics',args:{}})).result.errorKind,'deadline');
 const closing=handler.close();await new Promise(resolve=>setTimeout(resolve,20));
 try{assert.equal(cancels,1);assert.equal(closed,true);}finally{release({state:'error'});await closing;}
});
