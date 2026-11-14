import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDouyinPlatform } from '../src/platforms/douyin/index.mjs';

async function fixture(t?: any, transport?: any) {
  const stateDir = await mkdtemp(join(tmpdir(), 'douyin-test-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const platform = createDouyinPlatform({ config: {}, stateDir, transport, idleMs: 0 });
  t.after(() => platform.close());
  return platform;
}

test('exposes stable public items and does not misclassify them as private messages', async (t?: any) => {
  const p = await fixture(t, { status: async () => ({state:'ready', accountId:'123456'}), read: async () => ({items:[{aweme_id:'123456789',desc:'hello',user:{uid:'123456'},status:{private_status:0}},{aweme_id:'bad',desc:'bad'}],hasMore:true}) });
  assert.equal(p.capabilities.dm, true);
  const result = await p.read({action:'feed',limit:10});
  assert.deepEqual(result.items, [{id:'123456789',url:'https://www.douyin.com/video/123456789',text:'hello',kind:'video',visibility:'public',actorId:'123456'}]);
  assert.equal(result.truncated, true);
  assert.equal((await p.read({action:'inbox'})).items.length, 0);
});

test('only operator login exposes QR path and verification state', async (t?: any) => {
  const p = await fixture(t, { status: async () => ({state:'login_required',cookie:'secret'}), login: async () => ({state:'waiting',qrImagePath:'private.png',cookie:'secret'}) });
  assert.deepEqual(await p.status(), {state:'login_required',capabilities:p.capabilities});
  assert.deepEqual(await p.login({action:'start'}), {state:'waiting',qrImagePath:'private.png'});
});

test('unsupported writes never call transport', async (t?: any) => {
  const p = await fixture(t, { write: async () => { throw Error('must not send'); } });
  assert.deepEqual(await p.write({action:'delete',targetId:'123456',text:'test',intentId:'i'}), {confirmed:false,state:'unsupported',code:'UNSUPPORTED'});
});

test('serializes operations and does not leak transport errors', async (t?: any) => {
  let active=0, peak=0;
  const p = await fixture(t,{status:async()=>{ active++; peak=Math.max(peak,active); await new Promise<any | void>((r)=>setTimeout(r,10)); active--; throw Error('secret'); }});
  const results=await Promise.all([p.status(),p.status()]);
  assert.equal(peak,1);
  assert.deepEqual(results.map((x)=>x.code),['TRANSPORT_ERROR','TRANSPORT_ERROR']);
  assert.equal(JSON.stringify(results).includes('secret'),false);
});

test('keeps the login browser alive while waiting for confirmation', async (t?: any) => {
  let idle=0;
  await fixture(t,{login:async()=>({state:'waiting',qrImagePath:'private.png'}),idleClose:async()=>{idle++;}});
  // A separate instance enables a short idle timeout.
  const dir=await mkdtemp(join(tmpdir(),'douyin-login-'));
  const q=createDouyinPlatform({config:{},stateDir:dir,transport:{login:async()=>({state:'waiting',qrImagePath:'private.png'}),idleClose:async()=>{idle++;}},idleMs:5});
  t.after(async()=>{await q.close();await rm(dir,{recursive:true,force:true});});
  await q.login({action:'start'});
  await new Promise<any | void>((r)=>setTimeout(r,20));
  assert.equal(idle,0);
});

test('preserves verification state during polling', async (t?: any) => {
  const p = await fixture(t,{login:async()=>({state:'scanned',cookie:'secret'})});
  assert.deepEqual(await p.login({action:'poll'}),{state:'scanned'});
});

test('does not silently pretend to paginate when the transport has no cursor support', async (t?: any) => {
  const p = await fixture(t,{read:async()=>({items:[]})});
  const result=await p.read({action:'feed',cursor:'10'});
  assert.ok(result.warnings.includes('CURSOR_UNSUPPORTED'));
});

test('cancelled active work triggers transport cancellation and waits for it before close', async (t?: any) => {
  let cancelled=false;
  const p = await fixture(t,{status:({signal}: { signal?: any; [key: string]: any })=>new Promise<any | void>((resolve)=>signal.addEventListener('abort',()=>{cancelled=true;resolve({state:'error'});},{once:true}))});
  const c=new AbortController();
  const pending=p.status({signal:c.signal});
  await new Promise<any | void>((r)=>setTimeout(r,5)); c.abort();
  const result=await pending;
  assert.equal(cancelled,true);
  assert.equal(result.code,'CANCELLED');
});

test('invokes transport cancellation exactly once for an aborted active operation', async (t?: any) => {
  let cancellations=0;
  const p = await fixture(t,{status:({signal}: { signal?: any; [key: string]: any })=>new Promise<any | void>((resolve)=>signal.addEventListener('abort',()=>resolve({state:'error'}),{once:true})),cancel:async()=>{cancellations++;}});
  const c=new AbortController(), pending=p.status({signal:c.signal});
  await new Promise<any | void>((r)=>setTimeout(r,5)); c.abort(); await pending;
  assert.equal(cancellations,1);
});

test('rejects unsafe numeric IDs instead of exposing rounded identifiers', async (t?: any) => {
  const p = await fixture(t,{read:async()=>({items:[{aweme_id:7123456789012345678,desc:'x'},{aweme_id:'7123456789012345678',desc:'y'}]})});
  const result=await p.read({action:'feed'});
  assert.deepEqual(result.items.map((x)=>x.id),['7123456789012345678']);
  assert.ok(result.warnings.includes('ITEMS_WITHOUT_STABLE_IDS_OMITTED'));
});

test('cancellation during browser launch closes the eventual context', async (t?: any) => {
  const {createBrowserTransport}=await import('../src/platforms/douyin/transport.mjs');
  const dir=await mkdtemp(join(tmpdir(),'douyin-launch-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let resolveLaunch, launched; const entered=new Promise<any | void>((r)=>launched=r); let closes=0;
  const context={close:async()=>{closes++;},pages:()=>[],newPage:async()=>({setDefaultTimeout(){},goto:async()=>{},isClosed:()=>false})};
  const chromium={launchPersistentContext:()=>{launched();return new Promise<any | void>((r)=>resolveLaunch=r);}};
  const browser=createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium});
  const operation=browser.status(); await entered;
  const cancelling=browser.cancel(); resolveLaunch(context);
  await cancelling; await assert.rejects(operation);
  assert.equal(closes,1);
});

test('profile network failure is not reported as logged out', async (t?: any) => {
  const {createBrowserTransport}=await import('../src/platforms/douyin/transport.mjs');
  const dir=await mkdtemp(join(tmpdir(),'douyin-status-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const page={isClosed:()=>false,setDefaultTimeout(){},goto:async()=>{},evaluate:async (fn?: any) =>{const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('network')};try{return await fn();}finally{globalThis.fetch=old;}},locator:()=>({innerText:async()=>''})};
  const browser=createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}}); t.after(()=>browser.close());
  await assert.rejects(browser.status());
});

test('unrecognized profile response without a login prompt is an error', async (t?: any) => {
  const {createBrowserTransport}=await import('../src/platforms/douyin/transport.mjs');
  const dir=await mkdtemp(join(tmpdir(),'douyin-unknown-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const page={isClosed:()=>false,setDefaultTimeout(){},goto:async()=>{},evaluate:async()=>'',locator:()=>({innerText:async()=>''}),getByText:()=>({last:()=>({isVisible:async()=>false})})};
  const browser=createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}}); t.after(()=>browser.close());
  assert.equal((await browser.status()).state,'error');
});

test('reports platform captcha iframe as verification required', async (t?: any) => {
  const {createBrowserTransport}=await import('../src/platforms/douyin/transport.mjs'); const dir=await mkdtemp(join(tmpdir(),'douyin-captcha-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const page={isClosed:()=>false,setDefaultTimeout(){},goto:async()=>{},evaluate:async()=>'',frames:()=>[{url:()=> 'https://rmc.bytedance.com/verifycenter/captcha/v2'}],locator:()=>({innerText:async()=>''}),getByText:()=>({last:()=>({isVisible:async()=>false})})};
  const browser=createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}}); t.after(()=>browser.close());
  assert.equal((await browser.status()).state,'verification_required');
});

async function detailFixture(t?: any,{responses=[],captcha=false}: { responses?: any[]; captcha?: boolean; [key: string]: any }={}) {
 const {EventEmitter}=await import('node:events');const {createBrowserTransport}=await import('../src/platforms/douyin/transport.mjs');
 const dir=await mkdtemp(join(tmpdir(),'douyin-detail-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const page=new EventEmitter();Object.assign(page,{isClosed:()=>false,setDefaultTimeout(){},goto:async (url?: any) =>{if(url.includes('/video/'))for(const data of responses)page.emit('response',{url:()=> 'https://www.douyin.com/aweme/v1/web/aweme/detail/',json:async()=>data});},waitForTimeout:async()=>{},frames:()=>captcha?[{url:()=> 'https://rmc.bytedance.com/verifycenter/captcha/v2'}]:[]});
 const transport=createBrowserTransport({stateDir:dir,config:{douyin:{chromePath:'fake'}},chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}});
 return fixture(t,transport);
}

test('detail operation reports a page verification challenge independently of login readiness',async (t?: any) =>{
 const p = await detailFixture(t,{captcha:true});const result=await p.read({action:'detail',id:'7704182557952331049'});
 assert.ok(result.warnings.includes('VERIFICATION_REQUIRED'));assert.equal(result.truncated,true);assert.deepEqual(result.items,[]);
});

test('a rejected detail API response is not a successful empty operation',async (t?: any) =>{
 const p = await detailFixture(t,{responses:[{status_code:4,status_msg:'private diagnostic text'}]});const result=await p.read({action:'detail',id:'7704182557952331049'});
 assert.ok(result.warnings.includes('PLATFORM_API_ERROR'));assert.equal(result.truncated,true);assert.equal(JSON.stringify(result).includes('private diagnostic'),false);
});

test('an unrelated detail response cannot mark the requested detail complete',async (t?: any) =>{
 const p = await detailFixture(t,{responses:[{status_code:0,aweme_detail:{aweme_id:'7704182557952331048',desc:'different'}}]});const result=await p.read({action:'detail',id:'7704182557952331049'});
 assert.deepEqual(result.items,[]);assert.equal(result.truncated,true);assert.ok(result.warnings.includes('INCOMPLETE'));
});

test('detail visibility comes from explicit raw privacy state and cannot default public',async (t?: any) =>{
 const p = await fixture(t,{read:async()=>({items:[{aweme_id:'7704182557952331049',desc:'pong',author:{uid:'123456'},status:{private_status:1}}]})});
 assert.equal((await p.read({action:'detail',id:'7704182557952331049'})).items[0].visibility,'private');
 const q=await fixture(t,{read:async()=>({items:[{aweme_id:'7704182557952331049',desc:'pong',author:{uid:'123456'}}]})});
 assert.equal((await q.read({action:'detail',id:'7704182557952331049'})).items[0].visibility,'unknown');
 const r=await fixture(t,{read:async()=>({items:[{aweme_id:'7704182557952331049',desc:'pong',author:{uid:'123456'},status:{private_status:0}}]})});
 assert.equal((await r.read({action:'detail',id:'7704182557952331049'})).items[0].visibility,'public');
});

test('comment control separates missing, hidden and ambiguous matches before any submit', async (t?: any) => {
  const {createBrowserTransport}=await import('../src/platforms/douyin/transport.mjs');
  const dir=await mkdtemp(join(tmpdir(),'douyin-comment-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const account='111111111',target='222222222',message='333333333';
  const scenarios=[{count:0,visible:0,expect:{code:'CONTROL_NOT_FOUND'}},{count:2,visible:2,expect:{code:'CONTROL_AMBIGUOUS'}},{count:2,visible:1,expect:{confirmed:true}}];
  for(const scenario of scenarios) {
    let gate,sends=0,waiter;
    const detailResponse={url:()=> 'https://www.douyin.com/aweme/v1/web/aweme/detail/',json:async()=>({status_code:0,aweme_detail:{aweme_id:target}})};
    const control={count:async()=>scenario.count,isVisible:async()=>true,click:async()=>{},fill:async()=>{}};
    const visibleControl={count:async()=>scenario.visible,isVisible:async()=>true,click:async()=>{},fill:async()=>{}};
    const page: any={isClosed:()=>false,setDefaultTimeout(){},evaluate:async()=>account,url:()=>`https://www.douyin.com/video/${target}`,goto:async()=>{},
      locator:()=>({...control,filter:()=>visibleControl}),route:async(_p?: any,h?: any)=>{gate=h;},unroute:async()=>{},
      waitForResponse:(p?: any)=>new Promise<any | void>((resolve)=>{let matched=false;try{matched=p(detailResponse);}catch{}if(matched)resolve(detailResponse);else waiter={p,resolve};}),
      keyboard:{press:async()=>{const request={url:()=> 'https://www.douyin.com/aweme/v1/web/comment/publish/',method:()=> 'POST',postData:()=>`aweme_id=${target}&text=hello`};
        await gate({request:()=>request,abort:async()=>{},continue:async()=>{sends++;const response={url:request.url,request:()=>request,json:async()=>({status_code:0,comment:{cid:message,aweme_id:target,user:{uid:account},reply_id:'0'}})};if(waiter?.p(response))waiter.resolve(response);}});}}};
    const browser=createBrowserTransport({config:{douyin:{chromePath:'fake'}},stateDir:dir,chromium:{launchPersistentContext:async()=>({pages:()=>[page],close:async()=>{}})}});
    const result: any=await browser.write({action:'comment',targetId:target,text:'hello'});
    if(scenario.expect.confirmed) {assert.equal(result.confirmed,true,'one visible match among hidden duplicates must submit');assert.equal(sends,1);}
    else {assert.equal(result.code,scenario.expect.code);assert.equal(result.state,'refused');assert.equal(sends,0);assert.equal(result.control?.count,scenario.count);assert.equal(result.control?.visibleCount,scenario.visible);}
    await browser.close();
  }
});

test('headed browser launches with a wide, maximized window so header entries stay visible',async()=>{
 const {browserLaunchArgs,desktopWindowArgs}=await import('../src/platforms/douyin/transport.mjs');
 assert.deepEqual(browserLaunchArgs({headless:false,backend:'x11'}),['--ozone-platform=x11','--window-size=1600,1000','--start-maximized']);
 assert.deepEqual(browserLaunchArgs({headless:true,backend:'x11'}),['--disable-gpu']);
 assert.ok(desktopWindowArgs.every((a)=>typeof a==='string'));
});
