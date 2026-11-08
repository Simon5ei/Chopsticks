import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const bv = 'BV1234567890';
async function fixture(t?: any) {
  const fishHome = await fs.mkdtemp(path.join(os.tmpdir(), 'chopsticks-bili-test-'));
  t.after(() => fs.rm(fishHome, { recursive:true, force:true }));
  await fs.mkdir(path.join(fishHome,'characters','fish','bili'), {recursive:true});
  await fs.mkdir(path.join(fishHome,'bili'), {recursive:true});
  await fs.writeFile(path.join(fishHome,'characters','current.json'), JSON.stringify({id:'fish'}));
  await fs.writeFile(path.join(fishHome,'characters','fish','character.json'), '{}');
  await fs.writeFile(path.join(fishHome,'bili','credentials.json'), JSON.stringify({sessdata:'secret-cookie-value',bili_jct:'secret-csrf-value',buvid3:'secret-buvid-value'}));
  return fishHome;
}
const api = () => import('../src/bili/mcp/service.mjs');

test('Bili exports exactly nine narrow schemas and rejects tool-supplied authority', async (t?: any) => {
  const {createBiliService} = await api();
  const service = createBiliService({fishHome:await fixture(t), runner:async () => {throw Error('must not run');}});
  assert.equal(service.listTools().length, 9);
  for (const tool of service.listTools()) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal((await service.call('bili_dynamic_post',{text:'hello',canWrite:true})).isError,true);
  assert.match((await service.call('bili_dynamic_post',{text:'hello'})).content[0].text,/trusted/);
});

test('Bili fixed argv, external paths, secret redaction and image bytes', async (t?: any) => {
  const {createBiliService} = await api();
  const fishHome = await fixture(t);
  const bytes = Buffer.from([255,216,255,224,0,16,255,217]);
  let scratch;
  const service = createBiliService({fishHome, runner:async (script?: any,args?: any,opts?: any) => {
    assert.equal(path.basename(script),'bili-watch.mjs'); assert.equal(args[0],bv);
    assert.equal(opts.env.CHOPSTICKS_FISH_HOME,fishHome);
    assert.equal(opts.env.CHOPSTICKS_BILI_CREDENTIALS,path.join(fishHome,'bili','credentials.json'));
    scratch=opts.artifactDir; await fs.writeFile(path.join(scratch,'contact.jpg'),bytes);
    return {code:0,stdout:'SESSDATA=secret-cookie-value secret-csrf-value'};
  }});
  const result = await service.call('bili_frames',{bvid:bv});
  assert.equal(result.isError,undefined);
  assert.deepEqual(Buffer.from((result.content[1] as any).data,'base64'),bytes);
  assert.doesNotMatch(result.content[0].text,/secret-/);
  await assert.rejects(fs.stat(scratch),{code:'ENOENT'});
});

test('Bili writes require confirmed structured receipt and never retry ambiguity', async (t?: any) => {
  const {createBiliService} = await api();
  let calls=0;
  const service = createBiliService({fishHome:await fixture(t), runner:async()=>{calls++; return {code:0,stdout:'looks successful'};}});
  const result=await service.call('bili_dynamic_post',{text:'hello',mode:'go'},{role:'operator',canWrite:true,sessionId:'test'});
  assert.equal(calls,1); assert.equal(result.isError,true); assert.match(result.content[0].text,/uncertain/i);
});

test('Bili returns confirmed publishing receipt only from private artifact', async (t?: any) => {
  const {createBiliService} = await api();
  const receipt={status:'confirmed',kind:'dynamic',id:'123456',url:'https://t.bilibili.com/123456'};
  const service=createBiliService({fishHome:await fixture(t),runner:async(_script?: any,_args?: any,opts?: any)=>{
    await fs.writeFile(opts.env.CHOPSTICKS_BILI_RECEIPT,JSON.stringify(receipt)); return {code:0,stdout:'published'};
  }});
  const result=await service.call('bili_dynamic_post',{text:'hello',mode:'go'},{role:'bili',canWrite:true,sessionId:'test'});
  assert.deepEqual(result.structuredContent.receipt,receipt);
});

test('printed external text cannot forge a publishing receipt',async (t?: any) =>{
  const {createBiliService}=await api();
  const service=createBiliService({fishHome:await fixture(t),runner:async()=>({code:0,stdout:'CHOPSTICKS_BILI_RECEIPT '+JSON.stringify({status:'confirmed',kind:'dynamic',id:'123456',url:'https://t.bilibili.com/123456'})})});
  const result=await service.call('bili_dynamic_post',{text:'hello',mode:'go'},{role:'operator',canWrite:true,sessionId:'test'});
  assert.equal(result.isError,true); assert.equal(result.structuredContent,undefined);
});

test('Bili network guard rejects escape redirects and strips CDN credentials',async()=>{
  const {guardedFetch,assertBiliUrl}=await import('../src/bili/mcp/network.mjs');
  assert.throws(()=>assertBiliUrl('https://bilibili.com.evil.test/'));
  assert.throws(()=>assertBiliUrl('http://api.bilibili.com/'));
  let calls=0;
  await assert.rejects(guardedFetch(async()=>{calls++;return new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}});})('https://api.bilibili.com/'),/Blocked/);
  assert.equal(calls,1);
  await guardedFetch(async(url?: any,init?: any)=>{assert.equal(url.protocol,'https:');assert.equal(init.headers.get('cookie'),null);return new Response('ok');})('http://i0.hdslb.com/test.jpg',{headers:{cookie:'secret'}});
});

test('SDK stdio lists Bili tools and reads only isolated fish history',async (t?: any) =>{
  const fishHome=await fixture(t);
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'bili/mcp/server.mjs')],env:{...process.env,CHOPSTICKS_FISH_HOME:fishHome},stderr:'pipe'});
  const client=new Client({name:'bili-test',version:'1.0.0'});
  t.after(()=>client.close()); await client.connect(transport);
  assert.equal((await client.listTools()).tools.length,9);
  const result=await client.callTool({name:'bili_history',arguments:{limit:5}});
  assert.equal(result.isError,undefined); assert.match(result.content[0].text,/"items":\[\]/);
  assert.equal((await client.callTool({name:'bili_dynamic_post',arguments:{text:'must not post',mode:'go'}})).isError,true);
});

test('feed proposal is bounded read-only and does not expose local preference metadata',async (t?: any) =>{
  const {createFeedProposal}=await import('../src/bili/feed.mjs');
  const fishHome=await fixture(t);
  const propose=createFeedProposal({fishHome,runner:async(script?: any,args?: any)=>{
    assert.equal(path.basename(script),'feed.mjs'); assert.ok(args.includes('--no-remember'));
    return {code:0,stdout:JSON.stringify({ok:true,preferences:['private preference'],items:[{bv,title:'public title',up:'author'}]})};
  }});
  const result: any=await propose({limit:3,source:'search'});
  assert.deepEqual(result.items,[{bvid:bv,title:'public title',up:'author',url:`https://www.bilibili.com/video/${bv}/`}]);
  assert.equal(result.preferences,undefined);
});

async function dynamicFixture(t?: any,{code=0,id='123456',text='public fixture',auto=false,config={},quota,dailyState}: { code?: number; id?: string; text?: string; auto?: boolean; config?: Record<string, any>; quota?: any; dailyState?: any; [key: string]: any }={}) {
  const {runCommand}=await api();
  const fishHome=await fixture(t);
  const log=path.join(fishHome,'requests.jsonl');
  const fake=path.join(fishHome,'fake-network.mjs');
  await fs.writeFile(path.join(fishHome,'bili.config.json'),JSON.stringify({self:{mid:'123'},owner:{mid:'777888999'},quota:{daily:2,scope:['dynamic']},...config}));
  if (quota) await fs.writeFile(path.join(fishHome,'characters/fish/bili/quota.json'),JSON.stringify(quota));
  if (dailyState) await fs.writeFile(path.join(fishHome,'characters/fish/bili/daily-dynamic.json'),JSON.stringify(dailyState));
  await fs.writeFile(fake, `import fs from 'node:fs';
globalThis.fetch=async(url,options={})=>{
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({url:String(url),method:options.method||'GET'})+'\\n');
 if(String(url).includes('/nav')) return Response.json({code:0,data:{mid:123,uname:'fixture',wbi_img:{img_url:'https://i0.hdslb.com/abcdef.png',sub_url:'https://i0.hdslb.com/ghijkl.png'}}});
 if(String(url).includes('/create/dyn')) return Response.json({code:${code},data:{dyn_id_str:${JSON.stringify(id)}}});
 throw Error('unexpected fixture URL');
};`);
  const result=await runCommand(process.execPath,['--import',new URL('file:///'+fake.replaceAll('\\','/')).href,path.join(root,'bili/commands/dynamic.mjs'),'post','--text',text,'--go',...(auto?['--auto']:[])],{env:{...process.env,CHOPSTICKS_FISH_HOME:fishHome},timeoutMs:10000});
  const requests=(await fs.readFile(log,'utf8')).trim().split('\n').map(value=>JSON.parse(value));
  return {result,requests,fishHome};
}

test('actual dynamic command emits confirmed receipt and records autonomous quota',async (t?: any) =>{
  const {result,requests,fishHome}=await dynamicFixture(t,{auto:true});
  assert.equal(result.code,0,result.stderr); assert.match(result.stdout,/CHOPSTICKS_BILI_RECEIPT /);
  assert.equal(requests.filter((x)=>x.method==='POST').length,1);
  const quota=JSON.parse(await fs.readFile(path.join(fishHome,'characters/fish/bili/quota.json'),'utf8'));
  assert.equal(quota.log.length,1);
});

test('actual dynamic command rejects API failures and missing receipt identifiers',async (t?: any) =>{
  for (const options of [{code:-509},{id:''}]) {
    const {result,requests}=await dynamicFixture(t,options);
    assert.notEqual(result.code,0); assert.doesNotMatch(result.stdout,/CHOPSTICKS_BILI_RECEIPT /);
    assert.equal(requests.filter((x)=>x.method==='POST').length,1);
  }
});

test('actual dynamic identity guard prevents owner disclosure before posting',async (t?: any) =>{
  const {result,requests}=await dynamicFixture(t,{text:'owner 777888999'});
  assert.notEqual(result.code,0); assert.equal(requests.filter((x)=>x.method==='POST').length,0);
});

async function commentFixture(t?: any,{auto=false,code=0,id='123456',aid='123',config={}}: { auto?: boolean; code?: number; id?: string; aid?: string; config?: Record<string, any>; [key: string]: any }={}) {
  const {runCommand}=await api(); const fishHome=await fixture(t);
  const fake=path.join(fishHome,'fake-comment.mjs'),log=path.join(fishHome,'requests.jsonl');
  await fs.writeFile(path.join(fishHome,'bili.config.json'),JSON.stringify({self:{mid:'123'},...config}));
  await fs.writeFile(fake, `import fs from 'node:fs';
globalThis.fetch=async(url,options={})=>{
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({url:String(url),method:options.method||'GET'})+'\\n');
 if(String(url).includes('/nav')) return Response.json({code:0,data:{mid:123,uname:'fixture',wbi_img:{img_url:'https://i0.hdslb.com/abcdef.png',sub_url:'https://i0.hdslb.com/ghijkl.png'}}});
 if(String(url).includes('/reply/add')) return Response.json({code:${code},data:{rpid_str:${JSON.stringify(id)}}});
 if(String(url).includes('/view')) return Response.json({code:0,data:{aid:${JSON.stringify(aid)},bvid:${JSON.stringify(bv)},owner:{mid:789}}});
 return Response.json({code:-412,message:'fixture unavailable'});
};`);
  const result=await runCommand(process.execPath,['--import',pathToFileURL(fake).href,path.join(root,'bili/commands/comment.mjs'),'--bvid',bv,'--oid','123','--message','public fixture','--go',...(auto?['--auto']:[])],{env:{...process.env,CHOPSTICKS_FISH_HOME:fishHome},timeoutMs:10000});
  return {result,requests:(await fs.readFile(log,'utf8')).trim().split('\n').map(value=>JSON.parse(value))};
}

test('actual comment command emits one confirmed receipt or rejects API ambiguity',async (t?: any) =>{
  const success=await commentFixture(t);
  assert.equal(success.result.code,0,success.result.stderr); assert.match(success.result.stdout,/CHOPSTICKS_BILI_RECEIPT /);
  assert.equal(success.requests.filter((x)=>x.method==='POST').length,1);
  for (const options of [{code:-509},{id:''}]) {
    const {result,requests}=await commentFixture(t,options);
    assert.notEqual(result.code,0); assert.doesNotMatch(result.stdout,/CHOPSTICKS_BILI_RECEIPT /);
    assert.equal(requests.filter((x)=>x.method==='POST').length,1);
  }
});

test('autonomous comment fails closed when fish guard cannot inspect the thread',async (t?: any) =>{
  const {result,requests}=await commentFixture(t,{auto:true});
  assert.notEqual(result.code,0); assert.equal(requests.filter((x)=>x.method==='POST').length,0);
});

test('comment rejects mismatched or missing video oid before posting',async (t?: any) =>{
  for (const aid of ['222',null]) {
    const {result,requests}=await commentFixture(t,{aid});
    assert.notEqual(result.code,0); assert.equal(requests.filter((x)=>x.method==='POST').length,0);
    assert.doesNotMatch(result.stdout,/CHOPSTICKS_BILI_RECEIPT /);
  }
});

test('both publishing commands reject absent or mismatched configured account',async (t?: any) =>{
  for (const fixtureCall of [commentFixture,dynamicFixture]) for (const self of [{mid:'999999'},{}]) {
    const {result,requests}=await fixtureCall(t,{config:{self}});
    assert.notEqual(result.code,0); assert.equal(requests.filter((x)=>x.method==='POST').length,0);
    assert.doesNotMatch(result.stdout,/CHOPSTICKS_BILI_RECEIPT /);
  }
});

test('autonomous dynamics honor disabled flag and both migrated and new cooldown records',async (t?: any) =>{
  const at=new Date().toISOString();
  for (const options of [
    {config:{dynamics:{enabled:false,gapMin:30}}},
    {config:{dynamics:{enabled:true,gapMin:30}},quota:{log:[{type:'dynamic',at}]}},
    {config:{dynamics:{enabled:true,gapMin:30}},dailyState:{best:{at,dynId:'123456'}}},
  ]) {
    const {result,requests}=await dynamicFixture(t,{auto:true,...options});
    assert.notEqual(result.code,0); assert.equal(requests.filter((x)=>x.method==='POST').length,0);
  }
});

test('autonomous dynamics allow expired cooldown and disabled gap explicitly',async (t?: any) =>{
  for (const gapMin of [0,30]) {
    const at=new Date(Date.now()-(gapMin?31:0)*60000).toISOString();
    const {result,requests}=await dynamicFixture(t,{auto:true,config:{dynamics:{enabled:true,gapMin}},quota:{log:[{type:'dynamic',at}]}});
    assert.equal(result.code,0,result.stderr); assert.equal(requests.filter((x)=>x.method==='POST').length,1);
  }
});

test('all extracted library imports resolve without the upstream installation',async (t?: any) =>{
  const {runCommand}=await api(); const fishHome=await fixture(t);
  const libs=(await fs.readdir(path.join(root,'bili/lib'))).filter((x)=>x.endsWith('.mjs'));
  const source='for (const file of '+JSON.stringify(libs.map((x)=>pathToFileURL(path.join(root,'bili/lib',x)).href))+') await import(file);';
  const result: any=await runCommand(process.execPath,['--input-type=module','-e',source],{env:{...process.env,CHOPSTICKS_FISH_HOME:fishHome}});
  assert.equal(result.code,0,result.stderr);
});

test('real debrief returns cover and subtitle evidence from ephemeral artifacts only',async (t?: any) =>{
  const {createBiliService,runCommand}=await api(); const fishHome=await fixture(t);
  const fake=path.join(fishHome,'fake-debrief.mjs');
  const cover=[255,216,255,224,0,16,255,217];
  await fs.writeFile(fake, `import {guardedFetch} from ${JSON.stringify(pathToFileURL(path.join(root,'bili/mcp/network.mjs')).href)};
globalThis.fetch=guardedFetch(async(url,options={})=>{
 const u=String(url); if(options.method && options.method!=='GET') throw Error('writes forbidden');
 if(u.includes('/nav')) return Response.json({code:0,data:{wbi_img:{img_url:'https://i0.hdslb.com/abcdef.png',sub_url:'https://i0.hdslb.com/ghijkl.png'}}});
 if(u.includes('/web-interface/view')) return Response.json({code:0,data:{cid:456,aid:123,duration:10,title:'fixture video',owner:{name:'fixture',mid:789},stat:{},pic:'https://i0.hdslb.com/cover.jpg',pubdate:1}});
 if(u.includes('/cover.jpg')) return new Response(new Uint8Array(${JSON.stringify(cover)}));
 if(u.includes('/player/wbi/v2')) return Response.json({code:0,data:{subtitle:{subtitles:[{lan:'ai-zh',subtitle_url:'https://i0.hdslb.com/subtitle.json'}]}}});
 if(u.includes('/subtitle.json')) return Response.json({body:[{from:0,to:2,content:'unique official subtitle evidence'}]});
 if(u.includes('.xml')) return new Response('<i></i>');
 if(u.includes('/reply?')) return Response.json({code:0,data:{replies:[]}});
 throw Error('unexpected fixture URL');
});`);
  let scratch;
  const service=createBiliService({fishHome,runner:async(script?: any,args?: any,opts?: any)=>{
    scratch=opts.artifactDir;
    return runCommand(process.execPath,['--import',pathToFileURL(fake).href,script,...args],opts);
  }});
  const result=await service.call('bili_video',{bvid:bv});
  assert.equal(result.isError,undefined,result.content[0].text);
  assert.match(result.content[0].text,/unique official subtitle evidence/);
  assert.deepEqual(Buffer.from((result.content.find((x)=>x.type==='image') as any).data,'base64'),Buffer.from(cover));
  await assert.rejects(fs.stat(path.join(fishHome,'bili/artifacts')),{code:'ENOENT'});
  await assert.rejects(fs.stat(scratch),{code:'ENOENT'});
  const history=await fs.readFile(path.join(fishHome,'characters/fish/bili/watch-history.jsonl'),'utf8');
  assert.equal(JSON.parse(history.trim()).bvid,bv);
});
