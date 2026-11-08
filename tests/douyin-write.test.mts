import test from 'node:test';
import assert from 'node:assert/strict';
import * as transport from '../src/platforms/douyin/transport.mjs';
import {createDouyinPlatform} from '../src/platforms/douyin/index.mjs';
const account='7123456789012345678', target='7234567890123456789', cid='7345678901234567890';
test('comment receipt requires successful response with matching stable target, author and parent',()=>{
  assert.equal(typeof transport.confirmCommentReceipt,'function');
  const base={status_code:0,comment:{cid,aweme_id:target,user:{uid:account},reply_id:'0'}};
  assert.deepEqual(transport.confirmCommentReceipt(base,{targetId:target,accountId:account}),{confirmed:true,platformId:cid,targetId:target,kind:'comment'});
  for(const bad of [{...base,status_code:1},{...base,comment:{...base.comment,cid:7345678901234567890}},{...base,comment:{...base.comment,aweme_id:'999999'}},{...base,comment:{...base.comment,user:{uid:'999999'}}},{...base,comment:{...base.comment,reply_id:'7654321'}},{status_code:0}]) assert.equal(transport.confirmCommentReceipt(bad,{targetId:target,accountId:account}).confirmed,false);
  const reply={...base,comment:{...base.comment,reply_id:'7654321'}};
  assert.equal(transport.confirmCommentReceipt(reply,{targetId:target,accountId:account,parentId:'7654321'}).confirmed,true);
});
test('like receipt requires target-bound successful request and authenticated after state',()=>{
  assert.equal(typeof transport.confirmLikeReceipt,'function');
  const proof={status_code:0,targetId:target,accountBefore:account,accountAfter:account,after:{aweme_id:target,user_digged:1}};
  assert.deepEqual(transport.confirmLikeReceipt(proof,{targetId:target,accountId:account}),{confirmed:true,platformId:target,targetId:target,kind:'like'});
  for(const bad of [{...proof,status_code:1},{...proof,targetId:'999999'},{...proof,accountAfter:'999999'},{...proof,after:{aweme_id:target,user_digged:0}},{...proof,after:{aweme_id:'999999',user_digged:1}}]) assert.equal(transport.confirmLikeReceipt(bad,{targetId:target,accountId:account}).confirmed,false);
});
test('adapter sends once and classifies ambiguous or unsafe writes',async()=>{
  let calls=0; const browser={write:async()=>{calls++;throw Error('ambiguous');},close:async()=>{}};
  const p=createDouyinPlatform({stateDir:'unused',transport:browser,idleMs:0});
  assert.equal((await p.write({action:'comment',targetId:target,text:'hello',intentId:'one'})).state,'uncertain');
  assert.equal(calls,1);
  assert.equal((await p.write({action:'reply',targetId:target,parentId:cid,text:'hello',intentId:'two'})).state,'uncertain');
  assert.equal(calls,2); await p.close();
});

test('adapter accepts only matching transport receipts and refuses invalid or unsupported inputs',async()=>{
  let calls=0; const browser={write:async()=>{calls++;return {confirmed:true,platformId:cid,targetId:target,kind:'comment',secret:'hidden'};},close:async()=>{}};
  const p=createDouyinPlatform({stateDir:'unused',transport:browser,idleMs:0});
  assert.deepEqual(await p.write({action:'comment',targetId:target,text:'hello',intentId:'i'}),{confirmed:true,platformId:cid,targetId:target,kind:'comment'});
  assert.equal((await p.write({action:'comment',targetId:'bad',text:'x',intentId:'i'})).state,'refused');
  assert.equal((await p.write({action:'publish',intentId:'i'})).state,'refused');
  assert.equal(calls,1);await p.close();
});

test('browser submits a comment once only after target and account verification',async (t?: any) =>{
  const {createBrowserTransport}=transport; const {mkdtemp,rm}=await import('node:fs/promises'); const {tmpdir}=await import('node:os'); const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'dy-write-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let waiter,submits=0,gate; const deliver=(r)=>{if(waiter&&waiter.predicate(r)){waiter.resolve(r);waiter=undefined;}};const emit=async (r?: any) =>{if(gate&&r.url().includes('/comment/publish/'))await gate({request:()=>r.request(),continue:async()=>deliver(r),abort:async()=>{}});else deliver(r);}; const response=(path?: any,data?: any,post: string='')=>{const request={method:()=> 'POST',postData:()=>post,url:()=>`https://www.douyin.com${path}`};return {url:()=>request.url(),json:async()=>data,request:()=>request};};
  const input={count:async()=>1,isVisible:async()=>true,click:async()=>{},fill:async()=>{}};
  const page: any={isClosed:()=>false,setDefaultTimeout(){},evaluate:async()=>account,waitForResponse:(predicate)=>new Promise<any | void>((resolve)=>{waiter={predicate,resolve};}),url:()=>`https://www.douyin.com/video/${target}`,goto:async (url?: any) =>{if(url.includes('/video/'))emit(response('/aweme/v1/web/aweme/detail/',{status_code:0,aweme_detail:{aweme_id:target}}));},locator:()=>input,keyboard:{press:async (key?: any) =>{if(key==='Enter'){submits++;emit(response('/aweme/v1/web/comment/publish/',{status_code:0,comment:{cid,aweme_id:target,user:{uid:account},reply_id:'0'}},`aweme_id=${target}&text=hello`));}},insertText:async()=>{}}};
  page.route=async(_p?: any,h?: any)=>{gate=h;};page.unroute=async()=>{};
  const b=createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}});t.after(()=>b.close());
  assert.deepEqual(await b.write({action:'comment',targetId:target,text:'hello'}),{confirmed:true,platformId:cid,targetId:target,kind:'comment'});assert.equal(submits,1);
});

test('browser like requires a bound network response and rechecked liked detail',async (t?: any) =>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'); const dir=await mkdtemp(join(tmpdir(),'dy-like-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let waiter,clicks=0,detailCalls=0,gate;const deliver=(r)=>{if(waiter&&waiter.predicate(r)){waiter.resolve(r);waiter=undefined;}};const emit=async (r?: any) =>{if(gate&&r.url().includes('/commit/item/digg/'))await gate({request:()=>r.request(),continue:async()=>deliver(r),abort:async()=>{}});else deliver(r);};
  const response=(path?: any,data?: any,post: string='')=>{const request={method:()=> 'POST',postData:()=>post,url:()=>`https://www.douyin.com${path}`};return {url:()=>request.url(),json:async()=>data,request:()=>request};};
  const control={count:async()=>1,isVisible:async()=>true,click:async()=>{clicks++;emit(response('/aweme/v1/web/commit/item/digg/',{status_code:0},`aweme_id=${target}&type=1`));}};
  const page: any={isClosed:()=>false,setDefaultTimeout(){},evaluate:async()=>account,waitForResponse:(predicate)=>new Promise<any | void>((resolve)=>{waiter={predicate,resolve};}),url:()=>`https://www.douyin.com/video/${target}`,goto:async (url?: any) =>{if(url.includes('/video/'))emit(response('/aweme/v1/web/aweme/detail/',{status_code:0,aweme_detail:{aweme_id:target,user_digged:detailCalls++?1:0}}));},locator:()=>control};
  page.route=async(_p?: any,h?: any)=>{gate=h;};page.unroute=async()=>{};
  const browser=transport.createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}});t.after(()=>browser.close());
  assert.deepEqual(await browser.write({action:'like',targetId:target}),{confirmed:true,platformId:target,targetId:target,kind:'like'});assert.equal(clicks,1);
});

test('browser refuses before submitting if detail target does not match',async (t?: any) =>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'dy-bound-'));t.after(()=>rm(dir,{recursive:true,force:true}));let waiter,clicks=0;
  const r={url:()=> 'https://www.douyin.com/aweme/v1/web/aweme/detail/',json:async()=>({status_code:0,aweme_detail:{aweme_id:'999999'}})};
  const page={isClosed:()=>false,setDefaultTimeout(){},evaluate:async()=>account,waitForResponse:(predicate)=>new Promise<any | void>((resolve)=>{waiter=()=>{if(predicate(r))resolve(r);};}),url:()=>`https://www.douyin.com/video/${target}`,goto:async (url?: any) =>{if(url.includes('/video/'))waiter();},locator:()=>({count:async()=>1,isVisible:async()=>true,click:async()=>{clicks++;}})};
  const browser=transport.createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}});t.after(()=>browser.close());
  assert.deepEqual(await browser.write({action:'like',targetId:target}),{confirmed:false,state:'refused',code:'TARGET_UNVERIFIED'});assert.equal(clicks,0);
});

test('comment acknowledgement with no explicit root-parent evidence stays uncertain',()=>{
  const response={status_code:0,comment:{cid,aweme_id:target,user:{uid:account}}};
  assert.equal((transport.confirmCommentReceipt(response,{targetId:target,accountId:account}) as any).state,'uncertain');
});
