import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRuntime} from '../host/runtime.mjs';
import {createQQAdapter} from '../adapters/qq.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const login=id=>({ok:true,json:async()=>({status:'ok',retcode:0,data:{user_id:id}})});
async function fixture(t,{fetchLogin=async()=>{throw Error('private gateway token');}}={}){
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chopsticks-qq-startup-')),fishHome=path.join(dir,'fish');
 fs.mkdirSync(path.join(fishHome,'characters'),{recursive:true});
 fs.writeFileSync(path.join(fishHome,'characters/current.json'),JSON.stringify({id:'fish'}));
 fs.writeFileSync(path.join(fishHome,'bili.config.json'),JSON.stringify({listen:{dm:true}}));
 const sockets=[],requests=[],health=[];
 class Socket extends EventEmitter{constructor(){super();sockets.push(this);}close(){this.emit('close');}}
 const runtime=await createRuntime({config:{stateDir:path.join(dir,'state'),fishHome,qq:{selfId:'900',ownerId:'123',httpUrl:'http://gateway.test',wsUrl:'ws://gateway.test',allowGroups:['456']},bili:{enabled:true},evolution:{enabled:false}},
  controller:{async inspect(){},async resolveAgent(){},async cancel(){}},
  adapterFactory:options=>createQQAdapter({...options,WebSocketImpl:Socket,fetchImpl:async url=>{requests.push(url);assert.match(url,/\/get_login_info$/,'startup must never replay sends');return fetchLogin();}}),
  socialFactory:()=>({async poll(){return {events:[],selfId:'800'};},close(){}}),feedFactory:()=>async()=>({items:[]}),onStatus:s=>health.push(s)});
 t.after(async()=>{await runtime.close();t.mock.timers.reset();fs.rmSync(dir,{recursive:true,force:true});});
 return {runtime,sockets,requests,health,dir};
}

test('QQ login failure leaves host health updates and Bili inbox polling running',async t=>{
 const f=await fixture(t);
 await assert.doesNotReject(f.runtime.start());await settle();
 assert.equal(f.runtime.status().qq.startup.state,'offline');
 assert.doesNotMatch(JSON.stringify(f.runtime.status()),/private gateway token/);
 t.mock.timers.tick(10000);await settle();
 assert.ok(f.health.length>=2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.dir,'state/health.json'))).ready,true);
 assert.equal(f.runtime.status().bili.inbox.state,'ready');
 const count=f.health.length;t.mock.timers.tick(3000);await settle();assert.ok(f.health.length>count);
});

test('same runtime retries login with bounded backoff then connects only its configured account',async t=>{
 let available=false;
 const f=await fixture(t,{fetchLogin:async()=>available?login('900'):login('901')});
 await f.runtime.start();await settle();
 assert.equal(f.sockets.length,0,'wrong account must never open websocket');
 for(const wait of [1000,2000,4000,8000,16000,30000,30000]){
  const count=f.requests.length;t.mock.timers.tick(wait-1);await settle();assert.equal(f.requests.length,count);
  t.mock.timers.tick(1);await settle();assert.equal(f.requests.length,count+1);
  assert.equal(f.sockets.length,0);
 }
 available=true;t.mock.timers.tick(30000);await settle();
 assert.equal(f.sockets.length,1);f.sockets[0].emit('open');
 assert.equal(f.runtime.status().qq.connected,true);
 assert.equal(f.runtime.status().qq.startup.state,'started');
 const count=f.requests.length;t.mock.timers.tick(60000);await settle();assert.equal(f.requests.length,count);
});

test('pending QQ login does not block runtime startup or overlap retries',async t=>{
 let resolveLogin;
 const f=await fixture(t,{fetchLogin:()=>new Promise(resolve=>{resolveLogin=resolve;})});
 let started=false;const start=f.runtime.start().then(()=>{started=true;});
 t.after(()=>resolveLogin?.(login('900')));
 await settle();assert.equal(started,true,'unavailable transport must not block host startup');
 t.mock.timers.tick(60000);await settle();assert.equal(f.requests.length,1);assert.equal(f.sockets.length,0);
 resolveLogin(login('900'));await start;await settle();assert.equal(f.sockets.length,1);
});

test('close cancels pending startup and ignores late login success after database close',async t=>{
 let resolveLogin;
 const f=await fixture(t,{fetchLogin:()=>new Promise(resolve=>{resolveLogin=resolve;})});
 const start=f.runtime.start();await settle();await f.runtime.close();
 resolveLogin(login('900'));await start;await settle();
 assert.equal(f.sockets.length,0);
 t.mock.timers.tick(120000);await settle();assert.equal(f.requests.length,1);
 assert.equal(f.runtime.adapter.status().started,false);
});

test('close cancels scheduled retries',async t=>{
 const f=await fixture(t);await f.runtime.start();await settle();
 await f.runtime.close();const count=f.requests.length;t.mock.timers.tick(120000);await settle();assert.equal(f.requests.length,count);
});
