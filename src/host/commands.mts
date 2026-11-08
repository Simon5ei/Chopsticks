import {spawn as spawnChild} from 'node:child_process';
import {statSync,realpathSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {hash} from './state.mjs';
const KIND='command', LIMIT=32768;
export function createCommandExecutor({state,workspace,authorize,clean=(value)=>value,onRecord=()=>{},spawn=spawnChild,killGroup}: { state?: any; workspace?: any; authorize?: any; clean?: (...args: any[]) => any; onRecord?: (...args: any[]) => any; spawn?: any; killGroup?: any; [key: string]: any }={}) {
 let closed=false;const active=new Set<any>();
 const sanitize=(value)=>String(clean(String(value)));
 const bounded=(value)=>{let b=Buffer.from(sanitize(value));if(b.length<=LIMIT)return b.toString();return b.subarray(0,LIMIT).toString('utf8').replace(/\uFFFD$/,'');};
 const record=(id?: any,value?: any)=>{state.put(KIND,id,value);try{onRecord(value);}catch{ /* Audit observers cannot alter command execution. */ }};
 for(const row of state.list(KIND)){if(row.status==='running')record(row.id,{...row,status:'uncertain',warning:'Execution interrupted; side effects may have occurred. Do not replay automatically.'});}
 const terminate=(child)=>{try{if(killGroup)killGroup(child);else if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}};
 async function execute({sessionId,callId,command,cwd=workspace,timeoutMs=60000,signal}: { sessionId?: any; callId?: any; command?: any; cwd?: any; timeoutMs?: number; signal?: any; [key: string]: any }={}) {
  if(closed)throw Error('Command executor closed');
  const grant=await authorize(sessionId);
  if(!grant?.ticketId)throw Error('Development authorization required');
  if(typeof callId!=='string'||!callId.trim())throw Error('Stable command callId required');
  if(typeof command!=='string'||!command.trim())throw Error('Command required');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw Error('Command timeout must be 1000–120000 ms');
  if(typeof cwd!=='string'||!isAbsolute(cwd))throw Error('Command cwd must be absolute');
  const digest=hash({command,cwd,timeoutMs}),id=hash([grant.ticketId,callId]);
  const prior=state.get(KIND,id);
  if(prior){if(prior.digest!==digest)throw Error('Command idempotency payload changed');if(prior.status==='running'||prior.status==='uncertain')throw Error('Command uncertain: inspect effects before deliberate recovery');return prior;}
  const directory=realpathSync(cwd);if(!statSync(directory).isDirectory())throw Error('Command cwd must be a directory');
  // Recheck the durable grant after validation and immediately before journaling/spawn.
  const current=await authorize(sessionId);if(current?.ticketId!==grant.ticketId)throw Error('Development authorization changed');
  if(closed)throw Error('Command executor closed');
  if(signal?.aborted)throw Error('Command cancelled before spawn');
  const base={ticketId:grant.ticketId,sessionId,...(grant.eventId?{eventId:grant.eventId}:{}),...(grant.channel?{channel:grant.channel}:{}),callId,digest,command:bounded(command),cwd:bounded(cwd),timeoutMs,status:'running',startedAt:Date.now()};
  const raced=state.get(KIND,id);if(raced){if(raced.digest!==digest)throw Error('Command idempotency payload changed');throw Error('Command uncertain: concurrent execution already recorded');}
  record(id,base);
  if(closed||signal?.aborted){record(id,{...base,status:'cancelled',warning:'Cancelled before spawn; no shell was started.'});throw Error(closed?'Command executor closed':'Command cancelled before spawn');}
  return new Promise<any | void>((resolve)=>{
   let child,timer,done=false,reason,stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),stdoutTruncated=false,stderrTruncated=false;
   const finish=(code?: any,exitSignal?: any,error?: any)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(stop);
    // Shells can exit while background descendants remain in their process group.
    if(child)terminate(child);
    const result={...base,status:reason|| (error?'failed':'completed'),exitCode:code??null,signal:exitSignal??null,stdout:bounded(stdout.toString('utf8')),stderr:bounded(stderr.toString('utf8')),stdoutTruncated,stderrTruncated,finishedAt:Date.now(),...(error?{error:bounded(error.message||error)}:{}),...(reason?{warning:'Command stopped; side effects may have occurred. Do not replay automatically.'}:{})};
    try{record(id,result);resolve(result);}catch{resolve({...result,status:'uncertain',warning:'Receipt persistence failed; side effects may have occurred. Do not replay automatically.'});}
   };
   const stop=(why)=>{if(done)return;reason=why;if(child)terminate(child);};
   const abort=()=>stop('cancelled');
   active.add(stop);
   try{
    const env=Object.fromEntries(['PATH','HOME','USER','LANG','TZ','TMPDIR'].filter((k)=>typeof process.env[k]==='string').map((k)=>[k,process.env[k]]));
    child=spawn('/bin/sh',['-lc',command],{cwd:directory,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    child.on('error',(error)=>finish(null,null,error));child.on('close',(code?: any,sig?: any)=>finish(code,sig));
    const append=(kind?: any,chunk?: any)=>{const b=Buffer.from(chunk);if(kind==='stdout'){stdoutTruncated ||= stdout.length+b.length>LIMIT;stdout=Buffer.concat([stdout,b.subarray(0,LIMIT-stdout.length)]);}else{stderrTruncated ||= stderr.length+b.length>LIMIT;stderr=Buffer.concat([stderr,b.subarray(0,LIMIT-stderr.length)]);}};
    child.stdout.on('data',(b)=>append('stdout',b));child.stderr.on('data',(b)=>append('stderr',b));
    signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>stop('timed_out'),timeoutMs);if(signal?.aborted)abort();
   }catch(error){finish(null,null,error);}
  });
 }
 return {execute,close(){closed=true;for(const stop of active)stop('cancelled');}};
}
