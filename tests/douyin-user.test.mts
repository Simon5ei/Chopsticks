import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import * as helper from '../src/platforms/douyin/user-platform.mjs';
const account={name:'simon',uid:1000,home:'/home/simon'};
const desktopEnv={XDG_RUNTIME_DIR:'/run/user/1000',DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/1000/bus',WAYLAND_DISPLAY:'wayland-0'};
const config={desktopUser:'simon',chromePath:'/opt/chrome/chrome-linux64/chrome',headless:false,userStateDir:'/home/simon/private/douyin',providerKey:'secret'};
test('headed launcher restricts account, private path and child environment',()=>{
  const spec=helper.buildUserLaunch(config,{account,desktopEnv,callerUid:0,workerPath:'/opt/chopsticks/platforms/douyin/user-worker.mjs'});
  assert.equal(spec.command,'/usr/sbin/runuser'); assert.ok(spec.args.includes('simon'));assert.ok(spec.args.includes('WAYLAND_DISPLAY=wayland-0'));
  assert.equal(JSON.stringify(spec).includes('secret'),false);assert.equal(spec.env.SECRET,undefined);
  for(const bad of [{...config,desktopUser:'root'},{...config,userStateDir:'/etc'},{...config,userStateDir:'/home/simon/../other'},{...config,headless:true}]) assert.throws(()=>helper.buildUserLaunch(bad,{account,desktopEnv,callerUid:0,workerPath:'/opt/chopsticks/platforms/douyin/user-worker.mjs'}));
});
test('worker protocol admits only platform operations and bounded input',()=>{
 assert.equal(helper.validWorkerRequest({id:1,method:'status',args:{}}),true);
 assert.equal(helper.validWorkerRequest({id:1,method:'exec',args:{}}),false);
 assert.equal(helper.validWorkerRequest({id:1,method:'read',args:{text:'x'.repeat(100000)}}),false);
});

test('diagnostics refuses to start an absent proxy owner and reuses a running worker',async()=>{
 let starts=0;const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123;
 child.stdin.on('data',(d)=>{for(const line of String(d).trim().split('\n')){const req=JSON.parse(line);child.stdout.write(JSON.stringify({id:req.id,result:{state:req.method==='diagnostics'?'observed':'ready'}})+'\n');if(req.method==='close')setImmediate(()=>child.emit('exit',0,null));}});
 const p=helper.createUserPlatform({launch:{command:'fake',args:[],env:{}},spawnImpl:()=>{starts++;return child;}});
 assert.equal(typeof p.diagnostics,'function');assert.equal((await p.diagnostics()).code,'OWNER_NOT_RUNNING');assert.equal(starts,0);
 await p.status();assert.equal((await p.diagnostics()).state,'observed');assert.equal(starts,1);await p.close();
});

test('worker diagnostic cannot instantiate a platform or accept caller-supplied selectors',async()=>{
 const {createWorkerHandler}=await import('../src/platforms/douyin/user-worker.mjs');let creates=0;const handler=createWorkerHandler({createPlatform:()=>{creates++;return {};}});
 assert.equal((await handler({id:1,method:'diagnostics',args:{}})).result?.code,'OWNER_NOT_RUNNING');assert.equal(creates,0);
 assert.equal(helper.validWorkerRequest({id:2,method:'diagnostics',args:{selector:'body'}}),false);await handler.close();
});
test('proxy creates one child and closes it when closed',async()=>{
 let starts=0;const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=123;
 child.stdin.on('data',(d)=>{for(const line of String(d).trim().split('\n')){const req=JSON.parse(line);child.stdout.write(JSON.stringify({id:req.id,result:req.method==='status'?{state:'ready'}:{state:'ok'}})+'\n');if(req.method==='close')setImmediate(()=>child.emit('exit',0,null));}});
 const p=helper.createUserPlatform({launch:{command:'fake',args:[],env:{}},spawnImpl:()=>{starts++;return child;}});
 assert.equal((await p.status()).state,'ready');assert.equal((await p.status()).state,'ready');assert.equal(starts,1);await p.close();
});

test('abort stops the sole worker and does not recreate it before exit',async()=>{
 let starts=0,kills=0;const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123;child.stdin.resume();
 const p=helper.createUserPlatform({launch:{command:'fake',args:[],env:{}},spawnImpl:()=>{starts++;return child;},killImpl:()=>{kills++;setImmediate(()=>child.emit('exit',null,'SIGTERM'));}});
 const controller=new AbortController();const pending=p.read({action:'feed',signal:controller.signal});controller.abort();assert.ok((await pending).warnings.includes('OWNER_UNAVAILABLE'));assert.equal((await p.status()).state,'error');assert.equal(starts,1);assert.equal(kills,1);await p.close();
});

test('factory delegates desktop-owned platform through one isolated proxy',async()=>{
 const {createDouyinPlatform}=await import('../src/platforms/douyin/index.mjs');let passed;
 const expected={platform:'douyin',status:async()=>({state:'ready'})};
 const got=createDouyinPlatform({stateDir:'unused',config:{douyin:{...config},provider:{key:'secret'}},userPlatformFactory:(options)=>{passed=options;return expected;},userLaunchResolver:(value)=>({selected:value.desktopUser})});
 assert.equal(got,expected);assert.deepEqual(passed.launchResolver(),{selected:'simon'});assert.equal(JSON.stringify(passed).includes('secret'),false);
});

test('headed browser explicitly uses the existing Wayland session',async (t?: any) =>{
 const {createBrowserTransport}=await import('../src/platforms/douyin/transport.mjs'); const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const dir=await mkdtemp(join(tmpdir(),'headed-'));t.after(()=>rm(dir,{recursive:true,force:true}));let options;
 const page={isClosed:()=>false,setDefaultTimeout(){},goto:async()=>{},evaluate:async()=> '123456'};
 const b=createBrowserTransport({stateDir:dir,config:{douyin:{chromePath:'fake',headless:false}},chromium:{launchPersistentContext:async(_dir?: any,o?: any)=>{options=o;return {pages:()=>[page],close:async()=>{}};}}});t.after(()=>b.close());await b.status();
 assert.equal(options.headless,false);assert.ok(options.args.includes('--ozone-platform=wayland'));
});

test('worker validates methods and dispatches only once to a retained platform',async()=>{
 const {createWorkerHandler}=await import('../src/platforms/douyin/user-worker.mjs');let creates=0,closed=0;
 const handle=createWorkerHandler({createPlatform:()=>{creates++;return {status:async()=>({state:'ready'}),close:async()=>{closed++;}};}});
 assert.deepEqual(await handle({id:1,method:'status',args:{}}),{id:1,result:{state:'ready'}});
 assert.deepEqual(await handle({id:2,method:'status',args:{}}),{id:2,result:{state:'ready'}});
 assert.equal((await handle({id:3,method:'exec',args:{}})).error,'invalid_request');
 assert.equal(creates,1);await handle({id:4,method:'close',args:{}});assert.equal(closed,1);
});

test('worker close aborts in-flight work and closes the sole platform',async()=>{
 const {createWorkerHandler}=await import('../src/platforms/douyin/user-worker.mjs');let cancelled=false,closed=0;
 const handler=createWorkerHandler({createPlatform:()=>({read:({signal}: { signal?: any; [key: string]: any })=>new Promise<any | void>((resolve)=>signal.addEventListener('abort',()=>{cancelled=true;resolve({items:[]});},{once:true})),close:async()=>{closed++;}})});
 const pending=handler({id:1,method:'read',args:{action:'feed'}});await handler.close();await pending;assert.equal(cancelled,true);assert.equal(closed,1);
 assert.equal((await handler({id:2,method:'status',args:{}})).error,'closed');
});

test('a cancelled worker refuses new requests while process exit is pending',async()=>{
 const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123;child.stdin.resume();let sent=0;child.stdin.on('data',()=>sent++);
 const p=helper.createUserPlatform({launch:{command:'fake',args:[],env:{}},spawnImpl:()=>child,killImpl:()=>{}});
 const c=new AbortController();const one=p.status({signal:c.signal});c.abort();assert.equal((await one).state,'error');
 const rejected=await Promise.race([p.status().then((x: any) =>x.state==='error'),new Promise<any | void>((resolve)=>setTimeout(()=>resolve(false),30))]);assert.equal(rejected,true);assert.equal(sent,1);child.emit('exit',null,'SIGTERM');await p.close();
});

test('close force-stops a worker process group that does not exit gracefully',async()=>{
 const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123;const signals=[];
 child.stdin.on('data',(d)=>{const req=JSON.parse(String(d));child.stdout.write(JSON.stringify({id:req.id,result:{state:'ok'}})+'\n');});
 const p=helper.createUserPlatform({launch:{command:'fake',args:[],env:{}},spawnImpl:()=>child,stopTimeoutMs:20,killImpl:(_pid?: any,signal?: any)=>{signals.push(signal);if(signal==='SIGKILL')setImmediate(()=>child.emit('exit',null,signal));}});
 await p.status();await p.close();assert.deepEqual(signals,['SIGTERM','SIGKILL']);
});

test('factory survives unavailable desktop and retries discovery on a later status',async()=>{
 const {createDouyinPlatform}=await import('../src/platforms/douyin/index.mjs');let discovery=0,starts=0;const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123;
 child.stdin.on('data',(data)=>{const req=JSON.parse(String(data));child.stdout.write(JSON.stringify({id:req.id,result:{state:'ready'}})+'\n');if(req.method==='close')setImmediate(()=>child.emit('exit',0,null));});
 const p=createDouyinPlatform({stateDir:'unused',config:{douyin:{desktopUser:'simon'}},userLaunchResolver:()=>{if(++discovery===1)throw Error('desktop unavailable');return {command:'fake',args:[],env:{}};},userPlatformFactory:(options)=>helper.createUserPlatform({...options,spawnImpl:()=>{starts++;return child;},killImpl:()=>{}})});
 assert.equal(discovery,0);assert.equal((await p.status()).state,'error');assert.equal(starts,0);
 assert.equal((await p.status()).state,'ready');assert.equal(discovery,2);assert.equal(starts,1);await p.close();
});

test('unavailable desktop returns controlled read and pre-submission write results',async()=>{
 const p=helper.createUserPlatform({launchResolver:()=>{throw Error('desktop unavailable');}});
 assert.deepEqual(await p.read({action:'feed'}),{items:[],truncated:true,warnings:['DESKTOP_UNAVAILABLE']});
 assert.deepEqual(await p.write({action:'comment',targetId:'123456',intentId:'a',text:'x'}),{confirmed:false,state:'refused',code:'DESKTOP_UNAVAILABLE'});
 await p.close();
});

test('a synchronous launch failure is recoverable without reusing stale desktop environment',async()=>{
 let discoveries=0,starts=0;const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123;
 child.stdin.on('data',(data)=>{const req=JSON.parse(String(data));child.stdout.write(JSON.stringify({id:req.id,result:{state:'ready'}})+'\n');if(req.method==='close')setImmediate(()=>child.emit('exit',0,null));});
 const p=helper.createUserPlatform({launchResolver:()=>({command:'fake',args:[String(++discoveries)],env:{}}),spawnImpl:()=>{if(++starts===1)throw Error('not started');return child;},killImpl:()=>{}});
 assert.equal((await p.status()).code,'DESKTOP_UNAVAILABLE');assert.equal((await p.status()).state,'ready');assert.equal(discoveries,2);await p.close();
});

test('a later read recovers an exited worker without replaying an ambiguous write',async()=>{
 let starts=0;const requests=[];const children=[];
 const p=helper.createUserPlatform({profileIsIdle:()=>true,launchResolver:()=>({command:'fake',args:[],env:{}}),spawnImpl:()=>{
  const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123+starts++;children.push(child);
  child.stdin.on('data',(data)=>{const req=JSON.parse(String(data));requests.push(req.method);if(starts>1)child.stdout.write(JSON.stringify({id:req.id,result:req.method==='read'?{items:[{id:'7704182557952331049'}]}:{state:'ready'}})+'\n');if(req.method==='close')setImmediate(()=>child.emit('exit',0,null));});return child;
 },killImpl:(_pid?: any,signal?: any)=>{if(signal===0)throw Object.assign(Error('absent'),{code:'ESRCH'});}});
 const writing=p.write({action:'publish',targetId:'own-public',text:'pong',intentId:'one'});children[0].emit('exit',1,null);
 assert.equal((await writing).state,'uncertain');
 assert.deepEqual((await p.read({action:'detail',id:'7704182557952331049'})).items,[{id:'7704182557952331049'}]);
 assert.deepEqual(requests,['write','read']);assert.equal(starts,2);await p.close();
});

test('an exited worker with a surviving browser process group cannot be replaced',async()=>{
 let starts=0;const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123;
 const p=helper.createUserPlatform({launch:{command:'fake',args:[],env:{}},spawnImpl:()=>{starts++;return child;},killImpl:()=>{}});
 const pending=p.status();child.emit('exit',1,null);await pending;
 assert.equal((await p.status()).state,'error');assert.equal(starts,1);await p.close();
});

test('late exit from a failed worker does not reject requests on its replacement',async()=>{
 const children=[];const p=helper.createUserPlatform({profileIsIdle:()=>true,launch:{command:'fake',args:[],env:{}},spawnImpl:()=>{const c: any=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.pid=123+children.length;children.push(c);return c;},killImpl:(_pid?: any,signal?: any)=>{if(signal===0)throw Object.assign(Error('absent'),{code:'ESRCH'});},stopTimeoutMs:1});
 const initial=p.status();children[0].emit('error',Error('failed'));await initial;
 const next=p.status();children[0].emit('exit',1,null);children[1].stdout.write(JSON.stringify({id:2,result:{state:'ready'}})+'\n');
 assert.equal((await next).state,'ready');children[1].emit('exit',0,null);await p.close();
});

test('an asynchronous spawn failure with no process can retry fresh desktop discovery',async()=>{
 let discovers=0;const children=[];const p=helper.createUserPlatform({launchResolver:()=>{discovers++;return {command:'fake',args:[],env:{}};},spawnImpl:()=>{const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();children.push(child);return child;},killImpl:()=>{throw Error('no PID must never be probed');}});
 const first=p.status();children[0].emit('error',Error('ENOENT'));assert.equal((await first).state,'error');
 const second=p.status();if(children[1])children[1].stdout.write(JSON.stringify({id:2,result:{state:'ready'}})+'\n');
 assert.equal((await second).state,'ready');assert.equal(discovers,2);children[1].emit('exit',0,null);await p.close();
});

test('recovery waits for the separate profile owner even when the worker process group is gone',async()=>{
 let starts=0,profileIdle=false;const children=[];
 const p=helper.createUserPlatform({launch:{command:'fake',args:[],env:{},profileDir:'/managed/profile'},profileIsIdle:()=>profileIdle,spawnImpl:()=>{
  const c: any=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.pid=123+starts++;children.push(c);
  c.stdin.on('data',(d)=>{const req=JSON.parse(String(d));if(starts>1)c.stdout.write(JSON.stringify({id:req.id,result:{state:'ready'}})+'\n');if(req.method==='close')setImmediate(()=>c.emit('exit',0,null));});return c;
 },killImpl:(_pid?: any,signal?: any)=>{if(signal===0)throw Object.assign(Error('worker absent'),{code:'ESRCH'});}});
 const first=p.status();children[0].emit('exit',1,null);await first;
 assert.equal((await p.status()).state,'error');assert.equal(starts,1);
 profileIdle=true;assert.equal((await p.status()).state,'ready');assert.equal(starts,2);await p.close();
});

test('diagnostic IPC deadline removes only that request and ignores its late response without restarting owner',async()=>{
 const child: any=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.pid=123;let diagnosticId,starts=0,kills=0;
 child.stdin.on('data',(d)=>{const req=JSON.parse(String(d));if(req.method==='diagnostics'){diagnosticId=req.id;return;}child.stdout.write(JSON.stringify({id:req.id,result:{state:'ready'}})+'\n');if(req.method==='close')setImmediate(()=>child.emit('exit',0,null));});
 const p=helper.createUserPlatform({launch:{command:'fake',args:[],env:{}},diagnosticsTimeoutMs:10,spawnImpl:()=>{starts++;return child;},killImpl:()=>{kills++;}});
 await p.status();const result=await Promise.race([p.diagnostics(),new Promise<any | void>((resolve)=>setTimeout(()=>resolve({hung:true}),100))]);
 assert.deepEqual(result,{state:'error',code:'DIAGNOSTICS_FAILED',phase:'owner_ipc',errorKind:'deadline'});
 child.stdout.write(JSON.stringify({id:diagnosticId,result:{state:'observed'}})+'\n');
 assert.equal((await p.status()).state,'ready');assert.equal(starts,1);assert.equal(kills,0);await p.close();
});

test('headed launcher selects a validated local X11 session for the isolated worker',()=>{
 const workerPath='/opt/chopsticks/platforms/douyin/user-worker.mjs';
 const x11={...desktopEnv,XDG_SESSION_TYPE:'x11',DISPLAY:':0',XAUTHORITY:'/run/user/1000/gdm/Xauthority'};
 const spec=helper.buildUserLaunch(config,{account,desktopEnv:x11,callerUid:1000,workerPath});
 assert.deepEqual(spec.args,[workerPath,config.userStateDir,config.chromePath,'x11']);
 assert.equal(spec.env.XDG_SESSION_TYPE,'x11');
 assert.equal(spec.env.DISPLAY,':0');
 assert.equal(spec.env.XAUTHORITY,x11.XAUTHORITY);
 assert.equal(spec.env.WAYLAND_DISPLAY,undefined);
 const root=helper.buildUserLaunch(config,{account,desktopEnv:x11,callerUid:0,workerPath});
 assert.deepEqual(root.args.slice(-4),spec.args);
 assert.ok(root.args.includes('DISPLAY=:0'));
 assert.ok(root.args.includes(`XAUTHORITY=${x11.XAUTHORITY}`));
 const wayland=helper.buildUserLaunch(config,{account,desktopEnv:{...x11,XDG_SESSION_TYPE:'wayland'},callerUid:1000,workerPath});
 assert.equal(wayland.args.at(-1),'wayland');
 assert.equal(wayland.env.WAYLAND_DISPLAY,'wayland-0');
 assert.equal(wayland.env.DISPLAY,undefined);
 assert.equal(wayland.env.XAUTHORITY,undefined);
 for(const patch of [
  {DISPLAY:undefined},{DISPLAY:'otherhost:0'},{DISPLAY:':0\n'},
  {XAUTHORITY:undefined},{XAUTHORITY:'/etc/passwd'},{XAUTHORITY:'/home/simon-other/.Xauthority'},
  {XAUTHORITY:'/run/user/1000/../../etc/passwd'},{XAUTHORITY:'/home/simon/.Xauthority\0'},
  {XDG_SESSION_TYPE:'tty'},
 ]){
  assert.throws(()=>helper.buildUserLaunch(config,{account,desktopEnv:{...x11,...patch},callerUid:0,workerPath}),/desktop unavailable/);
 }
});
test('browser transport uses the supplied X11 backend only in headed mode',async (t?: any) =>{
 const {createBrowserTransport}=await import('../src/platforms/douyin/transport.mjs');
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const page={isClosed:()=>false,setDefaultTimeout(){},goto:async()=>{},evaluate:async()=> '123456'};
 for(const [headless,args] of [[false,['--ozone-platform=x11','--window-size=1600,1000','--start-maximized']],[true,['--disable-gpu']]]){
  const dir=await mkdtemp(join(tmpdir(),'backend-'));
  let options;
  const b=createBrowserTransport({stateDir:dir,config:{douyin:{chromePath:'fake',headless,browserBackend:'x11'}},chromium:{launchPersistentContext:async(_dir?: any,value?: any)=>{
   options=value;
   return {pages:()=>[page],close:async()=>{}};
  }}});
  t.after(async()=>{await b.close();await rm(dir,{recursive:true,force:true});});
  await b.status();
  assert.equal(options.headless,headless);
  assert.deepEqual(options.args,args);
 }
});

test('a dead desktop worker is reported as owner unavailable rather than a transport fault',async()=>{
 const {workerCode}=await import('../src/platforms/douyin/user-platform.mjs');
 assert.equal(workerCode(Object.assign(Error('worker unavailable'),{})),'OWNER_UNAVAILABLE');
 assert.equal(workerCode(Object.assign(Error('closed'),{})),'OWNER_UNAVAILABLE');
 assert.equal(workerCode(Object.assign(Error('x'),{code:'DESKTOP_UNAVAILABLE'})),'DESKTOP_UNAVAILABLE');
 assert.equal(workerCode(Error('page crashed')),'TRANSPORT_ERROR');
});

