import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readBiliDynamicReceipt} from '../bili/lib/dynamic-readback.mjs';

const receipt={status:'confirmed',kind:'dynamic',id:'1261813571425140745',url:'https://t.bilibili.com/1261813571425140745'};
const item=()=>({id_str:receipt.id,modules:{module_author:{mid:'90001'},module_dynamic:{desc:{text:'pong'}}}});
async function fixture(t,handle){
 const fishHome=await fs.mkdtemp(path.join(os.tmpdir(),'bili-readback-'));t.after(()=>fs.rm(fishHome,{recursive:true,force:true}));
 await fs.mkdir(path.join(fishHome,'bili'));
 await fs.writeFile(path.join(fishHome,'bili/credentials.json'),JSON.stringify({sessdata:'fixture-cookie',bili_jct:'fixture-csrf',buvid3:'fixture-buvid'}));
 await fs.writeFile(path.join(fishHome,'bili.config.json'),JSON.stringify({self:{mid:'90001'}}));
 const requests=[];
 const fetchImpl=async(url,options)=>{const u=new URL(url);requests.push({u,options});return handle?.(u,options)??Response.json({code:0,data:u.pathname.endsWith('/nav')?{mid:90001,isLogin:true}:{item:item()}});};
 return {fishHome,requests,read:extra=>readBiliDynamicReceipt({fishHome,receipt,expectedText:'pong',fetchImpl,...extra})};
}

test('dynamic readback verifies exact server receipt ID, author and text using GET only',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.read(),{status:'verified',kind:'dynamic',id:receipt.id,url:receipt.url});
 assert.equal(f.requests.length,2);assert.ok(f.requests.every(r=>r.options.method==='GET'&&r.options.redirect==='manual'));
 assert.equal(f.requests[1].u.searchParams.get('id'),receipt.id);
});

test('dynamic readback rejects other accounts before inspecting a public item',async t=>{
 const f=await fixture(t,()=>Response.json({code:0,data:{mid:'90002',isLogin:true}}));
 await assert.rejects(f.read(),e=>e.code==='BILI_READBACK_UNKNOWN'&&e.phase==='account');assert.equal(f.requests.length,1);
});

test('dynamic readback requests the Opus projection when the default detail omits its body',async t=>{
 const f=await fixture(t,u=>{
  if(!u.pathname.endsWith('/detail'))return;
  const value=item();
  value.modules.module_dynamic={desc:null,major:u.searchParams.get('features')==='itemOpusStyle'
   ?{type:'MAJOR_TYPE_OPUS',opus:{summary:{text:'pong'}}}
   :{type:'MAJOR_TYPE_DRAW',draw:{items:[]}}};
  return Response.json({code:0,data:{item:value}});
 });
 assert.equal((await f.read()).status,'verified');
 assert.equal(f.requests.length,2);
 assert.equal(f.requests[1].u.searchParams.get('id'),receipt.id);
 assert.equal(f.requests[1].u.searchParams.get('features'),'itemOpusStyle');
 assert.ok(f.requests.every(r=>r.options.method==='GET'));
});

test('dynamic readback never accepts a missing item, different ID, author or body',async t=>{
 const wrongId=item();wrongId.id_str='1261813571425140746';
 const wrongAuthor=item();wrongAuthor.modules.module_author.mid='90002';
 const wrongText=item();wrongText.modules.module_dynamic.desc.text='pong ';
 for(const value of [undefined,wrongId,wrongAuthor,wrongText]){
  const f=await fixture(t,u=>u.pathname.endsWith('/detail')?Response.json({code:0,data:{item:value}}):undefined);
  await assert.rejects(f.read(),e=>e.code==='BILI_READBACK_UNKNOWN'&&e.phase==='verify');assert.equal(f.requests.length,2);
 }
});

test('dynamic readback supports opus text and preserves large numeric identifiers',async t=>{
 const f=await fixture(t,u=>new Response(u.pathname.endsWith('/detail')?'{"code":0,"data":{"item":{"id_str":"1261813571425140745","modules":{"module_author":{"mid":9007199254740993},"module_dynamic":{"major":{"opus":{"summary":{"text":"pong"}}}}}}}}':'{"code":0,"data":{"mid":9007199254740993,"isLogin":true}}'));
 await fs.writeFile(path.join(f.fishHome,'bili.config.json'),JSON.stringify({self:{mid:'9007199254740993'}}));
 assert.equal((await f.read()).status,'verified');
});

test('dynamic readback exposes numeric API code and phase without platform text or credentials',async t=>{
 const f=await fixture(t,u=>u.pathname.endsWith('/detail')?Response.json({code:-412,message:'fixture-cookie private text'}):undefined);
 await assert.rejects(f.read(),e=>{
  assert.equal(e.code,'BILI_READBACK_UNKNOWN');assert.equal(e.phase,'detail');assert.equal(e.apiCode,-412);
  assert.equal(e.endpoint,'/x/polymer/web-dynamic/v1/detail');assert.equal(e.message.includes('fixture-cookie'),false);return true;
 });assert.equal(f.requests.length,2);
});

test('dynamic readback refuses forged receipts before network and never retries failed reads',async t=>{
 const f=await fixture(t,()=>{throw Error('fixture-cookie');});
 for(const changed of [{status:'unknown'},{kind:'dm'},{url:'https://evil.test/'},{id:1261813571425140745}])await assert.rejects(f.read({receipt:{...receipt,...changed}}));
 assert.equal(f.requests.length,0);
 await assert.rejects(f.read(),e=>e.code==='BILI_READBACK_UNKNOWN'&&!e.message.includes('fixture-cookie'));assert.equal(f.requests.length,1);
});

test('dynamic readback bounds responses and cancels on deadline or caller cancellation',async t=>{
 for(const response of [()=>new Response('',{status:302,headers:{location:'https://evil.test'}}),()=>new Response('x'.repeat(1024*1024+1))]){
  const f=await fixture(t,()=>response());await assert.rejects(f.read(),e=>e.code==='BILI_READBACK_UNKNOWN');assert.equal(f.requests.length,1);
 }
 const f=await fixture(t,(_u,options)=>new Promise((_r,reject)=>options.signal.addEventListener('abort',()=>reject(Error('fixture-cookie')),{once:true})));
 await assert.rejects(f.read({timeoutMs:20}),e=>e.code==='BILI_READBACK_UNKNOWN');assert.equal(f.requests.length,1);
 const c=new AbortController();c.abort(Error('fixture-cookie'));await assert.rejects(f.read({signal:c.signal}),e=>e.code==='BILI_READBACK_UNKNOWN'&&!e.message.includes('fixture-cookie'));assert.equal(f.requests.length,1);
});
