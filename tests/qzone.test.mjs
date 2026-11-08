import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createQzonePlatform} from '../adapters/qzone.mjs';
test('friend feed uses existing gateway, normalizes stable ids and cursor without exposing credentials',async()=>{const calls=[];const p=createQzonePlatform({config:{qq:{httpUrl:'http://127.0.0.1:3000',token:{http:'private-token'}}},stateDir:'unused',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({status:'ok',retcode:0,data:{feeds:[{tid:'T1',uin:123,content:'hello',created_time:1700000000}],has_more:true,next_cursor:'next'}})}}});const result=await p.read({action:'feed',limit:1});assert.equal(result.items[0].id,'qzone:123:T1');assert.equal(result.items[0].visibility,'friends');assert.equal(result.cursor,'next');assert.equal(result.truncated,true);assert.ok(!JSON.stringify(result).includes('private-token'));assert.match(calls[0].url,/get_qzone_feeds$/);await p.close();});
test('unsupported writes never submit; cancellation propagates',async()=>{let calls=0;const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},stateDir:'unused',fetchImpl:async()=>{calls++;throw Error('unexpected')}});assert.equal((await p.write({action:'dm',intentId:'a',text:'x'})).state,'unsupported');assert.equal(calls,0);const controller=new AbortController();controller.abort();await assert.rejects(p.read({action:'feed',signal:controller.signal}));await p.close();});

test('publication requires a stable tid and uses friends-only visibility',async()=>{let body;const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},stateDir:'unused',fetchImpl:async(_url,opt)=>{body=JSON.parse(opt.body);return {ok:true,json:async()=>({status:'ok',retcode:0,data:{tid:'posted'}})}}});const receipt=await p.write({action:'publish',intentId:'p1',text:'hello'});assert.equal(receipt.confirmed,true);assert.equal(receipt.platformId,'posted');assert.equal(body.ugc_right,4);await p.close();});
test('comments bind reply author and zero parent id to observed comment',async()=>{const calls=[];const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},stateDir:'unused',fetchImpl:async(url,opt)=>{const body=JSON.parse(opt.body);calls.push({url,body});return {ok:true,json:async()=>({status:'ok',retcode:0,data:url.endsWith('get_qzone_msg_detail')?{comments:[{comment_id:'0',uin:456,content:'yes'}],comment_num:1}:{comment_id:'new'}})}}});const read=await p.read({action:'comments',id:'qzone:123:T1'});const receipt=await p.write({action:'reply',targetId:'qzone:123:T1',parentId:read.items[0].id,intentId:'r',text:'reply'});assert.equal(receipt.platformId,'new');assert.equal(calls[1].body.comment_id,'0');assert.equal(calls[1].body.comment_uin,456);await p.close();});
test('an empty comment receipt is uncertain and same intent is not submitted twice',async()=>{let calls=0;const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},stateDir:'unused',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({status:'ok',retcode:0,data:{comment_id:''}})}}});const input={action:'comment',targetId:'qzone:123:T1',intentId:'c',text:'hello'};assert.equal((await p.write(input)).state,'uncertain');assert.equal((await p.write(input)).state,'uncertain');assert.equal(calls,1);await p.close();});
test('close cancels and waits for owned in-flight request',async()=>{let started;const ready=new Promise(r=>started=r);const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},stateDir:'unused',fetchImpl:async(_url,{signal})=>{started();await new Promise(resolve=>signal.addEventListener('abort',()=>setTimeout(resolve,10),{once:true}));throw Error('aborted')}});const pending=p.read({action:'feed'}).catch(()=>{});await ready;await p.close();let settled=false;pending.then(()=>settled=true);await Promise.resolve();assert.equal(settled,true);});
test('empty comment page never emits a non-advancing cursor',async()=>{const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},stateDir:'unused',fetchImpl:async()=>({ok:true,json:async()=>({status:'ok',retcode:0,data:{comments:[],comment_num:5}})})});const out=await p.read({action:'comments',id:'qzone:123:T1'});assert.equal(out.cursor,undefined);assert.equal(out.truncated,true);assert.ok(out.warnings.length);await p.close();});

test('status binds Qzone identity to authenticated gateway login and profile',async()=>{
 const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},fetchImpl:async url=>({ok:true,json:async()=>({status:'ok',retcode:0,data:url.endsWith('get_login_info')?{user_id:123}:{uin:123}})})});
 assert.equal((await p.status()).accountId,'123');await p.close();
});

test('Qzone detail cannot substitute requested account or tid for returned identity',async()=>{
 for(const data of [{uin:456,tid:'T1',content:'pong'},{uin:123,tid:'other',content:'pong'},{content:'pong'}]) {
  const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},fetchImpl:async()=>({ok:true,json:async()=>({status:'ok',retcode:0,data})})});
  const result=await p.read({action:'detail',id:'qzone:123:T1'});assert.equal(result.items.length,0);assert.ok(result.warnings.length);await p.close();
 }
});

test('normalized deployed gateway detail remains readable without inventing author or privacy proof',async()=>{
 const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},fetchImpl:async()=>({ok:true,json:async()=>({status:'ok',retcode:0,data:{tid:'T1',content:'ordinary detail',comment_num:0,comments:[]}})})});
 const result=await p.read({action:'detail',id:'qzone:123:T1'});
 assert.equal(result.items[0]?.text,'ordinary detail');assert.equal(result.items[0]?.id,'qzone:123:T1');
 assert.equal(result.items[0]?.actorId,undefined);assert.notEqual(result.items[0]?.meta?.visibilityVerified,true);await p.close();
});

function rawReadbackFixture(overrides={}) {
 const calls=[];const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000',token:'gateway-private'}},fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(url.startsWith('http://localhost:3000/'))return {ok:true,json:async()=>({status:'ok',retcode:0,data:url.endsWith('get_login_info')?{user_id:overrides.login??123}:url.endsWith('get_cookies')?{cookies:overrides.cookies??'uin=o00123; p_skey=a'}:{name:'self',description:''}})};
  if(overrides.transport)return overrides.transport(url,options);
  const payload={code:0,subcode:0,tid:'T1',uin:123,content:'pong',ugc_right:4,...overrides.payload};
  return new Response(overrides.body??`_Callback(${JSON.stringify(payload)});`,{status:200});
 }});return {p,calls};
}

test('raw own-post readback proves actual author text ID and ugc_right4 with server-only cookies',async()=>{
 const {p,calls}=rawReadbackFixture();assert.equal(typeof p.verifyOwnPost,'function');
 const result=await p.verifyOwnPost({id:'T1',accountId:'123'});
 assert.equal(result.verified,true);assert.equal(result.id,'T1');assert.equal(result.accountId,'123');assert.equal(result.text,'pong');assert.equal(result.target,'own-friends');
 const raw=calls.find(x=>x.url.startsWith('https://h5.qzone.qq.com/'));assert.ok(raw);const url=new URL(raw.url);
 assert.equal(url.pathname,'/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6');assert.equal(url.searchParams.get('need_right'),'1');assert.equal(url.searchParams.get('uin'),'123');assert.equal(url.searchParams.get('tid'),'T1');assert.equal(url.searchParams.get('g_tk'),'177670');assert.equal(raw.options.method,'GET');assert.equal(raw.options.redirect,'manual');
 assert.equal(raw.options.headers.cookie,'uin=o00123; p_skey=a');assert.equal(raw.options.headers.authorization,undefined);
 assert.ok(!JSON.stringify(result).includes('p_skey'));assert.ok(!JSON.stringify(result).includes('gateway-private'));
 assert.ok(calls.every(x=>!x.url.includes('send_qzone_msg')));await p.close();
});

test('raw readback accepts source-supported subcode-only success and identifier JSONP wrappers',async()=>{
 const payload={subcode:0,tid:'T1',uin:123,content:'pong',ugc_right:4};
 for(const body of [JSON.stringify(payload),`callback_123 (${JSON.stringify(payload)});`,`back(${JSON.stringify(payload)})`]) {
  const {p}=rawReadbackFixture({body});assert.equal((await p.verifyOwnPost({id:'T1',accountId:'123'})).verified,true);await p.close();
 }
});

test('raw readback refuses missing or conflicting author privacy text ID and server success evidence',async()=>{
 for(const payload of [{uin:456},{uin:undefined},{ugc_right:1},{ugc_right:undefined},{ugc_right:16},{content:'pong extra'},{tid:'other'},{code:1},{subcode:1},{code:undefined,subcode:undefined}]) {
  const {p}=rawReadbackFixture({payload});assert.equal(typeof p.verifyOwnPost,'function');
  assert.equal((await p.verifyOwnPost({id:'T1',accountId:'123'})).verified,false);await p.close();
 }
});

test('raw readback rejects wrong logged-in account and malformed cookie before any external GET',async()=>{
 for(const overrides of [{login:456},{cookies:'uin=o00456; p_skey=a'},{cookies:'uin=o00123; p_skey=a\r\ninjected:secret'},{cookies:'uin=o00123'}]) {
  const {p,calls}=rawReadbackFixture(overrides);assert.equal(typeof p.verifyOwnPost,'function');
  assert.equal((await p.verifyOwnPost({id:'T1',accountId:'123'})).verified,false);assert.ok(calls.every(x=>!x.url.startsWith('https:')));await p.close();
 }
});

test('raw readback never follows redirects or evaluates JSONP and bounds response bytes',async()=>{
 for(const overrides of [{transport:async()=>new Response('',{status:302,headers:{location:'https://attacker.invalid/'}})},{body:'_Callback({}); process.exit(1);'},{body:'x'.repeat(1024*1024+1)}]){
  const {p}=rawReadbackFixture(overrides);assert.equal(typeof p.verifyOwnPost,'function');assert.equal((await p.verifyOwnPost({id:'T1',accountId:'123'})).verified,false);await p.close();
 }
});

test('closing Qzone cancels and awaits owned raw readback without a publish',async()=>{
 let entered;const started=new Promise(resolve=>entered=resolve);
 const {p,calls}=rawReadbackFixture({transport:async(_url,{signal})=>{entered();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Error('cancelled');}});
 const pending=p.verifyOwnPost({id:'T1',accountId:'123'});await started;await p.close();assert.equal((await pending).verified,false);assert.ok(calls.every(x=>!x.url.includes('send_qzone_msg')));
});

test('live Qzone publish refuses a changed account before submitting',async()=>{
 let posts=0;const p=createQzonePlatform({config:{qq:{httpUrl:'http://localhost:3000'}},fetchImpl:async url=>{if(url.endsWith('send_qzone_msg'))posts++;return {ok:true,json:async()=>({status:'ok',retcode:0,data:url.endsWith('get_login_info')?{user_id:456}:{uin:456}})};}});
 assert.equal((await p.write({action:'publish',targetId:'own-friends',intentId:'live-1',text:'pong',context:{accountId:'123'}})).confirmed,false);assert.equal(posts,0);await p.close();
});
