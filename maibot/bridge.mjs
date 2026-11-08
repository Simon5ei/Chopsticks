import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeMaiBotConfig,maiBotToolNames} from './policy.mjs';
import {safeFetch} from '../web/lib/safe-fetch.mjs';

const runner=fileURLToPath(new URL('./runner.py',import.meta.url));
const LIMIT=1024*1024;
export function createMaiBotBridge(options){
 const config=normalizeMaiBotConfig({...options,enabled:true}),allowed=new Set(maiBotToolNames(config));
 const timeoutMs=Math.max(100,Math.min(120000,options.timeoutMs||30000));
 let child,closed=false,unavailable=false,sequence=0,buffer=Buffer.alloc(0),starting,tools=[];
 const pending=new Map(),httpWork=new Set();
 function fail(error){unavailable=true;for(const p of [...pending.values()])p.reject(error);}
 async function wikiGet(message){
  const p=pending.get(message.parentId);let reply;
  try{
   if(!p||p.plugin!=='wiki'||++p.reads>8)throw Error('Unsupported read capability');
   const params=message.params,keys=new Set(['action','generator','gsrsearch','gsrlimit','gsrnamespace','prop','inprop','exintro','explaintext','format','search','limit','namespace','pithumbsize','cllimit','titles','redirects']);
   if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!keys.has(k))||!['query','opensearch'].includes(params.action)||params.format!=='json')throw Error('Invalid wiki query');
   const url=new URL('https://zh.moegirl.org.cn/api.php');for(const [key,value]of Object.entries(params)){if(typeof value!=='string')throw Error('Invalid wiki query');url.searchParams.set(key,value);}
   if(url.href.length>12000)throw Error('Wiki query too large');
   const response=await safeFetch(url.href,50000,{signal:p.control.signal});if(response.statusCode!==200||response.truncated)throw Error('Wiki unavailable');reply={result:JSON.parse(response.body)};
  }catch{reply={error:'wiki_fetch_failed'};}
  if(!closed&&pending.has(message.parentId)&&child?.stdin.writable)child.stdin.write(JSON.stringify({method:'host_result',requestId:message.requestId,...reply})+'\n',()=>{});
 }
 function receive(chunk){
  buffer=Buffer.concat([buffer,chunk]);
  if(buffer.length>LIMIT){fail(Error('MaiBot response exceeds limit'));child?.kill();return;}
  let at;while((at=buffer.indexOf(10))>=0){const line=buffer.subarray(0,at);buffer=buffer.subarray(at+1);if(!line.length)continue;
   let value;try{value=JSON.parse(line.toString('utf8'));}catch{fail(Error('Invalid MaiBot protocol response'));child?.kill();return;}
   if(value.capability==='wiki.get'){const work=wikiGet(value);httpWork.add(work);void work.finally(()=>httpWork.delete(work)).catch(()=>{});continue;}
   const p=pending.get(value.id);if(!p)continue;
   if(value.error)p.reject(Error('MaiBot plugin operation failed'));else p.resolve(value.result);
  }
 }
 function request(message,signal){
  if(closed)return Promise.reject(Error('MaiBot bridge closed'));
  if(unavailable||!child)return Promise.reject(Error('MaiBot child unavailable'));
  if(signal?.aborted)return Promise.reject(Error('MaiBot call cancelled'));
  const id=++sequence,payload=JSON.stringify({id,...message})+'\n';
  if(Buffer.byteLength(payload)>65536)return Promise.reject(Error('MaiBot request exceeds limit'));
  return new Promise((resolve,reject)=>{
   const control=new AbortController();
   const finish=(fn,value)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);control.abort();fn(value);};
   const cancel=()=>{if(child?.stdin.writable)child.stdin.write(JSON.stringify({method:'cancel',requestId:id})+'\n',()=>{});};
   const abort=()=>{cancel();finish(reject,Error('MaiBot call cancelled'));};
   const timer=setTimeout(()=>{cancel();finish(reject,Error('MaiBot call timed out'));},timeoutMs);
   pending.set(id,{plugin:message.plugin,reads:0,control,resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)});signal?.addEventListener('abort',abort,{once:true});
   child.stdin.write(payload,error=>{if(error)pending.get(id)?.reject(Error('MaiBot child unavailable'));});
  });
 }
 async function start(){
  if(closed)throw Error('MaiBot bridge closed');if(starting)return starting;
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|PASSWORD|SECRET|TOKEN|COOKIE|CREDENTIAL|^DSH_|^CHOPSTICKS_/i.test(key)));
  env.PYTHONIOENCODING='utf-8';env.PYTHONUNBUFFERED='1';
  child=spawn(options.python||'python3',[options.runnerPath||runner],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stdout.on('data',receive);child.stderr.on('data',()=>{});child.stdin.on('error',()=>fail(Error('MaiBot child unavailable')));
  child.on('error',()=>fail(Error('MaiBot child unavailable')));child.on('exit',()=>fail(Error('MaiBot child exited')));
  starting=request({method:'init',plugins:config.plugins,dataDir:options.dataDir}).then(result=>{
   if(!Array.isArray(result?.tools)||result.tools.length>allowed.size)throw Error('Invalid MaiBot tool discovery');
   const names=new Set();for(const t of result.tools){if(!allowed.has(t.name)||names.has(t.name)||t.inputSchema?.type!=='object')throw Error('Invalid MaiBot tool discovery');names.add(t.name);}
   tools=result.tools;return tools;
  }).catch(async error=>{await close();throw error;});return starting;
 }
 async function call(name,args,signal){await start();if(closed)throw Error('MaiBot bridge closed');const tool=tools.find(t=>t.name===name);if(!tool)throw Error('Unknown MaiBot tool');return request({method:'call',plugin:tool.plugin,name:tool.rawName,args},signal);}
 async function close(){
  if(closed)return;closed=true;fail(Error('MaiBot bridge closed'));await Promise.allSettled([...httpWork]);if(!child)return;
  const process=child;if(process.exitCode!==null||process.signalCode)return;
  await new Promise(resolve=>{const timer=setTimeout(()=>{process.kill();resolve();},1000);process.once('exit',()=>{clearTimeout(timer);resolve();});process.stdin.end(JSON.stringify({id:++sequence,method:'close'})+'\n');});
 }
 return {start,call,close};
}
