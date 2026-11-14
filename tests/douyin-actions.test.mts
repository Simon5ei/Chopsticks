import test from 'node:test';
import assert from 'node:assert/strict';
import * as transport from '../src/platforms/douyin/transport.mjs';
import {createDouyinPlatform} from '../src/platforms/douyin/index.mjs';
const account='7123456789012345678',target='7234567890123456789',parent='7345678901234567890',message='7456789012345678901';
const conversation=`0:1:${account}:${target}`;
function vi(n?: any){n=BigInt(n);const a=[];do{let b=Number(n&127n);n>>=7n;a.push(b|(n?128:0));}while(n);return Buffer.from(a);}
const v=(f?: any,n?: any)=>Buffer.concat([vi(f*8),vi(n)]),s=(f?: any,t?: any)=>{const b=Buffer.isBuffer(t)?t:Buffer.from(t);return Buffer.concat([vi(f*8+2),vi(b.length),b]);},pb=(...a)=>Buffer.concat(a);

test('reply, publish and DM preserve their binding and accept only matching receipts',async()=>{
  const calls=[];const p=createDouyinPlatform({stateDir:'unused',idleMs:0,transport:{write:async (x?: any) =>{calls.push(x);return {confirmed:true,kind:x.action,targetId:x.targetId,parentId:x.parentId,platformId:message,...(x.action==='publish'?{accountId:account,visibility:'public'}:{})};}}});
  for(const action of ['reply','dm','publish']) {
    const result=await p.write({action,targetId:action==='publish'?'own-public':target,parentId:parent,text:'hello',intentId:action,context:{secUid:'MS4wLjABAAAAexample',media:[{path:'/private/photo.png'}]}});
    assert.equal(result.confirmed,true,action);
  }
  assert.equal(calls[0].parentId,parent);assert.equal(calls[1].context.secUid,'MS4wLjABAAAAexample');
  assert.equal(p.capabilities.inbox,true);await p.close();
});
test('protobuf wire receipts retain full int64 IDs and validate matching envelope commands',()=>{
  assert.equal(typeof transport.decodeImResponse,'function');
  const receipt=pb(v(1,100),v(3,0),s(6,s(100,pb(v(1,message),v(3,0),s(4,'client-1')))));
  assert.deepEqual(transport.decodeImResponse(receipt),{cmd:100,status:0,serverMessageId:message,clientMessageId:'client-1',checkCode:'0'});
  assert.throws(()=>transport.decodeImResponse(Buffer.from([10,255])));
  const req=pb(v(1,100),s(8,s(100,pb(s(1,conversation),v(2,1),s(4,JSON.stringify({text:'hello'})),s(8,'client-1')))));
  assert.deepEqual(transport.decodeImRequest(req),{conversationId:conversation,conversationType:1,clientMessageId:'client-1',text:'hello'});
});
test('protobuf inbox normalizes init messages and marks server failure as incomplete',()=>{
  assert.equal(typeof transport.decodeInbox,'function');
  const msg=pb(s(1,conversation),v(2,1),v(3,message),v(6,7),v(7,target),s(8,JSON.stringify({text:'hello'})),v(10,'1793820000000000'),s(14,'MS4wLjABAAAAexample'));
  const system=pb(s(1,conversation),v(2,1),v(3,parent),v(6,1),v(7,target),s(8,JSON.stringify({tips:'system notice'})));
  const input=pb(v(1,2043),v(3,0),s(6,s(2043,pb(s(1,pb(s(2,msg),s(2,system))),v(2,0)))));
  const result=transport.decodeInbox(input);assert.equal(result.items[0].serverMessageId,message);assert.equal(result.items[0].text,'hello');assert.equal(result.items[0].at,1793820000000);assert.equal(result.incomplete,false);
  assert.equal(result.items.length,1,'system tips are not incoming chat messages');
  assert.equal(transport.decodeInbox(pb(v(1,2043),v(3,1))).incomplete,true);
});
test('reply receipt must bind the immediate parent, including replies to replies',()=>{
  const d={status_code:0,comment:{cid:message,aweme_id:target,user:{uid:account},reply_id:parent,reply_to_reply_id:'7567890123456789012'}};
  assert.equal(transport.confirmCommentReceipt(d,{targetId:target,accountId:account,parentId:parent}).confirmed,false);
  assert.equal(transport.confirmCommentReceipt(d,{targetId:target,accountId:account,parentId:'7567890123456789012'}).confirmed,true);
});
test('DM receipt requires server ID, client correlation, exact peer and unchanged account',()=>{
  assert.equal(typeof transport.confirmDmReceipt,'function');
  const proof={status:0,serverMessageId:message,clientMessageId:'client-1',conversationId:conversation,accountBefore:account,accountAfter:account,request:{conversationId:conversation,conversationType:1,clientMessageId:'client-1',text:'hello'}};
  const expected={targetId:target,accountId:account,text:'hello'};
  assert.equal(transport.confirmDmReceipt(proof,expected).confirmed,true);
  for(const bad of [{...proof,status:1},{...proof,serverMessageId:''},{...proof,clientMessageId:'other'},{...proof,accountAfter:target},{...proof,request:{...proof.request,conversationId:`0:1:${account}:999999`}},{...proof,request:{...proof.request,text:'different'}}]) assert.equal(transport.confirmDmReceipt(bad,expected).confirmed,false);
});
test('publishing needs returned item ID and reread author and content',()=>{
  assert.equal(typeof transport.confirmPublishReceipt,'function');
  const proof={status_code:0,item_id:message,accountBefore:account,accountAfter:account,after:{aweme_id:message,author:{uid:account},desc:'hello',status:{private_status:0}}};
  assert.equal(transport.confirmPublishReceipt(proof,{accountId:account,text:'hello'}).confirmed,true);
  assert.equal(transport.confirmPublishReceipt({...proof,after:{...proof.after,desc:'Title\nhello'}},{accountId:account,text:'hello',title:'Title'}).confirmed,true);
  for(const bad of [{...proof,item_id:7456789012345678901},{...proof,after:{...proof.after,author:{uid:target}}},{...proof,accountAfter:target},{...proof,after:{...proof.after,desc:'other'}}]) assert.equal(transport.confirmPublishReceipt(bad,{accountId:account,text:'hello'}).confirmed,false);
});
test('inbox only exposes stable incoming direct messages in private scope',async()=>{
  const raw={serverMessageId:message,conversationId:conversation,conversationType:1,sender:target,text:'private',secUid:'MS4wLjABAAAAexample',at:1793820000000};
  const p=createDouyinPlatform({stateDir:'unused',idleMs:0,transport:{read:async()=>({accountId:account,items:[raw,{...raw,conversationType:2},{...raw,sender:account}],incomplete:false})}});
  const result=await p.read({action:'inbox'});assert.equal(result.items.length,1);assert.equal(result.items[0].visibility,'private');assert.equal(result.items[0].actorId,target);assert.equal(result.items[0].id,message);assert.equal(result.items[0].kind,'message');assert.equal(result.items[0].at,1793820000000);await p.close();
  assert.deepEqual(result.warnings,[],'expected group/self filtering is not a failed inbox read');
});
test('public comment notifications preserve source post and reply target separately from DMs',async()=>{
  const p=createDouyinPlatform({stateDir:'unused',idleMs:0,transport:{read:async()=>({items:[{nid_str:message,type:2,comment_notice:{comment:{cid:parent,aweme_id:target,text:'comment',user:{uid:account}}}}],incomplete:false})}});
  const r=await p.read({action:'notifications'});assert.equal(r.items.length,1);assert.equal(r.items[0].id,message);assert.equal(r.items[0].visibility,'public');assert.equal(r.items[0].targetId,target);assert.equal(r.items[0].parentId,parent);await p.close();
});
test('reply notifications choose the incoming author rather than the quoted own comment',async()=>{
  const p=createDouyinPlatform({stateDir:'unused',idleMs:0,transport:{read:async()=>({accountId:account,items:[{nid_str:message,create_time:1793820000,comment_notice:{from_user:{uid:target},comment:{cid:'7567890123456789012',aweme_id:target,text:'own',user:{uid:account}},reply_comment:{cid:parent,aweme_id:target,text:'incoming',user:{uid:target}}}}]})}});
  const r=await p.read({action:'notifications'});assert.equal(r.items.length,1);assert.equal(r.items[0].parentId,parent);assert.equal(r.items[0].text,'incoming');assert.equal(r.items[0].at,1793820000000);await p.close();
});
test('network guard aborts wrong-target submissions before sending and permits one matching request',async()=>{
  assert.equal(typeof transport.guardedSubmit,'function');
  for(const valid of [false,true]) {
    let handler,accept,continued=0,aborted=0;const request={url:()=> 'https://www.douyin.com/aweme/v1/web/comment/publish/',method:()=> 'POST'};
    const page={route:async(_p?: any,h?: any)=>handler=h,unroute:async()=>{handler=undefined;},waitForResponse:()=>new Promise<any | void>((r)=>accept=r)};
    const result=await transport.guardedSubmit({page,host:'www.douyin.com',path:'/aweme/v1/web/comment/publish/',validate:async()=>valid,submit:async()=>{await handler({request:()=>request,continue:async()=>{continued++;accept({request:()=>request});},abort:async()=>{aborted++;}});}});
    assert.equal(continued,valid?1:0);assert.equal(aborted,valid?0:1);assert.equal(result.submitted,valid);assert.equal(result.blocked,!valid);
    assert.equal(typeof handler,'function','guard must survive SDK retry after receipt');
    await handler({request:()=>request,continue:async()=>{continued++;},abort:async()=>{aborted++;}});
    assert.equal(continued,valid?1:0);
  }
});
test('concurrent requests awaiting validation can transmit at most once',async()=>{
  let handler,resolveResponse,release,continued=0;const validation=new Promise<any | void>((r)=>release=r);
  const page={route:async(_p?: any,h?: any)=>handler=h,unroute:async()=>{},waitForResponse:()=>new Promise<any | void>((r)=>resolveResponse=r)};
  const request=()=>({url:()=> 'https://imapi.douyin.com/v1/message/send',method:()=> 'POST'});
  const result=await transport.guardedSubmit({page,host:'imapi.douyin.com',path:'/v1/message/send',validate:async()=>{await validation;return true;},submit:async()=>{const routes=[request(),request()].map((r)=>handler({request:()=>r,abort:async()=>{},continue:async()=>{continued++;resolveResponse({request:()=>r});}}));release();await Promise.all(routes);}});
  assert.equal(result.submitted,true);assert.equal(continued,1);
});
test('inbox waits for native IM initialization instead of reporting an early empty snapshot',async (t?: any) =>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'douyin-inbox-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let listener;const response={url:()=> 'https://imapi.douyin.com/v1/message/get_message_by_init',body:async()=>pb(v(1,2043),v(3,0),s(6,s(2043,v(2,0))))};
  const p={isClosed:()=>false,setDefaultTimeout(){},evaluate:async()=>account,goto:async()=>{},on:(_n?: any,f?: any)=>listener=f,off(){},waitForTimeout:async()=>{},waitForResponse:()=>new Promise<any | void>((resolve)=>setImmediate(()=>{listener(response);resolve(response);})),locator:()=>({count:async()=>1,click:async()=>{},waitFor:async()=>{}})};
  const b=transport.createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[p],close:async()=>{}})}});t.after(()=>b.close());const r=await b.read({action:'inbox',limit:10});assert.equal(r.incomplete,false);assert.deepEqual(r.items,[]);
});
test('comment and like abort actual wrong-target requests before network delivery',async (t?: any) =>{
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'douyin-gate-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  for(const action of ['comment','like']) {
    let gate,waiter,delivered=0;const detail={url:()=> 'https://www.douyin.com/aweme/v1/web/aweme/detail/',json:async()=>({status_code:0,aweme_detail:{aweme_id:target,user_digged:0}})};
    const send=async()=>{const path=action==='like'?'/aweme/v1/web/commit/item/digg/':'/aweme/v1/web/comment/publish/';const request={url:()=> 'https://www.douyin.com'+path,method:()=> 'POST',postData:()=> 'aweme_id=999999&type=1&text=hello'};const response={url:request.url,request:()=>request,json:async()=>({status_code:0})};const proceed=async()=>{delivered++;if(waiter.p(response))waiter.resolve(response);};if(gate)await gate({request:()=>request,continue:proceed,abort:async()=>{}});else await proceed();};
    const control={count:async()=>1,isVisible:async()=>true,click:async()=>{if(action==='like')await send();},fill:async()=>{}};
    const page: any={isClosed:()=>false,setDefaultTimeout(){},evaluate:async()=>account,url:()=>`https://www.douyin.com/video/${target}`,goto:async (u?: any) =>{if(u.includes('/video/')&&waiter?.p(detail))waiter.resolve(detail);},locator:()=>control,keyboard:{press:send},route:async(_p?: any,h?: any)=>gate=h,unroute:async()=>{},waitForResponse:(p)=>new Promise<any | void>((resolve)=>waiter={p,resolve})};
    const b=transport.createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}});const result=await b.write({action,targetId:target,text:'hello'});assert.equal(delivered,0,action);assert.equal(result.state,'refused');await b.close();
  }
});
test('browser reply, DM and publish execute normal controls and require actual bound response',async (t?: any) =>{
  const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'douyin-actions-'));t.after(()=>rm(dir,{recursive:true,force:true}));await writeFile(join(dir,'photo.png'),'fixture');
  for(const {action,readbackFailure} of [{action:'reply'},{action:'dm'},{action:'publish'},{action:'publish',readbackFailure:true}]) {
    const listeners=new Set<any>(),waiters=[];let routeHandler,currentUrl='',sends=0,editorReady=action!=='dm';
    const emit=(response)=>{for(const fn of listeners)fn(response);for(const w of waiters)if(w.p(response))w.resolve(response);};
    const response=(url?: any,data?: any,request?: any)=>({url:()=>url,json:async()=>url.includes('/profile/other/')?{...data,user:{...data.user,nickname:'Fixture peer'}}:data,body:async()=>data,request:()=>request});
    const send=async()=>{let url,body,data;
      if(action==='reply'){url='https://www.douyin.com/aweme/v1/web/comment/publish/';body=`aweme_id=${target}&reply_id=${parent}&text=hello`;data={status_code:0,comment:{cid:message,aweme_id:target,user:{uid:account},reply_id:parent}};}
      if(action==='dm'){url='https://imapi.douyin.com/v1/message/send';body=pb(v(1,100),s(8,s(100,pb(s(1,conversation),v(2,1),s(4,JSON.stringify({text:'hello'})),s(8,'client-1')))));data=pb(v(1,100),v(3,0),s(6,s(100,pb(v(1,message),v(3,0),s(4,'client-1')))));}
      if(action==='publish'){url='https://creator.douyin.com/web/api/media/aweme/create_v2/';body=JSON.stringify({text:'hello'});data={status_code:0,item_id:message};}
      const request={url:()=>url,method:()=> 'POST',postData:()=>String(body),postDataBuffer:()=>Buffer.from(body)};
      await routeHandler({request:()=>request,abort:async()=>{},continue:async()=>{sends++;emit(response(url,data,request));}});
    };
    const control={count:async()=>1,isVisible:async()=>true,click:async()=>{},fill:async()=>{},setInputFiles:async()=>{},filter(){return this;},locator(){return this;},getByText(){return this;},first(){return this;},last(){return this;},waitFor:async()=>{}};
    const page: any={isClosed:()=>false,frames:()=>[],setDefaultTimeout(){},url:()=>currentUrl,evaluate:async()=>account,on:(_n?: any,fn?: any)=>listeners.add(fn),off:(_n?: any,fn?: any)=>listeners.delete(fn),waitForTimeout:async()=>{},route:async(_p?: any,h?: any)=>routeHandler=h,unroute:async()=>{},waitForResponse:(p)=>new Promise<any | void>((resolve)=>waiters.push({p,resolve})),locator:()=>control,getByPlaceholder:()=>control,getByText:()=>({...control,count:async()=>2,filter:()=>control}),getByRole:(_r?: any,o?: any)=>o?.name==='发布'?{...control,click:send}:control,keyboard:{press:send},goto:async (url?: any) =>{currentUrl=url;if(url.includes('/video/')||url.includes('/note/')){const id=url.split('/').pop();emit(response('https://www.douyin.com/aweme/v1/web/aweme/detail/',{status_code:0,aweme_detail:{aweme_id:id,desc:'hello',author:{uid:account},status:{private_status:0}}}));emit(response('https://www.douyin.com/aweme/v1/web/comment/list/',{status_code:0,comments:[{cid:parent,aweme_id:target,text:'parent',user:{uid:target,sec_uid:'MS4wLjABAAAAexample'}}]}));}if(url.includes('/user/'))emit(response('https://www.douyin.com/aweme/v1/web/user/profile/other/',{status_code:0,user:{uid:target,sec_uid:'MS4wLjABAAAAexample'}}));}};
    const baseEvaluate=page.evaluate;page.evaluate=((fn?: any,arg?: any)=>typeof arg==='string'&&arg.includes('/profile/other/')?Promise.resolve({status_code:0,user:{uid:target,sec_uid:'MS4wLjABAAAAexample',nickname:'Fixture peer'}}):baseEvaluate(fn,arg) as any);
    const baseLocator=page.locator;page.locator=((selector)=>selector.includes('msg-input')?{...control,isVisible:async()=>editorReady}:selector.includes('conversationConversationItemwrapper')?{...control,click:async()=>{editorReady=true;}}:selector.includes('im-entry')?{...control,click:async()=>emit(response('https://imapi.douyin.com/v1/message/get_message_by_init',{}))}:baseLocator(selector) as any);
    const baseGoto=page.goto;page.goto=async (url?: any) =>{if(readbackFailure&&url.includes('/note/'))throw Error('readback unavailable');await baseGoto(url);if(url.includes('/user/'))emit(response('https://www.douyin.com/aweme/v1/web/user/profile/other/',{status_code:0,user:{uid:target,sec_uid:'MS4wLjABAAAAexample',nickname:'Fixture peer'}}));};
    const browser=transport.createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}});
    const result=await browser.write({action,targetId:action==='publish'?'own-public':target,parentId:parent,text:'hello',context:{secUid:'MS4wLjABAAAAexample',media:[{path:join(dir,'photo.png')}]}});
    if(readbackFailure){assert.equal(result.confirmed,false);assert.equal(result.state,'uncertain');assert.equal(result.receiptId,message);assert.equal(result.accountId,account);}else assert.equal(result.confirmed,true,action);assert.equal(sends,1);await browser.close();
  }
});

test('published public receipt requires explicit audience proof and carries authenticated account',()=>{
 const proof={status_code:0,item_id:message,accountBefore:account,accountAfter:account,after:{aweme_id:message,author:{uid:account},desc:'pong',status:{private_status:0,is_private:false}}};
 const result: any=transport.confirmPublishReceipt(proof,{accountId:account,text:'pong'});
 assert.equal(result.accountId,account);assert.equal(result.visibility,'public');
 for(const status of [undefined,{}, {private_status:1},{private_status:2},{private_status:0,is_private:true},{private_status:0,part_see:1},{private_status:0,in_reviewing:true}]){
  assert.equal(transport.confirmPublishReceipt({...proof,after:{...proof.after,status}},{accountId:account,text:'pong'}).confirmed,false);
 }
});

test('adapter preserves accepted publication ID and account when readback is uncertain',async()=>{
 const p=createDouyinPlatform({stateDir:'unused',idleMs:0,transport:{write:async()=>({confirmed:false,state:'uncertain',code:'UNVERIFIED_RECEIPT',receiptId:message,accountId:account,secret:'hidden'})}});
 const r=await p.write({action:'publish',targetId:'own-public',text:'pong',intentId:'one'});
 assert.deepEqual(r,{confirmed:false,state:'uncertain',code:'UNVERIFIED_RECEIPT',receiptId:message,accountId:account});await p.close();
});

test('publish refuses a changed prepared account before opening creator or uploading',async()=>{
 const {advancedWrite}=await import('../src/platforms/douyin/actions.mjs');let touched=0;
 const r=await advancedWrite({p:{goto:async()=>{touched++;}},input:{action:'publish',targetId:'own-public',text:'pong',context:{accountId:target}},identity:async()=>account,receipts:{}});
 assert.equal(r.code,'ACCOUNT_CHANGED');assert.equal(r.state,'refused');assert.equal(touched,0);
});

test('adapter cannot confirm a publish without authenticated account and public audience proof',async()=>{
 for(const extra of [{},{accountId:account},{accountId:account,visibility:'private'}]){
  const p=createDouyinPlatform({stateDir:'unused',idleMs:0,transport:{write:async()=>({confirmed:true,kind:'publish',targetId:'own-public',platformId:message,...extra})}});
  assert.equal((await p.write({action:'publish',targetId:'own-public',text:'pong',intentId:'one'})).confirmed,false);await p.close();
 }
});

test('peer lookup uses the production conversation row markers and searches before giving up',async()=>{
 const {locatePeerConversation}=await import('../src/platforms/douyin/actions.mjs');
 const make=(appearAfterSearch,textFallback=0,inRow=-1)=> {
  let searched=false;
  const titled={filter(){return this;},first(){return this;},async waitFor(){if(!appearAfterSearch||searched)return;throw Object.assign(Error('timeout'),{name:'TimeoutError'});},async count(){return appearAfterSearch?(searched?1:0):0;}};
  const plain={filter(){return this;},first(){return this;},async waitFor(){if(!appearAfterSearch)throw Object.assign(Error('timeout'),{name:'TimeoutError'});},async count(){return appearAfterSearch?(searched?1:0):0;}};
  const title={getByText(){return title;}};
  let cold=false;const base={filter(opts?: any){return opts?.has?titled:plain;},async count(){return 0;},first(){return this;},async waitFor(){if(cold)return;cold=true;throw Object.assign(Error('t'),{name:'TimeoutError'});}};
  const search={first(){return this;},async count(){return 1;},async isVisible(){return true;},async fill(){searched=true;}};
  const textHit={filter(){return this;},async count(){return textFallback;},async evaluateAll(){return inRow;},nth(){return this;},async evaluate(){return true;},first(){return this;},async isVisible(){return true;},async click(){}};const p={locator(sel?: any){if(String(sel).includes('conversationConversationItemtitle'))return title;if(String(sel).includes('搜索'))return search;return base;},getByText(){return textHit;},waitForTimeout:async()=>{}};
  return p;
 };
 const hit=await locatePeerConversation({p:make(true),nickname:'小明'});
 assert.equal(hit.found,true);assert.equal(hit.searched,true);
 const miss=await locatePeerConversation({p:make(false),nickname:'小明'});
 assert.equal(miss.found,false);assert.equal(miss.searched,true);
 const multi=await locatePeerConversation({p:make(false,9,2),nickname:'小明'});assert.equal(multi.found,true);assert.equal(multi.viaText,true);assert.equal(multi.count,1);
 const viaText=await locatePeerConversation({p:make(false,1),nickname:'小明'});assert.equal(viaText.found,true);assert.equal(viaText.viaText,true);
 const direct=await locatePeerConversation({p:make(true),nickname:'小明'});
 assert.equal(direct.found,true);
 const rowsSel=await import('../src/platforms/douyin/actions.mjs');
 assert.match(rowsSel.CONVERSATION_ROWS,/data-e2e="conversation-item"/);
});

test('missing profile nickname is reported separately from rows that do not match',async()=>{
 const {advancedWrite}=await import('../src/platforms/douyin/actions.mjs');
 const control={count:async()=>1,isVisible:async()=>true,filter(){return this;},first(){return this;},getByText(){return this;},waitFor:async()=>{},click:async()=>{},fill:async()=>{}};
 const page: any={url:()=> 'https://www.douyin.com/jingxuan',evaluate:async()=>({status_code:0,user:{uid:'222222222',sec_uid:'MS4wLjABAAAAfixture'}}),locator:()=>control,waitForResponse:()=>new Promise(()=>{}),goto:async()=>{}};
 const reports=[];const r: any=await advancedWrite({p:page,input:{action:'dm',targetId:'222222222',text:'hello',context:{secUid:'MS4wLjABAAAAfixture'}},identity:async()=> '111111111',receipts:{},report:async(d)=>reports.push(d)});assert.equal(reports[0].branch,'no_nickname');
 assert.equal(r.code,'PEER_NAME_MISSING');assert.equal(r.state,'refused');
});
