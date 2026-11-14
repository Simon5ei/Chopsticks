import test from 'node:test';
import assert from 'node:assert/strict';
import {advancedWrite} from '../src/platforms/douyin/actions.mjs';
const account='111111111',peer='222222222',other='333333333',sec='MS4wLjABAAAAfixture';
const conversation=`0:1:${account}:${peer}`;
const vi=(n)=>{n=BigInt(n);const out=[];do{const b=Number(n&127n);n>>=7n;out.push(b|(n?128:0));}while(n);return Buffer.from(out);};
const v=(f?: any,n?: any)=>Buffer.concat([vi(f*8),vi(n)]),s=(f?: any,x?: any)=>{const b=Buffer.isBuffer(x)?x:Buffer.from(x);return Buffer.concat([vi(f*8+2),vi(b.length),b]);},pb=(...x)=>Buffer.concat(x);
function fixture({rows=1,cached=false,initResponse=true,requestPeer=peer,requestConversation,requestText='hello',requestType=1,identityChanged=false,receiptMissing=false}: { rows?: number; cached?: boolean; initResponse?: boolean; requestPeer?: any; requestConversation?: any; requestText?: string; requestType?: number; identityChanged?: boolean; receiptMissing?: boolean; [key: string]: any }={}){
 const seen={navigations:0,profileClicks:0,entryClicks:0,rowWaits:0,sends:0,blocked:0,filled:0};let entryReady=false,rowReady=cached,editorReady=false,initialized=cached,gate,identityCalls=0;const waiters=[];
 const control={count:async()=>1,isVisible:async()=>true,filter(){return this;},first(){return this;},getByText(){return this;},waitFor:async()=>{},click:async()=>{},fill:async()=>{seen.filled++;}};
 const entry={...control,waitFor:async()=>{entryReady=true;},click:async()=>{assert.equal(entryReady,true);seen.entryClicks++;setImmediate(()=>{initialized=true;if(initResponse)emit({url:()=>'https://imapi.douyin.com/v1/message/get_message_by_init'});});}};
 const row={...control,count:async()=>rowReady?rows:0,waitFor:async()=>{seen.rowWaits++;assert.equal(seen.entryClicks,cached?0:1);if(!initialized)await new Promise<any | void>((r)=>setImmediate(r));if(!initialized||!rows)throw Object.assign(Error('not present'),{name:'TimeoutError'});rowReady=true;},click:async()=>{editorReady=true;}};
 const editor={...control,isVisible:async()=>editorReady,waitFor:async()=>assert.equal(editorReady,true)};
 const emit=(r)=>{for(const w of waiters)if(w.p(r))w.resolve(r);};
 const page={
  url:()=> 'https://www.douyin.com/jingxuan',
  evaluate:async(fn?: any,url?: any)=>{assert.match(url,/^https:\/\/www\.douyin\.com\/aweme\/v1\/web\/user\/profile\/other\//);return {status_code:0,user:{uid:peer,sec_uid:sec,nickname:'Fixture peer'}};},
  locator:(selector)=>selector.includes('im-entry')?entry:selector.includes('conversationConversationItemwrapper')?row:selector==='[data-e2e="msg-input"] .editor-kit-container[contenteditable="true"]'?editor:{...control,count:async()=>0,waitFor:async()=>{throw Object.assign(Error('absent control'),{name:'TimeoutError'});}},
  getByText:()=>({...control,count:async()=>0,click:async()=>{seen.profileClicks++;}}),
  goto:async (url?: any) =>{seen.navigations++;if(url.includes('/user/'))emit({url:()=> 'https://www.douyin.com/aweme/v1/web/user/profile/other/',json:async()=>({status_code:0,user:{uid:peer,sec_uid:sec,nickname:'Fixture peer'}})});},
  waitForResponse:(p)=>!initResponse&&p({url:()=>'https://imapi.douyin.com/v1/message/get_message_by_init',request:()=>({})})?Promise.reject(Object.assign(Error('cached inbox sends no init request'),{name:'TimeoutError'})):new Promise<any | void>((resolve)=>waiters.push({p,resolve:(r)=>{if(r.url?.().includes('get_message_by_init'))initialized=true;resolve(r);}})),
  route:async(_matcher?: any,handler?: any)=>{gate=handler;},unroute:async()=>{},on(){},off(){},mainFrame:()=>page,
  keyboard:{press:async()=>{
   const body=pb(v(1,100),s(8,s(100,pb(s(1,requestConversation??`0:1:${account}:${requestPeer}`),v(2,requestType),s(4,JSON.stringify({text:requestText})),s(8,'client-fixture')))));
   const request={url:()=> 'https://imapi.douyin.com/v1/message/send',method:()=> 'POST',postDataBuffer:()=>body};
   const route={request:()=>request,abort:async()=>{seen.blocked++;},continue:async()=>{seen.sends++;emit({request:()=>request,body:async()=>receiptMissing?Buffer.alloc(0):pb(v(1,100),v(3,0),s(6,s(100,pb(v(1,444444444),v(3,0),s(4,'client-fixture')))))});}};
   await gate(route);await gate(route);
  }}
 };
 return {seen,run:(context: Record<string, any>={secUid:sec,conversationId:conversation})=>advancedWrite({p:page,input:{action:'dm',targetId:peer,text:'hello',context},identity:async()=>identityChanged&&identityCalls++>0?other:account,receipts:{dm:async()=>({confirmed:true})}})};
}
test('DM uses web IM entry and waits for delayed conversation before filling',async()=>{
 const f=fixture();assert.equal((await f.run()).confirmed,true);assert.equal(f.seen.profileClicks,0);assert.equal(f.seen.entryClicks,1);assert.equal(f.seen.rowWaits,1);assert.equal(f.seen.sends,1);assert.equal(f.seen.blocked,1);
});
test('DM verifies peer through the bounded profile API and does not reload an existing home page',async()=>{
 const f=fixture();assert.equal((await f.run()).confirmed,true);assert.equal(f.seen.navigations,0);
});
test('DM reuses an already loaded inbox without toggling its entry or waiting for another init',async()=>{
 const f=fixture({cached:true});assert.equal((await f.run()).confirmed,true);assert.equal(f.seen.navigations,0);assert.equal(f.seen.entryClicks,0);assert.equal(f.seen.sends,1);
});
test('DM can open cached conversations without requiring a redundant init network response',async()=>{
 const f=fixture({initResponse:false});assert.equal((await f.run()).confirmed,true);assert.equal(f.seen.entryClicks,1);assert.equal(f.seen.rowWaits,1);assert.equal(f.seen.sends,1);
});
test('DM absent and ambiguous rows never fill or send',async()=>{
 for(const rows of [0,2]){const f=fixture({rows});const r=await f.run();assert.equal(r.state,'refused');assert.equal(r.code,rows?'PEER_NOT_UNIQUE':'PEER_NOT_VISIBLE');assert.equal(f.seen.filled,0);assert.equal(f.seen.sends,0);}
});
test('DM rejects wrong recipient, text and differing trusted conversation before transmission',async()=>{
 for(const patch of [{requestPeer:other},{requestText:'different'},{requestType:2},{identityChanged:true},{requestConversation:`0:1:${peer}:${account}`}]){const f=fixture(patch);assert.equal((await f.run()).code,'REQUEST_BINDING_MISMATCH');assert.equal(f.seen.sends,0);}
});
test('DM invalid source conversation cannot navigate or submit',async()=>{
 const f=fixture();const r=await f.run({secUid:sec,conversationId:`0:1:${account}:${other}`});assert.equal(r.code,'TARGET_UNVERIFIED');assert.equal(f.seen.navigations,0);assert.equal(f.seen.entryClicks,0);assert.equal(f.seen.sends,0);
});
test('DM missing confirmed receipt remains uncertain and native retry is blocked',async()=>{
 const f=fixture({receiptMissing:true});assert.equal((await f.run()).state,'uncertain');assert.equal(f.seen.sends,1);assert.equal(f.seen.blocked,1);
});
test('DM refuses a changed operator account before navigating',async()=>{
 const f=fixture();const r=await f.run({secUid:sec,conversationId:conversation,accountId:other});assert.equal(r.code,'ACCOUNT_CHANGED');assert.equal(f.seen.navigations,0);assert.equal(f.seen.sends,0);
});
test('DM profile failure reports its bounded phase before any submission',async()=>{
 const r=await advancedWrite({p:{url:()=> 'https://www.douyin.com/jingxuan',evaluate:async()=>{throw Error('private detail');},waitForResponse:()=>Promise.reject(Error('private detail')),goto:async()=>{throw Error('private detail');}},input:{action:'dm',targetId:peer,text:'hello',context:{secUid:sec}},identity:async()=>account,receipts:{}});assert.equal(r.code,'DM_PROFILE_UNAVAILABLE');assert.equal(r.state,'refused');assert.ok(!JSON.stringify(r).includes('private detail'));
});
