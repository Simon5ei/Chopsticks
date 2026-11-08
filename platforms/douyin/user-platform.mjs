import {spawn,execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {hostname} from 'node:os';
import {findDesktopEnvironment} from '../../desktop/launch.mjs';
import {diagnosticFailure} from './publish-diagnostics.mjs';
import {sanitizeDiagnostics as sanitizePublisherDiagnostics,validDmDiagnostic} from './dm-diagnostics.mjs';
const methods=new Set(['status','login','read','write','close','diagnostics']);
const capabilities=Object.freeze({feed:true,detail:true,search:true,comments:true,notifications:true,like:true,comment:true,reply:true,publish:true,inbox:true,dm:true});
export function validWorkerRequest(x) {try{return !!x&&Number.isSafeInteger(x.id)&&x.id>0&&methods.has(x.method)&&x.args&&typeof x.args==='object'&&!Array.isArray(x.args)&&(x.method!=='diagnostics'||(Object.keys(x.args).length===0||validDmDiagnostic(x.args)))&&JSON.stringify(x).length<=65536;}catch{return false;}}
export function buildUserLaunch(config,{account,desktopEnv={},callerUid,workerPath}={}) {
 const user=config?.desktopUser, home=account?.home, dir=config?.userStateDir, chrome=config?.chromePath;
 if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(user||'')||user==='root'||account?.name!==user||!Number.isSafeInteger(account.uid)||account.uid<=0||typeof home!=='string'||!path.posix.isAbsolute(home))throw Error('invalid account');
 if(typeof dir!=='string'||!path.posix.isAbsolute(dir)||path.posix.normalize(dir)!==dir||!dir.startsWith(home+'/')||dir.includes('\0'))throw Error('invalid user state directory');
 if(config.headless!==false||typeof chrome!=='string'||!path.posix.isAbsolute(chrome)||chrome.includes('\0')||typeof workerPath!=='string'||!path.posix.isAbsolute(workerPath))throw Error('invalid browser configuration');
 const runtime=`/run/user/${account.uid}`;
 if(desktopEnv.XDG_RUNTIME_DIR!==runtime||desktopEnv.DBUS_SESSION_BUS_ADDRESS!==`unix:path=${runtime}/bus`)throw Error('desktop unavailable');
 const backend=desktopEnv.XDG_SESSION_TYPE??'wayland';
 const env={HOME:home,USER:user,LOGNAME:user,PATH:'/opt/node24/bin:/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',XDG_RUNTIME_DIR:runtime,DBUS_SESSION_BUS_ADDRESS:`unix:path=${runtime}/bus`,XDG_SESSION_TYPE:backend};
 if(backend==='wayland'){
  const display=desktopEnv.WAYLAND_DISPLAY;
  if(typeof display!=='string'||!/^wayland-[0-9]{1,5}$/.test(display))throw Error('desktop unavailable');
  env.WAYLAND_DISPLAY=display;
 }else if(backend==='x11'){
  const {DISPLAY:display,XAUTHORITY:authority}=desktopEnv;
  if(typeof display!=='string'||!/^:[0-9]{1,5}(?:\.[0-9]{1,3})?$/.test(display)||
     typeof authority!=='string'||authority.length>512||/[\x00-\x1f\x7f]/.test(authority)||
     path.posix.normalize(authority)!==authority||authority.endsWith('/')||
     !(authority.startsWith(runtime+'/')||authority.startsWith(home+'/')))throw Error('desktop unavailable');
  env.DISPLAY=display;
  env.XAUTHORITY=authority;
 }else throw Error('desktop unavailable');
 const args=[workerPath,dir,chrome,backend];
 const profileDir=path.posix.join(dir,'profile');
 if(callerUid===account.uid)return {command:'/opt/node24/bin/node',args,env,profileDir};
 if(callerUid!==0)throw Error('invalid caller');
 return {command:'/usr/sbin/runuser',args:['-u',user,'--','/usr/bin/env','-i',...Object.entries(env).map(([k,v])=>`${k}=${v}`),'/opt/node24/bin/node',...args],env:{PATH:'/usr/sbin:/usr/bin:/bin',LANG:'C.UTF-8'},profileDir};
}
export function resolveUserLaunch(config) {
 const user=config?.desktopUser;if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(user||'')||user==='root')throw Error('invalid account');
 const fields=execFileSync('/usr/bin/getent',['passwd',user],{encoding:'utf8',timeout:5000}).trim().split(':');
 const account={name:fields[0],uid:Number(fields[2]),home:fields[5]};
 const dir=config.userStateDir;
 const desktopEnv=findDesktopEnvironment(account);
 const spec=buildUserLaunch(config,{account,desktopEnv,callerUid:process.getuid(),workerPath:fileURLToPath(new URL('./user-worker.mjs',import.meta.url))});
 if(desktopEnv.XDG_SESSION_TYPE==='x11'){
  const authority=desktopEnv.XAUTHORITY;
  if(!fs.lstatSync(authority).isFile()||fs.realpathSync(authority)!==authority)throw Error('desktop unavailable');
 }
 const st=fs.lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==account.uid||(st.mode&0o077)!==0||fs.realpathSync(dir)!==dir)throw Error('private directory invalid');
 return spec;
}
export function managedProfileIsIdle(profileDir) {
 if(process.platform!=='linux'||typeof profileDir!=='string'||!path.posix.isAbsolute(profileDir))return false;
 try {
  try{const s=fs.lstatSync(profileDir);if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync(profileDir)!==profileDir)return false;}catch(e){if(e.code!=='ENOENT')return false;}
  try{
   const lock=fs.readlinkSync(path.join(profileDir,'SingletonLock')),prefix=hostname()+'-';
   if(!lock.startsWith(prefix)||!/^\d+$/.test(lock.slice(prefix.length)))return false;
   const pid=Number(lock.slice(prefix.length));if(!Number.isSafeInteger(pid)||pid<=0)return false;
   try{process.kill(pid,0);return false;}catch(e){if(e.code!=='ESRCH')return false;}
  }catch(e){if(e.code!=='ENOENT')return false;}
  // Playwright's Chrome has its own detached process group. Also catch the
  // launch-before-lock interval or a removed lock; inspect only the exact profile.
  for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){
   let args;try{args=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0');}catch(e){if(['ENOENT','ESRCH'].includes(e.code))continue;return false;}
   if(args.some((arg,i)=>arg===`--user-data-dir=${profileDir}`||(arg==='--user-data-dir'&&args[i+1]===profileDir)))return false;
  }
  return true;
 }catch{return false;}
}
export function createUserPlatform({launch,launchResolver,spawnImpl=spawn,killImpl=process.kill.bind(process),profileIsIdle=managedProfileIsIdle,stopTimeoutMs=5000,diagnosticsTimeoutMs=35000}={}) {
 let child,closed=false,dead=false,stopping=false,next=0, pending=new Map(),ended; const settled=()=>{for(const p of pending.values())p.reject(Error('worker unavailable'));pending.clear();};
 function stop(){if(!dead&&!stopping&&child?.pid){stopping=true;try{killImpl(-child.pid,'SIGTERM');}catch{try{child.kill?.('SIGTERM');}catch{}}}}
 function start(){if(child)return;if(closed)throw Error('closed');if(!launch){try{launch=launchResolver();}catch{const error=Error('desktop unavailable');error.code='DESKTOP_UNAVAILABLE';throw error;}}try{child=spawnImpl(launch.command,launch.args,{env:launch.env,stdio:['pipe','pipe','ignore'],shell:false,detached:true});}catch{if(launchResolver)launch=undefined;const error=Error('desktop unavailable');error.code='DESKTOP_UNAVAILABLE';throw error;}const owned=child;ended=new Promise(resolve=>{const finish=()=>{if(child===owned){dead=true;settled();}resolve();};owned.once('exit',finish);owned.once('error',finish);});owned.stdin.on('error',()=>{if(child===owned)settled();});
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});lines.on('line',line=>{if(child!==owned)return;if(line.length>524288){stop();settled();return;}try{const message=JSON.parse(line),p=pending.get(message.id);if(!p)return;pending.delete(message.id);message.error?p.reject(Error('worker failure')):p.resolve(message.result);}catch{stop();settled();}});
 }
 function call(method,args={}) {if(closed&&method!=='close')return Promise.reject(Error('closed'));const {signal,...safe}=args||{};if(signal?.aborted)return Promise.reject(Error('cancelled'));
  // Recover only on a new request after the old worker and exact profile owner
  // have exited. Never replay a pending operation, especially an unknown write.
  if(dead&&!closed){
   let absent=child.pid===undefined;if(!absent)try{killImpl(-child.pid,0);}catch(e){absent=e.code==='ESRCH';}
   if(!absent)return Promise.reject(Error('worker unavailable'));
   if(child.pid!==undefined&&!profileIsIdle(launch?.profileDir))return Promise.reject(Error('worker unavailable'));
   child=undefined;dead=false;stopping=false;ended=undefined;if(launchResolver)launch=undefined;
  }
  if(dead||stopping)return Promise.reject(Error('worker unavailable'));start();const id=++next,request={id,method,args:safe};if(!validWorkerRequest(request))return Promise.reject(Error('invalid request'));
  return new Promise((resolve,reject)=>{
   let deadline;const abort=()=>{stop();settled();};
   const cleanup=()=>{clearTimeout(deadline);pending.delete(id);signal?.removeEventListener('abort',abort);};
   const entry={resolve:v=>{cleanup();resolve(v);},reject:e=>{cleanup();reject(e);}};
   signal?.addEventListener('abort',abort,{once:true});pending.set(id,entry);
   // No process stop/restart and no resend on this deadline. Late replies are
   // ignored by request ID; the worker continues serial ownership of its page.
   if(method==='diagnostics')deadline=setTimeout(()=>entry.reject(Object.assign(Error('Diagnostic deadline'),{code:'DIAGNOSTIC_DEADLINE'})),diagnosticsTimeoutMs);
   try{child.stdin.write(JSON.stringify(request)+'\n',err=>{if(err)entry.reject(Error('worker unavailable'));});}catch{entry.reject(Error('worker unavailable'));}
  });
 }
 const within=async(promise,ms)=>{let timer;try{return await Promise.race([promise.then(()=>true,()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timer);}};
 return {platform:'douyin',capabilities,
  async diagnostics(args){if(!child||dead||stopping)return {state:'unavailable',code:'OWNER_NOT_RUNNING'};try{return sanitizePublisherDiagnostics(await call('diagnostics',args));}catch(e){return diagnosticFailure('owner_ipc',e?.code==='DIAGNOSTIC_DEADLINE'?'deadline':args?.signal?.aborted?'cancelled':'owner_unavailable');}},
  async status(args){try{return await call('status',args);}catch(e){return {state:'error',capabilities,code:e.code==='DESKTOP_UNAVAILABLE'?'DESKTOP_UNAVAILABLE':'TRANSPORT_ERROR'};}},
  async login(args){try{return await call('login',args);}catch(e){return {state:'error',code:e.code==='DESKTOP_UNAVAILABLE'?'DESKTOP_UNAVAILABLE':'TRANSPORT_ERROR'};}},
  async read(args){try{return await call('read',args);}catch(e){return {items:[],truncated:true,warnings:[e.code==='DESKTOP_UNAVAILABLE'?'DESKTOP_UNAVAILABLE':'TRANSPORT_ERROR']};}},
  async write(args){try{return await call('write',args);}catch(e){return {confirmed:false,state:e.code==='DESKTOP_UNAVAILABLE'?'refused':'uncertain',code:e.code==='DESKTOP_UNAVAILABLE'?'DESKTOP_UNAVAILABLE':'SUBMISSION_UNKNOWN'};}},
  async close(){
  if(closed)return;closed=true;if(!child)return;
  if(!dead&&!stopping)await within(call('close',{}),stopTimeoutMs);
  stop();if(!await within(ended,stopTimeoutMs)){
   try{killImpl(-child.pid,'SIGKILL');}catch{try{child.kill?.('SIGKILL');}catch{}}
   if(!await within(ended,stopTimeoutMs))throw Error('worker did not exit');
  }
 }};
}
