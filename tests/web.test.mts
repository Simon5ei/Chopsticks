import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';
import https from 'node:https';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root=fileURLToPath(new URL('../src/',import.meta.url));
async function configFixture(t?: any,webSearch: Record<string, any>={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'chopsticks-web-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'runtime.json');
  await fs.writeFile(file,JSON.stringify({webSearch}));
  return file;
}
function networkFixture(t?: any,route?: any,{addresses=[{address:'93.184.216.34',family:4}]}: { addresses?: any[]; [key: string]: any }={}) {
  const requests=[];
  t.mock.method(dns.promises,'lookup',async()=>addresses);
  const request=(options?: any,callback?: any)=>{
    const req: any=new EventEmitter(); req.destroy=()=>{};
    req.end=(body)=>queueMicrotask(()=>{
      requests.push({options,body});
      const reply=route(options,body);
      const res: any=Readable.from([Buffer.from(reply.body||'')]);
      res.statusCode=reply.status||200; res.headers=reply.headers||{}; res.complete=true;
      callback(res);
    });
    return req;
  };
  t.mock.method(https,'request',request); t.mock.method(http,'request',request);
  return requests;
}

test('web MCP exposes only original query/url schemas and rejects private URL without traffic',async (t?: any) =>{
  const {createWebService}=await import('../src/web/server.mjs');
  const requests=networkFixture(t,()=>{throw Error('must not request');});
  const service=createWebService({configPath:await configFixture(t)});
  assert.deepEqual(service.listTools().map((x)=>x.name),['web_search','web_fetch']);
  assert.deepEqual(Object.keys(service.listTools()[0].inputSchema.properties),['query']);
  assert.deepEqual(Object.keys(service.listTools()[1].inputSchema.properties),['url']);
  for (const url of ['http://127.0.0.1/','http://[::ffff:127.0.0.1]/','file:///tmp/a','https://name:pass@example.com/']) {
    assert.equal((await service.call('web_fetch',{url})).isError,true);
  }
  assert.equal(requests.length,0);
});

test('safe fetch rejects mixed public/private DNS and redirect escapes',async (t?: any) =>{
  const {safeFetch}=await import('../src/web/lib/safe-fetch.mjs');
  const requests=networkFixture(t,()=>({status:302,headers:{location:'http://169.254.169.254/metadata'}}));
  await assert.rejects(safeFetch('https://example.com/start'));
  assert.equal(requests.length,1); assert.equal(requests[0].options.hostname,'93.184.216.34');
  assert.equal(requests[0].options.headers.host,'example.com');
  assert.equal(requests[0].options.servername,'example.com');
  t.mock.method(dns.promises,'lookup',async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]);
  await assert.rejects(safeFetch('https://example.com/private'));
  assert.equal(requests.length,1);
});

test('safe fetch bounds returned unicode text and returns actual response',async (t?: any) =>{
  const {safeFetch}=await import('../src/web/lib/safe-fetch.mjs');
  networkFixture(t,()=>({body:'鱼🐟'.repeat(100)}));
  const result=await safeFetch('https://example.com/text',7);
  assert.equal(Array.from(result.body).length,7); assert.equal(result.truncated,true);
});

test('external config selects Bing and sanitizes CQ/query controls',async (t?: any) =>{
  const {createWebService}=await import('../src/web/server.mjs');
  const requests=networkFixture(t,()=>({body:'<rss><item><title>fixture result</title><link>https://example.com/a</link><description>summary</description></item></rss>'}));
  const service=createWebService({configPath:await configFixture(t,{provider:'bing'})});
  const result=await service.call('web_search',{query:'hello [CQ:at,qq=123]\n world'});
  assert.equal(result.isError,undefined);
  const data=JSON.parse(result.content[0].text);
  assert.equal(data.query,'hello world'); assert.equal(data.provider,'bing');
  assert.equal(data.results[0].title,'fixture result');
  assert.equal(requests.length,1); assert.equal(new URL('https://cn.bing.com'+requests[0].options.path).searchParams.get('q'),'hello world');
});

test('DeepSeek uses configured endpoint and fixed public IP; secrets are scrubbed from output',async (t?: any) =>{
  const {createWebService}=await import('../src/web/server.mjs');
  const secret='fake-fixture-search-key';
  const requests=networkFixture(t,()=>({body:JSON.stringify({content:[{type:'web_search_tool_result',content:[{type:'web_search_result',title:secret,url:'https://example.com/'}]}]})}));
  const service=createWebService({configPath:await configFixture(t,{provider:'deepseek',baseURL:'https://search.example.com/anthropic/v1',apiKey:secret})});
  const result=await service.call('web_search',{query:'fixture deepseek'});
  assert.equal(result.isError,undefined); assert.doesNotMatch(JSON.stringify(result),new RegExp(secret));
  assert.equal(requests[0].options.hostname,'93.184.216.34'); assert.equal(requests[0].options.headers.host,'search.example.com');
  assert.equal(requests[0].options.path,'/anthropic/v1/messages'); assert.equal(requests[0].options.headers['x-api-key'],secret);
});

test('provider errors never echo credentials or request contents',async (t?: any) =>{
  const {createWebService}=await import('../src/web/server.mjs');
  const secret='fake-reflected-secret';
  networkFixture(t,()=>({status:401,body:JSON.stringify({error:{message:secret+' private-query'}})}));
  const service=createWebService({configPath:await configFixture(t,{provider:'deepseek',apiKey:secret})});
  const result=await service.call('web_search',{query:'private-query'});
  assert.equal(result.isError,true); assert.doesNotMatch(JSON.stringify(result),/fake-reflected-secret|private-query/);
});

test('search refuses private or plaintext endpoints before sending credentials and never follows redirects',async (t?: any) =>{
  const {createWebService}=await import('../src/web/server.mjs');
  const requests=networkFixture(t,()=>({status:307,headers:{location:'https://other.example.com/steal'}}));
  for (const baseURL of ['https://127.0.0.1/api','http://example.com/api']) {
    const service=createWebService({configPath:await configFixture(t,{provider:'deepseek',apiKey:'fixture-key',baseURL})});
    assert.equal((await service.call('web_search',{query:'fixture blocked endpoint'})).isError,true);
  }
  assert.equal(requests.length,0);
  const service=createWebService({configPath:await configFixture(t,{provider:'deepseek',apiKey:'fixture-key'})});
  assert.equal((await service.call('web_search',{query:'fixture redirect'})).isError,true);
  assert.equal(requests.length,1);
});

test('auto search falls back to Bing when explicitly selected key environment is empty',async (t?: any) =>{
  const {createWebService}=await import('../src/web/server.mjs');
  const requests=networkFixture(t,()=>({body:'<rss><item><title>fallback</title><link>https://example.com/fallback</link></item></rss>'}));
  const service=createWebService({configPath:await configFixture(t,{provider:'auto',apiKeyEnv:'CHOPSTICKS_TEST_MISSING_SEARCH_KEY'})});
  const result=await service.call('web_search',{query:'fixture fallback'});
  const data=JSON.parse(result.content[0].text);
  assert.equal(data.provider,'bing'); assert.equal(data.fallbackFrom,'deepseek');
  assert.equal(requests.length,1); assert.equal(requests[0].options.method,'GET');
});

test('secret redaction covers JSON-escaped API keys in successful external content',async (t?: any) =>{
  const {createWebService}=await import('../src/web/server.mjs');
  const secret='fixture-quoted-"secret\\key';
  networkFixture(t,()=>({body:JSON.stringify({content:[{type:'web_search_tool_result',content:[{type:'web_search_result',title:secret,url:'https://example.com/escaped'}]}]})}));
  const service=createWebService({configPath:await configFixture(t,{provider:'deepseek',apiKey:secret})});
  const result=await service.call('web_search',{query:'fixture escaped key'});
  assert.equal(result.isError,undefined); assert.equal(JSON.parse(result.content[0].text).results[0].title,'[redacted]');
});

test('credential rotation cannot return cached content containing the previous key',async (t?: any) =>{
  const {createWebService}=await import('../src/web/server.mjs');
  const configPath=await configFixture(t,{provider:'deepseek',apiKey:'old-fixture-secret'});
  const requests=networkFixture(t,(options)=>({body:JSON.stringify({content:[{type:'web_search_tool_result',content:[{type:'web_search_result',title:options.headers['x-api-key'],url:'https://example.com/rotated'}]}]})}));
  const service=createWebService({configPath});
  await service.call('web_search',{query:'fixture rotation'});
  await fs.writeFile(configPath,JSON.stringify({webSearch:{provider:'deepseek',apiKey:'new-fixture-secret'}}));
  const result=await service.call('web_search',{query:'fixture rotation'});
  assert.doesNotMatch(result.content[0].text,/old-fixture-secret|new-fixture-secret/);
  assert.equal(requests.length,2);
});

test('SDK stdio lists original tools and denies local fetch',async (t?: any) =>{
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'web/server.mjs')],env:{...process.env,CHOPSTICKS_CONFIG:await configFixture(t)},stderr:'pipe'});
  const client=new Client({name:'web-fixture',version:'1.0.0'}); t.after(()=>client.close());
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((x)=>x.name),['web_search','web_fetch']);
  assert.equal((await client.callTool({name:'web_fetch',arguments:{url:'http://localhost/'}})).isError,true);
});
