import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBiliService, runCommand } from '../src/bili/mcp/service.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const dynamicId = '1192845067890123456';
const oid = '1192845067890123457';
const rpid = '1192845067890123458';
const context = { role:'operator', canWrite:true, sessionId:'fixture', characterId:'fish' };
const input = { type:17, dynamicId, oid, message:'public fixture', mode:'go' };

// HTTP is replaced in the child before any command runs. Unexpected requests
// throw; this fixture never falls through to a live network implementation.
async function fixture(t?: any, { detail, status=200, reply, config={}, quota }: { detail?: any; status?: number; reply?: any; config?: Record<string, any>; quota?: any; [key: string]: any } = {}) {
  const fishHome = await fs.mkdtemp(path.join(os.tmpdir(), 'chopsticks-dynamic-reply-'));
  t.after(() => fs.rm(fishHome, { recursive:true, force:true }));
  await fs.mkdir(path.join(fishHome,'characters/fish/bili'), {recursive:true});
  await fs.mkdir(path.join(fishHome,'bili'));
  await fs.writeFile(path.join(fishHome,'characters/current.json'), JSON.stringify({id:'fish'}));
  await fs.writeFile(path.join(fishHome,'characters/fish/character.json'), '{}');
  await fs.writeFile(path.join(fishHome,'bili/credentials.json'), JSON.stringify({sessdata:'fixture-cookie',bili_jct:'fixture-csrf',buvid3:'fixture-buvid'}));
  await fs.writeFile(path.join(fishHome,'bili.config.json'), JSON.stringify({self:{mid:'123'},owner:{mid:'777888999'},...config}));
  if (quota) await fs.writeFile(path.join(fishHome,'characters/fish/bili/quota.json'), JSON.stringify(quota));
  const log = path.join(fishHome,'requests.jsonl');
  const fake = path.join(fishHome,'fake-network.mjs');
  await fs.writeFile(fake, `import fs from 'node:fs';
globalThis.fetch=async(url,options={})=>{
 const u=String(url);
 fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({url:u,method:options.method||'GET',referer:options.headers?.referer,body:options.body?.toString()})+'\\n');
 if(u==='https://api.bilibili.com/x/web-interface/nav') return Response.json({code:0,data:{mid:123,uname:'fixture',wbi_img:{img_url:'https://i0.hdslb.com/abcdef.png',sub_url:'https://i0.hdslb.com/ghijkl.png'}}});
 if(u==='https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=1192845067890123456') return new Response(${JSON.stringify(detail ?? JSON.stringify({code:0,data:{item:{id_str:dynamicId,basic:{comment_id_str:oid,comment_type:17}}}}))}, {status:${status}});
 if(u.includes('/web-interface/view?')) return Response.json({code:0,data:{aid:123,bvid:'BV1234567890',owner:{mid:789}}});
 if(u.startsWith('https://api.bilibili.com/x/v2/reply/add?') || u==='https://api.bilibili.com/x/v2/reply/add') return new Response(${JSON.stringify(reply ?? JSON.stringify({code:0,data:{rpid_str:rpid}}))});
 if(u.includes('/x/v2/reply/reply?')) return Response.json({code:0,data:{replies:[{rpid:456,mid:789,member:{mid:'789',uname:'fixture'}}]}});
 if(u.includes('/x/v2/reply?') || u.includes('/feed/space?')) return Response.json({code:-412,message:'fixture unavailable'});
 throw Error('unexpected fixture URL');
};`);
  let calls=0;
  const runner = async(script?: any,args?: any,opts?: any) => {
    calls++;
    return runCommand(process.execPath, ['--import',pathToFileURL(fake).href,script,...args], opts);
  };
  const service = createBiliService({fishHome,runner});
  const requests = async() => (await fs.readFile(log,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(value=>JSON.parse(value));
  return {service,runner,fishHome,requests,calls:()=>calls};
}

test('MCP dynamic comments preserve exact IDs, both reply IDs, and canonical receipt', async (t?: any) => {
  const f=await fixture(t);
  const result=await f.service.call('bili_comment',{...input,root:'455',parent:'456'},context);
  assert.equal(result.isError,undefined,result.content[0].text);
  assert.deepEqual(result.structuredContent.receipt,{status:'confirmed',kind:'comment',id:rpid,url:'https://t.bilibili.com/1192845067890123456#reply1192845067890123458'});
  const requests=await f.requests();
  const post=requests.filter((x)=>x.method==='POST');
  assert.equal(post.length,1);
  const body=new URLSearchParams(post[0].body);
  assert.equal(body.get('oid'),'1192845067890123457');
  assert.equal(body.get('type'),'17');
  assert.equal(body.get('root'),'455');
  assert.equal(body.get('parent'),'456');
  assert.equal(post[0].referer,'https://t.bilibili.com/1192845067890123456');
  assert.equal(requests.filter((x)=>x.url.endsWith('/detail?id=1192845067890123456')).length,1);
});

test('MCP dynamic type 11 and dry default perform verified preview without a write', async (t?: any) => {
  const f=await fixture(t,{detail:JSON.stringify({code:0,data:{item:{id_str:dynamicId,basic:{comment_id_str:oid,comment_type:11}}}})});
  const {mode,...preview}=input;
  const result=await f.service.call('bili_comment',{...preview,type:11},context);
  assert.equal(result.isError,undefined,result.content[0].text);
  assert.equal(result.structuredContent,undefined);
  assert.equal((await f.requests()).filter((x)=>x.method==='POST').length,0);
  assert.equal((await f.requests()).filter((x)=>x.url.includes('/detail?')).length,1);
});

test('command rejects mismatched, unavailable or incomplete dynamic targets before any POST', async (t?: any) => {
  for (const options of [
    {detail:JSON.stringify({code:0,data:{item:{id_str:dynamicId,basic:{comment_id_str:'999',comment_type:17}}}})},
    {detail:JSON.stringify({code:0,data:{item:{id_str:dynamicId,basic:{comment_id_str:oid,comment_type:11}}}})},
    {detail:JSON.stringify({code:0,data:{item:{id_str:'999',basic:{comment_id_str:oid,comment_type:17}}}})},
    {detail:JSON.stringify({code:0,data:{item:{id_str:dynamicId,basic:{comment_type:17}}}})},
    {detail:'{"code":-412}'}, {detail:'not json'}, {status:503},
  ]) {
    const f=await fixture(t,options);
    // Exercise the real lower command too: target validation cannot rely on a
    // model or on the MCP caller's choice of oid/type.
    const result: any=await f.runner(path.join(project,'bili/commands/comment.mjs'),['--oid',oid,'--type','17','--referer','https://t.bilibili.com/'+dynamicId,'--message','public fixture','--go'],{env:{...process.env,CHOPSTICKS_FISH_HOME:f.fishHome},timeoutMs:10000});
    assert.notEqual(result.code,0,result.stdout);
    assert.equal((await f.requests()).filter((x)=>x.method==='POST').length,0);
  }
});

test('numeric dynamic and receipt IDs are read from JSON source without rounding', async (t?: any) => {
  const f=await fixture(t,{
    detail:'{"code":0,"data":{"item":{"id_str":1192845067890123456,"basic":{"comment_id_str":1192845067890123457,"comment_type":17}}}}',
    reply:'{"code":0,"data":{"rpid":1192845067890123458}}',
  });
  const result=await f.service.call('bili_comment',input,context);
  assert.equal(result.isError,undefined,result.content[0].text);
  assert.equal(result.structuredContent.receipt.id,'1192845067890123458');
});

test('MCP rejects invalid target combinations, partial threads and arbitrary referers before commands', async (t?: any) => {
  const f=await fixture(t);
  const {dynamicId:omitDynamic,...noDynamic}=input;
  for (const args of [
    {...noDynamic}, {...input,bvid:'BV1234567890'}, {...input,type:1}, {...input,type:2},
    {...input,dynamicId:1192845067890123456}, {...input,referer:'https://evil.test/'},
    {...input,root:'455'}, {...input,parent:'456'}, {oid:'123',message:'public fixture'},
  ]) assert.equal((await f.service.call('bili_comment',args,context)).isError,true);
  assert.equal(f.calls(),0);
});

test('dynamic comments retain trusted caller and current-character authorization', async (t?: any) => {
  const f=await fixture(t);
  for (const caller of [{},{...context,canWrite:false},{...context,role:'qq'},{...context,sessionId:''},{...context,characterId:'other'}]) {
    assert.equal((await f.service.call('bili_comment',input,caller)).isError,true);
  }
  assert.equal(f.calls(),0);
  const result=await f.service.call('bili_comment',{...input,root:'455',parent:'456'},{...context,role:'bili'});
  assert.equal(result.isError,undefined,result.content[0].text);
  const quota=JSON.parse(await fs.readFile(path.join(f.fishHome,'characters/fish/bili/quota.json'),'utf8'));
  assert.equal(quota.log[0].auto,true);
});

test('MCP validates dynamic comment receipts against the exact dynamic and ignores stdout claims', async (t?: any) => {
  const f=await fixture(t);
  for (const url of ['https://www.bilibili.com/video/BV1234567890/#reply'+rpid,'https://t.bilibili.com/999#reply'+rpid,null]) {
    let calls=0;
    const receipt={status:'confirmed',kind:'comment',id:rpid,url:url??'https://t.bilibili.com/'+dynamicId+'#reply'+rpid};
    const service=createBiliService({fishHome:f.fishHome,runner:async(_script?: any,_args?: any,opts?: any)=>{
      calls++;
      if(url) await fs.writeFile(opts.env.CHOPSTICKS_BILI_RECEIPT,JSON.stringify(receipt));
      return {code:0,stdout:'CHOPSTICKS_BILI_RECEIPT '+JSON.stringify(receipt)};
    }});
    const result=await service.call('bili_comment',input,context);
    assert.equal(calls,1);
    assert.equal(result.isError,true);
    assert.equal(result.structuredContent,undefined);
    assert.match(result.content[0].text,/uncertain/i);
  }
});

test('dynamic comments keep identity, fish, quota and ambiguous-send guards', async (t?: any) => {
  const scenarios=[
    {args:{...input,message:'owner 777888999'},options:{},caller:context,writes:0},
    {args:input,options:{config:{self:{mid:'999'}}},caller:context,writes:0},
    {args:input,options:{},caller:{...context,role:'bili'},writes:0},
    {args:{...input,root:'455',parent:'456'},options:{quota:{log:[{type:'comment',auto:true,reply:true,at:new Date().toISOString(),parent:'456'}]}},caller:{...context,role:'bili'},writes:0},
    {args:input,options:{reply:'{"code":-509}'},caller:context,writes:1},
    {args:input,options:{reply:'{"code":0,"data":{}}'},caller:context,writes:1},
  ];
  for (const scenario of scenarios) {
    const f=await fixture(t,scenario.options);
    const result=await f.service.call('bili_comment',scenario.args,scenario.caller);
    assert.equal(result.isError,true);
    assert.equal(result.structuredContent,undefined);
    assert.equal((await f.requests()).filter((x)=>x.method==='POST').length,scenario.writes);
    assert.equal(f.calls(),1);
  }
});

test('video comments keep type 1 default, aid validation and video receipt', async (t?: any) => {
  const f=await fixture(t);
  const result=await f.service.call('bili_comment',{bvid:'BV1234567890',oid:'123',message:'public fixture',mode:'go'},context);
  assert.equal(result.isError,undefined,result.content[0].text);
  assert.equal(result.structuredContent.receipt.url,'https://www.bilibili.com/video/BV1234567890/#reply1192845067890123458');
  const bad=await f.service.call('bili_comment',{bvid:'BV1234567890',oid:'999',message:'public fixture',mode:'go'},context);
  assert.equal(bad.isError,true);
  assert.equal((await f.requests()).filter((x)=>x.method==='POST').length,1);
});
