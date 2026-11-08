import {createInterface} from 'node:readline';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validWorkerRequest} from './user-platform.mjs';
import {createDouyinPlatform} from './index.mjs';
export function createWorkerHandler({createPlatform}: { createPlatform?: any; [key: string]: any }) {
 let platform,closed=false;const active=new Set<any>();
 async function close(){if(closed)return;closed=true;for(const c of active)c.abort();if(platform)await platform.close();}
 const handle=async (request?: any) =>{
  if(!validWorkerRequest(request))return {id:request?.id,error:'invalid_request'};
  if(request.method==='close'){await close();return {id:request.id,result:{state:'closed'}};}
  if(closed)return {id:request.id,error:'closed'};
  if(request.method==='diagnostics'&&!platform)return {id:request.id,result:{state:'unavailable',code:'OWNER_NOT_RUNNING'}};
  platform ||= createPlatform();const controller=new AbortController();active.add(controller);
  try{return {id:request.id,result:await platform[request.method]({...request.args,signal:controller.signal})};}
  catch{return {id:request.id,error:'operation_failed'};}finally{active.delete(controller);}
 };
 handle.close=close;return handle;
}
async function run(){
 process.umask(0o077);
 const [stateDir,chromePath,browserBackend='wayland',...extra]=process.argv.slice(2);
 if(!stateDir||!chromePath||extra.length||!['wayland','x11'].includes(browserBackend))throw Error('invalid arguments');
 const handler=createWorkerHandler({createPlatform:()=>createDouyinPlatform({stateDir,config:{douyin:{chromePath,headless:false,browserBackend}}})});
 let quitting=false;const shutdown=async()=>{if(quitting)return;quitting=true;await handler.close();process.exit(0);};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);process.once('SIGHUP',shutdown);
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});lines.on('line',(line)=>{if(line.length>65536){void shutdown();return;}let req;try{req=JSON.parse(line);}catch{void shutdown();return;}void handler(req).then((result)=>{if(!quitting)process.stdout.write(JSON.stringify(result)+'\n');if(req.method==='close')void shutdown();});});
 lines.on('close',()=>void shutdown());
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(()=>{process.exitCode=1;});
