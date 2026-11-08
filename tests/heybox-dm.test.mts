import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createHeyboxPlatform} from '../src/adapters/heybox.mjs';
const ok=(result)=>({payload:{status:'ok',result},cookies:{}});
async function setup({mismatch,ambiguous=false,cancel}: { mismatch?: any; ambiguous?: boolean; cancel?: any; [key: string]: any }={}){const stateDir=await mkdtemp(join(tmpdir(),'heybox-dm-'));await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',pkey:'secret',x_xhh_tokenid:'web'}}));const calls=[];let sent=false;const p=createHeyboxPlatform({stateDir,transport:async (r?: any) =>{calls.push(r);if(r.path.includes('restore_login'))return ok({profile:{heybox_id:'42'}});if(r.method==='POST'){sent=true;cancel?.abort();return ok(ambiguous?{heybox_ack_id:r.body.heybox_ack_id}:{msg_seq:'102'});}return ok({sender_info:{user_id:'42'},recipient_info:{user_id:mismatch==='peer'?'88':'9'},list:sent?[{seq:'102',sender_id:mismatch==='sender'?'88':'42',msg:mismatch==='text'?'wrong':'hello'}]:[{seq:'101',sender_id:'9',msg:'incoming'}]});}});return{p,calls};}
test('known peer inbox verifies participants and returns stable scoped message IDs',async()=>{const{p,calls}=await setup();const r=await p.read({action:'inbox',id:'9',context:{sourceActor:'9'}});assert.equal(r.items[0].id,'9:101');assert.equal(r.items[0].visibility,'private');assert.equal(r.items[0].actorId,'9');assert.equal(r.items[0].targetId,'9');assert.equal(calls.find((x)=>x.path.includes('msg/user')).params.to_user_id,'9');await p.close();});
test('inbox discovery explicitly reports unexpected response rather than pretending it is empty',async()=>{const{p}=await setup();assert.deepEqual((await p.read({action:'inbox'})).warnings,['discovery_unexpected_response']);await p.close();});
test('inbox refuses a peer outside trusted private binding',async()=>{const{p,calls}=await setup();assert.deepEqual((await p.read({action:'inbox',id:'9',context:{sourceActor:'10'}})).warnings,['peer_mismatch']);assert.equal(calls.length,0);await p.close();});
test('DM confirms actual server sequence and readback participants after one POST',async()=>{const{p,calls}=await setup();const r: any=await p.write({action:'dm',targetId:'9',text:'hello',intentId:'i',context:{sourceActor:'9'}});assert.equal(r.confirmed,true);assert.equal(r.platformId,'9:102');assert.equal(r.visibility,'private');const writes=calls.filter((x)=>x.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].params.to_user_id,'9');assert.equal(writes[0].body.msg,'hello');assert.equal(writes[0].body.msg_type,'6');await p.close();});
for(const mismatch of ['sender','text'])test(`DM ${mismatch} mismatch stays unknown`,async()=>{const{p}=await setup({mismatch});assert.equal((await p.write({action:'dm',targetId:'9',text:'hello',intentId:'i'})).state,'unknown');await p.close();});
test('DM participant mismatch refuses before POST',async()=>{const{p,calls}=await setup({mismatch:'peer'});assert.equal((await p.write({action:'dm',targetId:'9',text:'hello',intentId:'i'})).state,'refused');assert.equal(calls.filter((x)=>x.method==='POST').length,0);await p.close();});
test('echo of client ack is insufficient to confirm DM',async()=>{const{p,calls}=await setup({ambiguous:true});assert.equal((await p.write({action:'dm',targetId:'9',text:'hello',intentId:'i'})).state,'unknown');assert.equal(calls.filter((x)=>x.method==='POST').length,1);await p.close();});
test('cancelled DM ignores late server acknowledgement',async()=>{const cancel=new AbortController();const{p}=await setup({cancel});assert.equal((await p.write({action:'dm',targetId:'9',text:'hello',intentId:'i',signal:cancel.signal})).state,'unknown');await p.close();});
test('inbox preserves server sequence and never invents event time',async()=>{const{p}=await setup();const r=await p.read({action:'inbox',id:'9'});assert.equal(r.items[0].sequence,'101');assert.equal(r.items[0].at,undefined);await p.close();});
test('inbox without id discovers real peer IDs and does not invent messages',async()=>{
 const stateDir=await mkdtemp(join(tmpdir(),'heybox-discovery-'));await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',pkey:'secret'}}));let req;
 const p=createHeyboxPlatform({stateDir,transport:async (r?: any) =>{req=r;return r.path.includes('restore_login')?ok({profile:{heybox_id:'42'}}):ok({messages:[{entry:'message',message_id:'9',user_a:{userid:'9'}},{entry:'comment',userid:'8'}]});}});
 const r: any=await p.read({action:'inbox'});assert.deepEqual(r.peers,['9']);assert.deepEqual(r.items,[]);assert.deepEqual(r.warnings,[]);assert.equal(req.params.list_type,'2');await p.close();
});
test('bound private inbox without id only reads that peer and never discovers other users',async()=>{const{p,calls}=await setup();const r=await p.read({action:'inbox',context:{sourceActor:'9'}});assert.equal(r.items[0].targetId,'9');assert.equal(calls.some((x)=>x.path==='/bbs/app/user/message'),false);await p.close();});
test('DM reports platform authentication instructions without confirming or leaking their URL',async()=>{
 const {createHeyboxDirectMessages}=await import('../src/platforms/heybox/dm.mjs');
 for(const [protocol,code] of [['heybox://web_auth?token=secret','verification_required'],['heybox%3A%2F%2Fname_verify%3Ftoken%3Dsecret','verification_required'],['heybox://other?token=secret','client_action_required']]){
  let posts=0;const dm=createHeyboxDirectMessages({load:async()=>({cookies:{}}),status:async()=>({state:'ready',accountId:'42'}),result:(r)=>r,isClosed:()=>false,request:async(_p?: any,_q?: any,_c?: any,_a?: any,_s?: any,options?: any)=>{if(options?.method==='POST'){posts++;return {heybox__protocol__execute__directly:protocol};}return {sender_info:{user_id:'42'},recipient_info:{user_id:'9'},list:[]};}});
  const result: any=await dm.write({targetId:'9',text:'hello',intentId:'one'});assert.equal(result.confirmed,false);assert.equal(result.state,'unknown');assert.equal(result.code,code);assert.equal(posts,1);assert.ok(!JSON.stringify(result).includes('secret'));
 }
});
test('missing server acknowledgement and readback mismatch have distinct diagnostics',async()=>{
 for(const [options,code] of [[{ambiguous:true},'server_ack_missing'],[{mismatch:'text'},'readback_unverified']]){const {p}=await setup((options as any));assert.equal((await p.write({action:'dm',targetId:'9',text:'hello',intentId:'one'})).code,code);await p.close();}
});
test('DM diagnostics locate protocol and rejection stages without private payload',async()=>{
 const {createHeyboxDirectMessages}=await import('../src/platforms/heybox/dm.mjs');
 for(const mode of ['protocol','post','readback','before']){
  let posted=false;const dm=createHeyboxDirectMessages({load:async()=>({cookies:{}}),status:async()=>({state:'ready',accountId:'42'}),result:(x)=>x,isClosed:()=>false,request:async(_p?: any,_q?: any,_c?: any,_a?: any,_s?: any,o?: any)=>{
   if(o?.method==='POST'){posted=true;if(mode==='post')throw Error('verification_required');return mode==='protocol'?{heybox__protocol__execute__directly:'heybox://web_auth?token=SECRET'}:{msg_seq:'102'};}
   if(mode==='before'||(posted&&mode==='readback'))throw Error('verification_required');return {sender_info:{user_id:'42'},recipient_info:{user_id:'9'},list:[]};
  }});
  const r: any=await dm.write({targetId:'9',text:'PRIVATE',intentId:'test'});
  assert.equal(r.diagnostic.phase,mode==='before'?'history_before':mode==='readback'?'history_after':'submit');
  assert.equal(r.diagnostic.source,mode==='protocol'?'client_protocol':'exception');
  if(mode==='protocol')assert.equal(r.diagnostic.hint,'web_auth');
  assert.ok(!JSON.stringify(r.diagnostic).includes('SECRET'));assert.ok(!JSON.stringify(r.diagnostic).includes('PRIVATE'));
 }
});
test('opaque server acknowledgement confirms only one new own timed message',async()=>{
 const {createHeyboxDirectMessages}=await import('../src/platforms/heybox/dm.mjs');
 for(const mode of ['unique','duplicate','old','wrong','missing_time']){
  let posted=false;const dm=createHeyboxDirectMessages({load:async()=>({cookies:{}}),status:async()=>({state:'ready',accountId:'42'}),result:(x)=>x,isClosed:()=>false,request:async(_p?: any,_q?: any,_c?: any,_a?: any,_s?: any,o?: any)=>{if(o?.method==='POST'){posted=true;return {heychat_ack_id:'700'};}const row={seq:'102',sender_id:mode==='wrong'?'9':'42',content:'hello',...(mode!=='missing_time'?{send_time:Date.now()-(mode==='old'?120000:0)}:{})};return {sender_info:{user_id:'42'},recipient_info:{user_id:'9'},list:posted?(mode==='duplicate'?[row,{...row,seq:'103'}]:[row]):[{seq:'101',sender_id:'9',content:'incoming'}]};}});
  const r: any=await dm.write({targetId:'9',text:'hello',intentId:'test'});assert.equal(r.confirmed,mode==='unique',mode);if(mode==='unique')assert.equal(r.platformId,'9:102');
 }
});
