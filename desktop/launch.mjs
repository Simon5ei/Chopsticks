import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {filterServerMessage} from './protocol.mjs';

/** Launch only the MCP engine in the existing desktop user's real session. */
export function buildLaunch(config,{account,desktopEnv={},callerUid}={}){
 if(config?.enabled!==true)throw Error('Desktop MCP is disabled');
 if(!account||account.name!==config.user||!Number.isSafeInteger(account.uid)||account.uid<=0||!path.posix.isAbsolute(account.home||'')||!(/^[a-z_][a-z0-9_-]{0,31}$/.test(account.name)))throw Error('Invalid desktop account');
 const binary=config.binary;
 if(typeof binary!=='string'||!path.posix.isAbsolute(binary)||binary.includes('\0'))throw Error('Invalid desktop executable');
 const runtime=`/run/user/${account.uid}`;
 if(desktopEnv.XDG_RUNTIME_DIR!==runtime||desktopEnv.DBUS_SESSION_BUS_ADDRESS!==`unix:path=${runtime}/bus`||!desktopEnv.DISPLAY&&!desktopEnv.WAYLAND_DISPLAY)throw Error('Real desktop session is unavailable');
 const env={HOME:account.home,USER:account.name,LOGNAME:account.name,PATH:`${path.posix.dirname(binary)}:/usr/local/bin:/usr/bin:/bin`,LANG:'C.UTF-8',XDG_RUNTIME_DIR:runtime,DBUS_SESSION_BUS_ADDRESS:`unix:path=${runtime}/bus`,COMPUTER_USE_LINUX_ENABLE_SHELL:'0',COMPUTER_USE_LINUX_NOTIFY_ON_COMPLETE:'0',COMPUTER_USE_LINUX_SCREENSHOT_BACKEND:'gnome-screenshot'};
 env.COMPUTER_USE_LINUX_PERSIST_REMOTE_DESKTOP='1';
 env.COMPUTER_USE_LINUX_FORCE_YDOTOOL_KEYBOARD='1';
 for(const key of ['DISPLAY','WAYLAND_DISPLAY','XDG_CURRENT_DESKTOP','XDG_SESSION_TYPE','DESKTOP_SESSION','XAUTHORITY']){
  const value=desktopEnv[key];if(typeof value!=='string'||!value||value.length>512||value.includes('\0'))continue;
  if(key==='DISPLAY'&&!/^:\d+(?:\.\d+)?$/.test(value))continue;
  if(key==='WAYLAND_DISPLAY'&&!/^wayland-\d+$/.test(value))continue;
  if(key==='XAUTHORITY'&&!(value.startsWith(runtime+'/')||value.startsWith(account.home+'/')))continue;
  env[key]=value;
 }
 if(!env.DISPLAY&&!env.WAYLAND_DISPLAY)throw Error('Real desktop session is unavailable');
 if(callerUid===account.uid)return {command:binary,args:['mcp'],env,shell:false};
 if(callerUid!==0)throw Error('MCP launcher must run as the desktop account or service owner');
 return {command:'/usr/sbin/runuser',args:['-u',account.name,'--','/usr/bin/env','-i',...Object.entries(env).map(([key,value])=>`${key}=${value}`),binary,'mcp'],env:{PATH:'/usr/sbin:/usr/bin:/bin',LANG:'C.UTF-8'},shell:false};
}

export function completeDesktopEnvironment(raw,account,exists=fs.existsSync){
 const result={...raw},runtime=`/run/user/${account.uid}`;
 if(result.XDG_RUNTIME_DIR===runtime&&result.DBUS_SESSION_BUS_ADDRESS===`unix:path=${runtime}/bus`&&!result.WAYLAND_DISPLAY&&!result.DISPLAY&&exists(`${runtime}/wayland-0`)){
  result.WAYLAND_DISPLAY='wayland-0';result.XDG_SESSION_TYPE='wayland';
 }
 return result;
}
export function findDesktopEnvironment(account,{procRoot='/proc'}={}){
 const keys=new Set(['DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','XDG_CURRENT_DESKTOP','XDG_SESSION_TYPE','DESKTOP_SESSION','XAUTHORITY']);
 for(const entry of fs.readdirSync(procRoot).filter(n=>/^\d+$/.test(n))){
  try{
   const root=path.join(procRoot,entry);
   if(fs.statSync(root).uid!==account.uid||fs.readFileSync(path.join(root,'comm'),'utf8').trim()!=='gnome-shell')continue;
   const result={};
   for(const item of fs.readFileSync(path.join(root,'environ'),'utf8').split('\0')){
    const split=item.indexOf('=');if(split<0)continue;
    const key=item.slice(0,split);if(keys.has(key))result[key]=item.slice(split+1);
   }
   const completed=completeDesktopEnvironment(result,account);
   if(completed.DBUS_SESSION_BUS_ADDRESS&&completed.XDG_RUNTIME_DIR&&(completed.DISPLAY||completed.WAYLAND_DISPLAY))return completed;
  }catch{/* A process may exit while being inspected. */}
 }
 throw Error('Real GNOME desktop session is unavailable');
}

export async function waitForDesktopEnvironment(account,{discover=findDesktopEnvironment,retryMs=500,timeoutMs=45000}={}){
 const deadline=Date.now()+timeoutMs;
 do{
  try{return discover(account);}catch{}
  await new Promise(resolve=>setTimeout(resolve,retryMs));
 }while(Date.now()<deadline);
 throw Error('Real GNOME desktop session is unavailable');
}
export async function run(){
 if(process.platform!=='linux')throw Error('Desktop MCP requires Linux');
 const config=JSON.parse(fs.readFileSync(process.env.CHOPSTICKS_CONFIG||'/var/lib/chopsticks/config.json','utf8')).desktop;
 if(!config||!(/^[a-z_][a-z0-9_-]{0,31}$/.test(config.user||'')))throw Error('Desktop MCP account is not configured');
 const fields=execFileSync('/usr/bin/getent',['passwd',config.user],{encoding:'utf8',timeout:5000}).trim().split(':');
 const account={name:fields[0],uid:Number(fields[2]),home:fields[5]};
 const launch=buildLaunch(config,{account,desktopEnv:await waitForDesktopEnvironment(account),callerUid:process.getuid()});
 const child=spawn(launch.command,launch.args,{env:launch.env,stdio:['pipe','pipe','inherit'],shell:false,detached:true});
 const stop=signal=>{try{process.kill(-child.pid,signal);}catch{}};
 for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,()=>stop(signal));
 child.stdin.on('error',error=>{if(error.code!=='EPIPE'){stop('SIGTERM');process.exitCode=1;}});
 process.stdin.pipe(child.stdin);
 const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
 void (async()=>{
  for await(const line of lines)if(!process.stdout.write(filterServerMessage(line)+'\n'))await once(process.stdout,'drain');
 })().catch(()=>{stop('SIGTERM');process.exitCode=1;});
 child.once('error',()=>{process.stderr.write('Desktop MCP process could not start\n');process.exitCode=1;});
 child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await run();}catch{process.stderr.write('Desktop MCP requires its configured real GNOME session\n');process.exitCode=1;}
}
