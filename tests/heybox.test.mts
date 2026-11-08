import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHeyboxPlatform, generateHeyboxSignature } from '../src/adapters/heybox.mjs';

const dir = () => mkdtemp(join(tmpdir(), 'heybox-test-'));

test('signature uses fixed upstream vector', () => {
  assert.deepEqual(generateHeyboxSignature('/bbs/app/feeds', 1700000000, 'ABCDEF123456'), { hkey: 'V2V1Z67', _time: 1700000000, nonce: 'ABCDEF123456' });
});
test('HTTP JSON body is bounded before parse and the reader is cancelled',async()=>{
 const {readHeyboxJson}=await import('../src/adapters/heybox.mjs');let cancelled=false,reads=0;
 await assert.rejects(()=>readHeyboxJson({headers:new Headers(),body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array(1048577)};},cancel:async()=>{cancelled=true;}})}}));
 assert.equal(reads,1);assert.equal(cancelled,true);assert.deepEqual(await readHeyboxJson(new Response('{"status":"ok"}')),{status:'ok'});
});

test('QR session retains temporary cookies, stores credentials privately and does not disclose them', async () => {
  const stateDir = await dir(); let clock = 1000; const calls = [];
  const transport = async (r?: any) => { calls.push(r); if (r.path.includes('get_qrcode')) return {payload:{status:'ok',result:{qr_url:'https://example.test/?token=abc',expires_in:120}},cookies:{temporary:'secret'}}; if (r.path.includes('qr_state')) return {payload:{status:'ok',result:{state:'success',heybox_id:'42',pkey:'private'}},cookies:{}}; return {payload:{status:'ok',result:{profile:{heybox_id:'42'}}},cookies:{}}; };
  const p = createHeyboxPlatform({config:{},stateDir,now:()=>clock,transport,renderQr:async()=>Buffer.from('png')});
  const started = await p.login({action:'start'}); assert.equal(started.state,'waiting'); if (process.platform !== 'win32') assert.equal((await stat(started.qrImagePath)).mode & 0o777,0o600);
  const finished = await p.login({action:'poll'}); assert.equal(finished.state,'success'); assert.equal(calls[1].cookies.temporary,'secret');
  if (process.platform !== 'win32') assert.equal((await stat(join(stateDir,'auth.json'))).mode & 0o777,0o600);
  assert.match(await readFile(join(stateDir,'auth.json'),'utf8'), /private/);
  const status = await p.status(); assert.equal(status.state,'ready'); assert.equal(status.accountId,'42');
  assert.doesNotMatch(JSON.stringify([started,finished,status]),/secret|private|token=abc/);
  await p.close();
});

test('expired or aborted QR never polls and unauthenticated writes are refused', async () => {
  let clock=1000, count=0; const p=createHeyboxPlatform({config:{},stateDir:await dir(),now:()=>clock,renderQr:async()=>Buffer.from('png'),transport:async()=>{count++;return {payload:{status:'ok',result:{qr_url:'https://example.test/?x=1',expires_in:10}},cookies:{}};}});
  await p.login({action:'start'}); clock+=11000; assert.equal((await p.login({action:'poll'})).state,'expired'); assert.equal(count,1);
  const c=new AbortController(); c.abort(); assert.equal((await p.login({action:'start',signal:c.signal})).state,'cancelled');
  assert.equal((await p.write({action:'like',targetId:'1',intentId:'x'})).state,'login_required'); assert.equal(p.capabilities.like,true); await p.close();
});

test('read normalizes stable IDs and reports limits and malformed records', async () => {
  const stateDir=await dir(); const { writeFile }=await import('node:fs/promises'); await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',pkey:'private'},deviceId:'a'}));
  const p=createHeyboxPlatform({config:{},stateDir,transport:async()=>({payload:{status:'ok',result:{links:[{link_id:'7',title:'hello',summary:'world'}, {title:'no id'}, {link_id:'8',title:'other'}]}},cookies:{}})});
  const result=await p.read({action:'feed',limit:1}); assert.equal(result.items[0].id,'7'); assert.equal(result.items[0].visibility,'public'); assert.equal(result.truncated,true); assert.ok(result.warnings.length); assert.doesNotMatch(JSON.stringify(result),/private/); await p.close();
});



test('grouped thread comments preserve IDs and pagination', async () => {
 const stateDir=await dir(); const {writeFile}=await import('node:fs/promises'); await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',pkey:'private'}}));
 const p=createHeyboxPlatform({config:{},stateDir,transport:async()=>({payload:{status:'ok',result:{link:{linkid:7,title:'a'},comments:[{comment:[{commentid:'c1',text:'hi',user:{userid:10}}]}],has_more_floors:1}},cookies:{}})});
 const r=await p.read({action:'comments',id:'7',limit:10}); assert.equal(r.items[0].id,'c1'); assert.equal(r.items[0].actorId,'10'); assert.equal(r.truncated,true); await p.close();
});

test('status requires authenticated identity response, not an empty successful feed', async () => {
 const stateDir=await dir(); const {writeFile}=await import('node:fs/promises'); await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',pkey:'private'}}));
 const p=createHeyboxPlatform({config:{},stateDir,transport:async()=>({payload:{status:'ok',result:{}},cookies:{}})});
 assert.notEqual((await p.status()).state,'ready'); await p.close();
});

test('feed supports topic board and preserves only source-provided URL', async () => {
 const stateDir=await dir(); const {writeFile}=await import('node:fs/promises'); await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',pkey:'private'}})); let called;
 const p=createHeyboxPlatform({config:{},stateDir,transport:async (r?: any) =>{called=r; return {payload:{status:'ok',result:{links:[{linkid:7,title:'a',share_url:'https://www.xiaoheihe.cn/foo'}, {linkid:8,title:'b'}]}},cookies:{}};}});
 const r=await p.read({action:'feed',id:'123',limit:10}); assert.equal(called.path,'/bbs/app/topic/feeds'); assert.equal(called.params.topic_id,'123'); assert.equal(r.items[0].url,'https://www.xiaoheihe.cn/foo'); assert.equal(r.items[1].url,undefined); await p.close();
});

test('cancelling login invalidates and removes its QR image', async () => {
 const stateDir=await dir(); const p=createHeyboxPlatform({config:{},stateDir,renderQr:async()=>Buffer.from('png'),transport:async()=>({payload:{status:'ok',result:{qr_url:'https://example.test/?x=1'}},cookies:{}})});
 const s=await p.login({action:'start'}); const c=new AbortController(); c.abort(); assert.equal((await p.login({action:'poll',signal:c.signal})).state,'cancelled'); await assert.rejects(stat(s.qrImagePath),{code:'ENOENT'}); assert.equal((await p.login({action:'poll'})).state,'expired'); await p.close();
});

test('source URLs do not disclose tracking or credentials in query strings', async () => {
 const stateDir=await dir(); const {writeFile}=await import('node:fs/promises'); await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',pkey:'private'}})); const p=createHeyboxPlatform({config:{},stateDir,transport:async()=>({payload:{status:'ok',result:{links:[{linkid:7,title:'a',share_url:'https://www.xiaoheihe.cn/a?token=secret#part'}]}},cookies:{}})});
 const r=await p.read({action:'feed'}); assert.equal(r.items[0].url,'https://www.xiaoheihe.cn/a'); await p.close();
});

test('concurrent QR operations do not create multiple sessions', async () => {
 let release; const gate=new Promise<any | void>((r)=>release=r); let count=0; const p=createHeyboxPlatform({config:{},stateDir:await dir(),renderQr:async()=>Buffer.from('png'),transport:async()=>{count++;await gate;return {payload:{status:'ok',result:{qr_url:'https://example.test/?x=1'}},cookies:{}};}});
 const pending=p.login({action:'start'}); await new Promise<any | void>((r)=>setImmediate(r)); const concurrent=p.login({action:'start'}); release(); assert.equal((await concurrent).state,'busy'); assert.equal((await pending).state,'waiting'); assert.equal(count,1); await p.close();
});
test('native private message requests preserve upstream web version on GET and POST',async()=>{
 const {writeFile}=await import('node:fs/promises');const stateDir=await dir();await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',user_pkey:'secret'},deviceId:'stable'}));
 const original=globalThis.fetch,calls=[];globalThis.fetch=async(url?: any,options?: any)=>{const u=new URL(url);calls.push({path:u.pathname,version:u.searchParams.get('web_version'),method:options.method});const result=u.pathname.includes('restore_login')?{profile:{heybox_id:'42'}}:options.method==='POST'?{}:{sender_info:{user_id:'42'},recipient_info:{user_id:'9'},list:[]};return new Response(JSON.stringify({status:'ok',result}));};
 const p=createHeyboxPlatform({stateDir});try{await p.write({action:'dm',targetId:'9',text:'test',intentId:'i'});const dm=calls.filter((x)=>x.path==='/chatroom/v2/msg/user');assert.equal(dm.length,2);assert.deepEqual(dm.map((x)=>x.version),['2.5','2.5']);assert.deepEqual(dm.map((x)=>x.method),['GET','POST']);assert.equal(calls[0].version,null);}finally{globalThis.fetch=original;await p.close();}
});
