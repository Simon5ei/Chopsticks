import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const NOW=1800000000000;
const nav={mid:'90001',isLogin:true,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub_url:'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'}};
const msg=(patch: Record<string, any>={})=>({sender_uid:'10001',receiver_id:'90001',receiver_type:1,msg_type:1,msg_status:0,timestamp:NOW/1000-1,msg_key:'1261813571425140745',msg_seqno:22,content:JSON.stringify({content:'你好 "1234567890123456789"'}),...patch});
const session=(patch: Record<string, any>={})=>({talker_id:'10001',session_type:1,unread_count:2,last_msg:msg(),...patch});
const notification=(n?: any,patch: Record<string, any>={})=>({id:String(700+n),reply_time:1799999999,user:{mid:'10001'},item:{business_id:1,subject_id:'123',root_id:0,source_id:String(321+n),uri:'https://www.bilibili.com/video/BV1234567890/'},...patch});
const json=(data?: any)=>Response.json({code:0,data});
async function fixture(t?: any,handle?: any){
 const fishHome=await fs.mkdtemp(path.join(os.tmpdir(),'chopsticks-social-'));t.after(()=>fs.rm(fishHome,{recursive:true,force:true}));
 await fs.mkdir(path.join(fishHome,'bili'));
 await fs.writeFile(path.join(fishHome,'bili','credentials.json'),JSON.stringify({sessdata:'fixture-cookie',bili_jct:'fixture-csrf',buvid3:'fixture-buvid'}));
 await fs.writeFile(path.join(fishHome,'bili.config.json'),JSON.stringify({self:{mid:'90001'},owner:{mid:'10001'}}));
 const requests=[];
 const {createBiliSocial}=await import('../src/adapters/bili-social.mjs');
 const adapter=createBiliSocial({fishHome,now:()=>NOW,timeoutMs:1000,fetchImpl:async(value?: any,init?: any)=>{const u=new URL(value);requests.push({u,init});if(u.pathname==='/x/web-interface/nav')return json(nav);return handle(u,init,requests);}});
 return {adapter,requests,fishHome};
}

test('poll reads actual private message history, preserves exact IDs and repeats stable events for durable host dedup',async (t?: any) =>{
 const f=await fixture(t,(u?: any)=>{
  if(u.pathname.endsWith('get_sessions'))return json({session_list:[session(),session({talker_id:'999'}),session({talker_id:'90001'})]});
  assert.equal(u.pathname,'/svr_sync/v1/svr_sync/fetch_session_msgs');assert.equal(u.searchParams.get('talker_id'),'10001');assert.equal(u.searchParams.get('size'),'30');assert.match(u.searchParams.get('w_rid'),/^[a-f0-9]{32}$/);
  return new Response('{"code":0,"data":{"has_more":0,"messages":['+JSON.stringify(msg()).replace('"1261813571425140745"','1261813571425140745')+','+JSON.stringify(msg({msg_key:'2',msg_seqno:21,text:'x',content:'{"content":"前一句"}'}))+','+JSON.stringify(msg({sender_uid:'90001',msg_key:'3'}))+','+JSON.stringify(msg({msg_status:1,msg_key:'4'}))+']}}');
 });
 const a=await f.adapter.poll({comments:false}),b=await f.adapter.poll({comments:false});
 assert.equal(a.selfId,'90001');assert.equal(a.events.length,2);assert.deepEqual(a.events.map((e)=>e.id),b.events.map((e)=>e.id));
 const e=a.events.find((e)=>e.meta.bili.msgKey==='1261813571425140745');assert.ok(e);assert.equal(e.channel,'bili:dm:10001');assert.equal(e.text,'你好 "1234567890123456789"');assert.equal(e.kind,'message.received');assert.equal(e.actorId,'10001');assert.equal(e.meta.addressed,true);assert.equal(e.at,NOW-1000);
 assert.equal(f.requests.some((r)=>r.u.pathname.includes('ack')),false);
});

test('poll bounds private history pagination and tells the host that older messages remain',async (t?: any) =>{
 const f=await fixture(t,(u)=>u.pathname.endsWith('get_sessions')?json({session_list:[session()]}):json({has_more:1,messages:[msg({msg_key:String(Number(u.searchParams.get('begin_seqno'))||30),msg_seqno:(Number(u.searchParams.get('begin_seqno'))||30)-1})]}));
 const r=await f.adapter.poll({comments:false});assert.equal(f.requests.filter((r)=>r.u.pathname.endsWith('fetch_session_msgs')).length,3);assert.equal(r.truncated,true);assert.equal(r.peers[0].truncated,true);
});

test('comment notifications become exact verified coordinates including dynamic comment IDs',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname==='/x/msgfeed/reply')return new Response('{"code":0,"data":{"cursor":"","items":[{"id":1261813571425140701,"reply_time":1799999999,"user":{"mid":"10001","nickname":"朋友"},"item":{"business_id":17,"subject_id":1261813571425140745,"root_id":"321","source_id":"322","uri":"https://t.bilibili.com/1261813571425140745#reply322","title":"不可靠旧正文"}}]}}');
  if(u.pathname==='/x/msgfeed/at')return json({items:[]});
  if(u.pathname.includes('web-dynamic'))return json({item:{basic:{comment_id_str:'1261813571425140799',comment_type:17}}});
  assert.ok(['/x/v2/reply/reply','/x/v2/reply/jump'].includes(u.pathname));assert.equal(u.searchParams.get('oid'),'1261813571425140799');return json({root:{rpid:'321'},replies:[{rpid:'322',mid:'10001',root:'321',parent:'321',content:{message:'真正正文'},ctime:1799999999}]});
 });
 const r=await f.adapter.poll({dm:false});assert.equal(r.events.length,1);const e=r.events[0];assert.equal(e.text,'真正正文');assert.equal(e.channel,'bili:public');assert.deepEqual(e.meta.bili,{kind:'comment',oid:'1261813571425140799',type:17,root:'321',parent:'322',dynamicId:'1261813571425140745'});
});

test('unverified comments and foreign notification URLs never become sendable events',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname.includes('msgfeed'))return json({items:[{id:'1',reply_time:1799999999,user:{mid:'10001'},item:{business_id:1,subject_id:'123',root_id:'321',source_id:'322',uri:'https://evil.test/video/BV1234567890/'}}]});
  assert.fail('untrusted notification must not trigger another request');
 });assert.deepEqual((await f.adapter.poll({dm:false})).events,[]);
});

test('video comment replies use the exact incoming floor and top level root',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname.includes('msgfeed'))return json({items:[{id:'701',reply_time:1799999999,user:{mid:'10001'},item:{business_id:1,subject_id:'123',root_id:0,source_id:'322',uri:'https://www.bilibili.com/video/BV1234567890/#reply322'}}]});
  assert.equal(u.searchParams.get('root')||u.searchParams.get('rpid'),'322');return json({root:{rpid:'322',mid:'10001',root:0,content:{message:'顶层评论'},ctime:1799999999},replies:[]});
 });const r=await f.adapter.poll({dm:false});assert.equal(r.events.length,1);assert.deepEqual(r.events[0].meta.bili,{kind:'comment',oid:'123',type:1,root:'322',parent:'322',bvid:'BV1234567890'});
});

test('a mismatched floor or failed exact read cannot turn notification titles into reply content',async (t?: any) =>{
 for(const read of [()=>json({replies:[{rpid:'999',mid:'10001',content:{message:'different'}}]}),()=>Response.json({code:-404})]){
  const f=await fixture(t,(u)=>u.pathname.includes('msgfeed')?json({items:[{id:'701',reply_time:1799999999,user:{mid:'10001'},item:{business_id:1,subject_id:'123',root_id:'321',source_id:'322',uri:'https://www.bilibili.com/video/BV1234567890/',title:'old title',source_content:'possibly stale'}}]}):read());
  assert.deepEqual((await f.adapter.poll({dm:false})).events,[]);
 }
});

test('owner scope excludes other peers and session limits explicitly report truncation',async (t?: any) =>{
 const f=await fixture(t,(u)=>u.pathname.endsWith('get_sessions')?json({session_list:Array.from({length:12},(_?: any,i?: any)=>session({talker_id:String(10001+i)}))}):json({messages:[],has_more:0}));
 const owner=await f.adapter.poll({comments:false,dmScope:'owner'});assert.deepEqual(owner.peers,[{peerId:'10001',truncated:false}]);
 const all=await f.adapter.poll({comments:false});assert.equal(all.peers.length,6);assert.equal(all.truncated,true);
});

test('large comment inboxes examine at most six candidates and preserve useful results on phase errors',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname==='/x/msgfeed/at')return Response.json({code:-500});
  if(u.pathname==='/x/msgfeed/reply')return json({items:Array.from({length:30},(_?: any,i?: any)=>({id:String(701+i),reply_time:1799999999,user:{mid:'10001'},item:{business_id:1,subject_id:'123',root_id:0,source_id:String(322+i),uri:'https://www.bilibili.com/video/BV1234567890/'}}))});
  return json({root:{rpid:u.searchParams.get('root')||u.searchParams.get('rpid'),mid:'10001',content:{message:'顶层评论'},ctime:1799999999},replies:[]});
 });const r=await f.adapter.poll({dm:false});assert.equal(r.events.length,3);assert.equal(r.truncated,true);assert.equal(f.requests.filter((q)=>q.u.pathname.startsWith('/x/v2/reply/')).length,3);assert.ok(r.warnings.some((w)=>w.phase==='comments.at'));
});

test('seen and invalid notifications do not spend each inbox budget or starve the other inbox',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname.endsWith('/reply')&&u.pathname.includes('msgfeed'))return json({cursor:{is_end:true},items:[...Array.from({length:4},(_?: any,i?: any)=>notification(i+1,{user:{mid:'90001'}})),...Array.from({length:8},(_?: any,i?: any)=>notification(i+1))]});
  if(u.pathname.endsWith('/at'))return json({cursor:{is_end:true},items:Array.from({length:5},(_?: any,i?: any)=>notification(i+21))});
  return json({root:{rpid:u.searchParams.get('rpid')||u.searchParams.get('root'),mid:'10001',content:{message:'正文'},ctime:1799999999},replies:[]});
 });const r=await f.adapter.poll({dm:false,seenNotificationKeys:new Set<any>(['reply:701','reply:702','reply:703'])});
 assert.equal(r.events.length,6);assert.deepEqual(r.events.filter((e)=>e.meta.notificationKey.startsWith('reply:')).map((e)=>e.meta.notificationKey).sort(),['reply:704','reply:705','reply:706']);assert.equal(r.events.filter((e)=>e.meta.notificationKey.startsWith('at:')).length,3);assert.equal(r.truncated,true);
 const next=await f.adapter.poll({dm:false,seenNotificationKeys:r.events.flatMap((e)=>e.meta.notificationKeys||[e.meta.notificationKey]).concat(['reply:701','reply:702','reply:703'])});assert.ok(next.events.some((e)=>e.meta.notificationKey==='reply:708'));
});

test('unresolved candidates rotate across polls instead of permanently blocking later notifications',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname.includes('msgfeed'))return json({cursor:{is_end:true},items:u.pathname.endsWith('/at')?[]:Array.from({length:4},(_?: any,i?: any)=>notification(i+1))});
  const target=u.searchParams.get('rpid')||u.searchParams.get('root');return json({root:target==='325'?{rpid:'325',mid:'10001',content:{message:'第四条'},ctime:1799999999}:null,replies:[]});
 });const first=await f.adapter.poll({dm:false});assert.equal(first.events.length,0);assert.equal(first.truncated,true);assert.ok(first.warnings.some((w)=>w.phase==='comments.thread'));
 const second=await f.adapter.poll({dm:false});assert.ok(second.events.some((e)=>e.meta.bili.parent==='325'));
});

test('a source parent floor resolves its exact incoming child rather than the original parent or latest author reply',async (t?: any) =>{
 const item=notification(1,{item:{business_id:1,subject_id:'123',root_id:'100',source_id:'100',uri:'https://www.bilibili.com/video/BV1234567890/'}});
 const f=await fixture(t,(u)=>{
  if(u.pathname.includes('msgfeed'))return json({items:u.pathname.endsWith('/at')?[]:[item]});
  return json({root:{rpid:'100',mid:'90001',content:{message:'自己父楼'},ctime:1799999900},replies:[{rpid:'200',mid:'10001',root:'100',parent:'100',content:{message:'对方新回复'},ctime:1799999999},{rpid:'201',mid:'10001',root:'100',parent:'199',content:{message:'同作者但不同父楼'},ctime:1800000000}]});
 });const r=await f.adapter.poll({dm:false});assert.equal(r.events.length,1);assert.equal(r.events[0].text,'对方新回复');assert.equal(r.events[0].meta.bili.root,'100');assert.equal(r.events[0].meta.bili.parent,'200');
});

test('multiple indistinguishable child replies remain unresolved instead of guessing the latest',async (t?: any) =>{
 const f=await fixture(t,(u)=>u.pathname.includes('msgfeed')?json({items:u.pathname.endsWith('/at')?[]:[notification(1,{item:{business_id:1,subject_id:'123',root_id:'100',source_id:'100',uri:'https://www.bilibili.com/video/BV1234567890/'}})]}):json({root:{rpid:'100',mid:'90001'},replies:[200,201].map((n)=>({rpid:String(n),mid:'10001',root:'100',parent:'100',content:{message:'相同正文'},ctime:1799999999}))}));
 const r=await f.adapter.poll({dm:false});assert.deepEqual(r.events,[]);assert.equal(r.truncated,true);assert.ok(r.warnings.some((w)=>w.phase==='comments.thread'));
});

test('notification pagination uses exact id plus reply_time and honors cursor.is_end for both streams',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname.includes('msgfeed')){
   assert.equal(u.searchParams.has('cursor'),false);
   if(!u.searchParams.has('id'))return json({items:[notification(1)],cursor:{is_end:false,id:'1261813571425140745',time:1799999990}});
   assert.equal(u.searchParams.get('id'),'1261813571425140745');assert.equal(u.searchParams.get('reply_time'),'1799999990');return json({items:[notification(u.pathname.endsWith('/at')?3:2)],cursor:{is_end:true,id:'999',time:1}});
  }
  return json({root:{rpid:u.searchParams.get('rpid')||u.searchParams.get('root'),mid:'10001',content:{message:'翻页正文'},ctime:1799999999},replies:[]});
 });const r=await f.adapter.poll({dm:false,seenNotificationKeys:['reply:701','at:701']});assert.equal(r.events.length,2);assert.equal(f.requests.filter((q)=>q.u.pathname.includes('msgfeed')).length,4);assert.equal(r.truncated,false);
});

test('jump lookup reaches an exact nested rpid beyond the first forty thread replies',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname.includes('msgfeed'))return json({items:[notification(1,{item:{business_id:1,subject_id:'123',root_id:'100',source_id:'200',uri:'https://www.bilibili.com/video/BV1234567890/'}})]});
  assert.equal(u.pathname,'/x/v2/reply/jump');assert.equal(u.searchParams.get('rpid'),'200');return json({replies:[{rpid:'100',mid:'90001',replies:[{rpid:'200',mid:'10001',root:'100',parent:'100',ctime:1799999999,content:{message:'深楼精确回复'}}]}]});
 });const r=await f.adapter.poll({dm:false});assert.equal(r.events.length,1);assert.equal(r.events[0].meta.bili.parent,'200');assert.deepEqual(r.events[0].meta.notificationKeys,['reply:701','at:701']);assert.equal(f.requests.some((q)=>q.u.pathname==='/x/v2/reply/reply'),false);
});

test('a failed DM peer read does not discard messages from another active peer',async (t?: any) =>{
 const f=await fixture(t,(u)=>{
  if(u.pathname.endsWith('get_sessions'))return json({session_list:[session(),session({talker_id:'10002'})]});
  if(u.searchParams.get('talker_id')==='10001')return Response.json({code:-500});return json({messages:[msg({sender_uid:'10002'})],has_more:0});
 });const r=await f.adapter.poll({comments:false});assert.equal(r.events.length,1);assert.equal(r.events[0].actorId,'10002');assert.ok(r.warnings.some((w)=>w.phase==='dm.history'));assert.equal(r.truncated,true);
});

test('sendDM validates current inbound conversation and returns only a server message receipt',async (t?: any) =>{
 const f=await fixture(t,(u?: any,init?: any)=>{
  if(u.pathname.endsWith('get_sessions'))return json({session_list:[session()]});
  assert.equal(u.pathname,'/web_im/v1/web_im/send_msg');assert.equal(init.method,'POST');const p=new URLSearchParams(init.body);assert.equal(p.get('msg[receiver_id]'),'10001');assert.equal(p.get('msg[sender_uid]'),'90001');assert.equal(p.get('csrf'),'fixture-csrf');assert.equal(p.get('csrf_token'),'fixture-csrf');assert.equal(u.searchParams.get('w_sender_uid'),'90001');assert.equal(u.searchParams.get('w_receiver_id'),'10001');assert.equal(u.searchParams.get('w_dev_id'),p.get('msg[dev_id]'));assert.equal(JSON.parse(p.get('msg[content]')).content,'回复');assert.match(u.searchParams.get('w_rid'),/^[a-f0-9]{32}$/);return new Response('{"code":0,"data":{"msg_key":1261813571425140745}}');
 });assert.deepEqual(await f.adapter.sendDM({peerId:'10001',text:'回复'}),{status:'confirmed',kind:'dm',id:'1261813571425140745'});
});

test('sendDM refuses stale, outgoing, unrelated or malformed conversations without posting',async (t?: any) =>{
 for(const patch of [{last_msg:msg({timestamp:NOW/1000-172801})},{last_msg:msg({sender_uid:'90001'})},{talker_id:'10002'},{last_msg:msg({receiver_id:'777'})}]){
  const f=await fixture(t,(u)=>{assert.equal(u.pathname.endsWith('get_sessions'),true);return json({session_list:[session(patch)]});});
  await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复'}));assert.equal(f.requests.some((r)=>r.init.method==='POST'),false);
 }
 const f=await fixture(t,()=>assert.fail('invalid local input must not fetch'));
 for(const input of [{peerId:'10001',text:'x'.repeat(201)},{peerId:'1',text:'x'},{peerId:'10001',text:''}])await assert.rejects(f.adapter.sendDM(input));
});

test('account mismatch fails closed and ambiguous send is not retried',async (t?: any) =>{
 const f=await fixture(t,(u)=>u.pathname.endsWith('get_sessions')?json({session_list:[session()]}):json({}));
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复'}),(e: any) =>e.code==='SEND_UNCERTAIN');assert.equal(f.requests.filter((r)=>r.init.method==='POST').length,1);
 await fs.writeFile(path.join(f.fishHome,'bili.config.json'),JSON.stringify({self:{mid:'777'},owner:{mid:'10001'}}));await assert.rejects(f.adapter.poll({comments:false}),/account/i);
});

test('a transport failure after POST stays uncertain and cannot report successful delivery',async (t?: any) =>{
 const f=await fixture(t,(u)=>{if(u.pathname.endsWith('get_sessions'))return json({session_list:[session()]});throw Error('fixture-cookie');});
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复'}),(e: any) =>e.code==='SEND_UNCERTAIN'&&!e.message.includes('fixture-cookie'));assert.equal(f.requests.filter((r)=>r.init.method==='POST').length,1);
});

test('failed DM preflight reports not_sent with safe endpoint and numeric API diagnostics',async (t?: any) =>{
 const f=await fixture(t,()=>Response.json({code:-412,message:'fixture-cookie private server text'}));
 let reservations=0;
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复',beforeSend:()=>{reservations++;}}),(e: any) =>{
  assert.equal(e.deliveryState,'not_sent');assert.equal(e.code,'BILI_API');assert.equal(e.apiCode,-412);
  assert.equal(e.endpoint,'/session_svr/v1/session_svr/get_sessions');assert.match(e.message,/-412/);
  assert.equal(e.message.includes('fixture-cookie'),false);return true;
 });
 assert.equal(reservations,0);assert.equal(f.requests.some((r)=>r.init.method==='POST'),false);
});

test('DM POST rejection retains safe diagnostics but remains unknown and never retries',async (t?: any) =>{
 const f=await fixture(t,(u)=>u.pathname.endsWith('get_sessions')?json({session_list:[session()]}):Response.json({code:-101,message:'fixture-cookie'}));
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复'}),(e: any) =>{
  assert.equal(e.deliveryState,'unknown');assert.equal(e.code,'SEND_UNCERTAIN');assert.equal(e.apiCode,-101);
  assert.equal(e.endpoint,'/web_im/v1/web_im/send_msg');assert.equal(e.message.includes('fixture-cookie'),false);return true;
 });
 assert.equal(f.requests.filter((r)=>r.init.method==='POST').length,1);
});

test('DM reservation cancellation and transport failure preserve the actual POST boundary',async (t?: any) =>{
 const f=await fixture(t,(u)=>{if(u.pathname.endsWith('get_sessions'))return json({session_list:[session()]});throw Error('fixture-cookie');});
 const c=new AbortController();
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复',signal:c.signal,beforeSend:()=>c.abort()}),(e: any) =>e.deliveryState==='not_sent');
 assert.equal(f.requests.some((r)=>r.init.method==='POST'),false);
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复'}),(e: any) =>e.deliveryState==='unknown'&&e.code==='SEND_UNCERTAIN'&&!e.message.includes('fixture-cookie'));
});

test('DM quota reservation runs once immediately before POST after freshness and signing preflight',async (t?: any) =>{
 const order=[];
 const f=await fixture(t,(u)=>{if(u.pathname.endsWith('get_sessions')){order.push('sessions');return json({session_list:[session()]});}order.push('post');return json({msg_key:'55'});});
 const receipt=await f.adapter.sendDM({peerId:'10001',text:'回复',expectedMsgKey:'1261813571425140745',beforeSend:async({signal}: { signal?: any; [key: string]: any })=>{assert.equal(signal.aborted,false);order.push('reserve');}});assert.equal(receipt.id,'55');assert.deepEqual(order,['sessions','reserve','post']);
});

test('newer incoming DM context and failed preflight never consume a beforeSend reservation',async (t?: any) =>{
 let reserved=0;
 const f=await fixture(t,(u)=>{assert.equal(u.pathname.endsWith('get_sessions'),true);return json({session_list:[session()]});});
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复',expectedMsgKey:'old',beforeSend:()=>{reserved++;}}));
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复',expectedMsgKey:'333',beforeSend:()=>{reserved++;}}),(e: any) =>e.code==='BILI_DM_GATE');
 await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复',expectedSeqno:'21',beforeSend:()=>{reserved++;}}),(e: any) =>e.code==='BILI_DM_GATE');
 assert.equal(reserved,0);assert.equal(f.requests.some((r)=>r.init.method==='POST'),false);
});

test('DM seqno fallback is checked only when comparable and callback cancellation prevents POST',async (t?: any) =>{
 let reserved=0;
 const f=await fixture(t,(u)=>u.pathname.endsWith('get_sessions')?json({session_list:[session({last_msg:msg({msg_seqno:undefined})})]}):json({msg_key:'56'}));
 assert.equal((await f.adapter.sendDM({peerId:'10001',text:'回复',expectedSeqno:'21',beforeSend:()=>{reserved++;}})).id,'56');assert.equal(reserved,1);
 const c=new AbortController();await assert.rejects(f.adapter.sendDM({peerId:'10001',text:'回复',beforeSend:()=>{c.abort(Error('fixture-cookie'));},signal:c.signal}),(e: any) =>e.code==='BILI_CANCELLED'&&!e.message.includes('fixture-cookie'));assert.equal(f.requests.filter((r)=>r.init.method==='POST').length,1);
});

test('redirects and oversized bodies are rejected without forwarding cookies',async (t?: any) =>{
 for(const response of [()=>new Response('',{status:302,headers:{location:'https://evil.test/'}}),()=>new Response('x'.repeat(1024*1024+1))]){
  const f=await fixture(t,()=>response());const r=await f.adapter.poll({comments:false});assert.deepEqual(r.events,[]);assert.equal(r.warnings[0].phase,'dm.sessions');assert.equal(r.warnings[0].code,'BILI_RESPONSE');assert.equal(r.truncated,true);assert.equal(f.requests.length,2);assert.equal(f.requests[1].init.redirect,'manual');
 }
});

test('poll cancellation and total deadline abort pending reads with sanitized errors',async (t?: any) =>{
 const f=await fixture(t,(_u?: any,init?: any)=>new Promise<any | void>((_?: any,reject?: any)=>init.signal.addEventListener('abort',()=>reject(Error('fixture-cookie')),{once:true})));
 const c=new AbortController(),pending=f.adapter.poll({comments:false,signal:c.signal});setTimeout(()=>c.abort(),15);await assert.rejects(pending,(e: any) =>!e.message.includes('fixture-cookie'));
 const {createBiliSocial}=await import('../src/adapters/bili-social.mjs');const a=createBiliSocial({fishHome:f.fishHome,timeoutMs:20,fetchImpl:(_u?: any,init?: any)=>new Promise<any | void>((_?: any,reject?: any)=>init.signal.addEventListener('abort',()=>reject(Error('fixture-cookie')),{once:true}))});await assert.rejects(a.poll(),(e: any) =>!e.message.includes('fixture-cookie'));
});

test('close cancels active reads and disallows subsequent operations',async (t?: any) =>{
 let ready;const started=new Promise<any | void>((resolve)=>{ready=resolve;});
 const f=await fixture(t,(_u?: any,init?: any)=>{ready();return new Promise<any | void>((_?: any,reject?: any)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));});
 const pending=f.adapter.poll({comments:false});await started;f.adapter.close();await assert.rejects(pending,(e: any) =>e.code==='BILI_CANCELLED');await assert.rejects(f.adapter.poll(),(e: any) =>e.code==='BILI_CLOSED');
});

test('an internal poll deadline preserves already verified events and reports incomplete phases',async (t?: any) =>{
 const f=await fixture(t,()=>json({items:[]}));
 const {createBiliSocial}=await import('../src/adapters/bili-social.mjs');
 const a=createBiliSocial({fishHome:f.fishHome,now:()=>NOW,timeoutMs:100,fetchImpl:async(value?: any,init?: any)=>{
  const u=new URL(value);if(u.pathname.endsWith('/nav'))return json(nav);
  if(u.pathname.endsWith('get_sessions'))return json({session_list:[session(),session({talker_id:'10002'})]});
  if(u.searchParams.get('talker_id')==='10001')return json({messages:[msg()],has_more:0});
  return new Promise<any | void>((_?: any,reject?: any)=>init.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}));
 }});
 const r=await a.poll({comments:false});assert.equal(r.events.length,1);assert.equal(r.truncated,true);assert.equal(r.peers[1].truncated,true);assert.ok(r.warnings.some((w)=>w.phase==='deadline'));
});

test('a pre-aborted caller reason is sanitized before any network or configuration reads',async (t?: any) =>{
 const f=await fixture(t,()=>assert.fail('cancelled poll must not fetch'));
 const c=new AbortController();c.abort(Error('fixture-cookie'));await assert.rejects(f.adapter.poll({signal:c.signal}),(e: any) =>e.code==='BILI_CANCELLED'&&!e.message.includes('fixture-cookie'));assert.equal(f.requests.length,0);
});
