import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {platformStatus} from './status.mjs';

const platforms=new Set<any>(['qq','bilibili','qzone','heybox','douyin']);
const actorOps=new Set<any>(['status','read','write']);
const operatorOps=new Set<any>(['status','login','live_test','diagnostics','direct_message']);
const DEFAULT_MAX=262144;
const TIMEOUT=30000;
const fail=()=>new Error('Platform request failed');
function valid(req?: any,operator?: any){return req && typeof req==='object' && platforms.has(req.platform) && (operator?operatorOps:actorOps).has(req.operation) && req.args && typeof req.args==='object' && !Array.isArray(req.args);}
function sanitize(value?: any){
 if(Array.isArray(value))return value.map(sanitize);
 if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/cookie|token|secret|password|credential|authorization|qrurl/i.test(k)).map(([k,v])=>[k,sanitize(v)]));
 return value;
}
export function createPlatformBridge({socketPath,handle,maxBytes=DEFAULT_MAX,timeoutMs=TIMEOUT}: { socketPath?: any; handle?: any; maxBytes?: any; timeoutMs?: any; [key: string]: any }){
 if(typeof socketPath!=='string'||!socketPath||typeof handle!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw fail();
 const servers=[];const sockets=new Set<any>();let started=false;
 function makeServer(operator?: any){
  const server=http.createServer((req?: any,res?: any)=>{
   let size=0;const chunks=[];let finished=false;const controller=new AbortController();
   req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
   const finish=(code?: any,body?: any)=>{if(finished)return;finished=true;clearTimeout(timer);if(!res.destroyed){res.writeHead(code,{'content-type':'application/json','connection':'close'});res.end(JSON.stringify(body));}};
   let timer=setTimeout(()=>{controller.abort();finish(408,{error:'Platform request failed'});},timeoutMs);timer.unref();
   if(req.method!=='POST'||req.url!=='/'){finish(404,{error:'Platform request failed'});return;}
   req.on('data',(chunk)=>{size+=chunk.length;if(size>maxBytes){controller.abort();finish(413,{error:'Platform request failed'});req.resume();}else chunks.push(chunk);});
   req.on('error',()=>{controller.abort();finish(400,{error:'Platform request failed'});});
   req.on('end',async()=>{
    if(finished)return;
    try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!valid(data,operator))return finish(400,{error:'Platform request failed'});
     if(operator&&['live_test','diagnostics'].includes(data.operation)){clearTimeout(timer);timer=setTimeout(()=>{controller.abort();finish(408,{error:'Platform request failed'});},180000);timer.unref();}
     const output=await handle({platform:data.platform,operation:data.operation,args:data.args},{operator,signal:controller.signal});
     let safe=sanitize(output);if(data.operation==='status'){safe=platformStatus(output);}else if(data.operation==='login'){safe=Object.fromEntries(['state','qrImagePath','expiresAt'].filter((k)=>output?.[k]!==undefined).map((k)=>[k,output[k]]));}const encoded=JSON.stringify({result:safe});if(Buffer.byteLength(encoded)>maxBytes)throw fail();finish(200,{result:safe});
    }catch(error){const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{1,40}$/.test(error.code)?error.code:undefined;finish(500,{error:'Platform request failed',...(code?{code}:{})});}
   });
  });
  server.on('connection',(s)=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});return server;
 }
 async function bind(server?: any,p?: any){await new Promise<void>((resolve?: any,reject?: any)=>{server.once('error',reject);server.listen(p,()=>{server.off('error',reject);resolve();});});}
 async function reclaimStale(p?: any){
  const parent=path.dirname(p),dir=await fs.lstat(parent),before=await fs.lstat(p);
  if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o777)!==0o700||dir.uid!==process.getuid()||!before.isSocket()||before.uid!==process.getuid())throw fail();
  const result=await new Promise<string>((resolve)=>{const s=net.createConnection({path:p});s.setTimeout(1000,()=>{s.destroy();resolve('timeout');});s.once('connect',()=>{s.destroy();resolve('live');});s.once('error',(e: any) =>resolve(e.code));});
  if(result!=='ECONNREFUSED')throw fail();
  const [after,dirAfter]=await Promise.all([fs.lstat(p),fs.lstat(parent)]);
  if(!after.isSocket()||after.uid!==before.uid||after.dev!==before.dev||after.ino!==before.ino||!dirAfter.isDirectory()||dirAfter.uid!==dir.uid||dirAfter.dev!==dir.dev||dirAfter.ino!==dir.ino||(dirAfter.mode&0o777)!==0o700)throw fail();
  await fs.unlink(p);
 }
 async function listen(server?: any,p?: any){try{await bind(server,p);}catch(e){if(process.platform==='win32'||e.code!=='EADDRINUSE')throw e;await reclaimStale(p);await bind(server,p);}if(process.platform!=='win32')await fs.chmod(p,0o600);}
 return {
  async start(){if(started)throw fail();started=true;
   if(process.platform!=='win32'){await fs.mkdir(path.dirname(socketPath),{recursive:true,mode:0o700});const dir=await fs.lstat(path.dirname(socketPath));if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o777)!==0o700||dir.uid!==process.getuid())throw fail();}
   try{for(const [p,op] of [[socketPath,false],[socketPath+'.operator',true]]){const s=makeServer(op);servers.push(s);await listen(s,p);}}catch{await this.close();throw fail();}
  },
  async close(){for(const socket of sockets)socket.destroy();await Promise.all(servers.splice(0).map((s)=>new Promise<void>((resolve)=>{if(!s.listening)return resolve();s.close(()=>resolve());})));}
 };
}
export function requestPlatform({socketPath,platform,operation,args={},signal,operator=false}: { socketPath?: any; platform?: any; operation?: any; args?: Record<string, any>; signal?: any; operator?: boolean; [key: string]: any }){
 if(!valid({platform,operation,args},operator)||typeof socketPath!=='string')return Promise.reject(fail());
 return new Promise<any>((resolve?: any,reject?: any)=>{
  let payload;try{payload=JSON.stringify({platform,operation,args});if(Buffer.byteLength(payload)>DEFAULT_MAX)throw fail();}catch{return reject(fail());}
  const req=http.request({socketPath:operator?socketPath+'.operator':socketPath,path:'/',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(payload)},signal},(res)=>{
   let n=0;const chunks=[];res.on('data',(c)=>{n+=c.length;if(n>DEFAULT_MAX)req.destroy(fail());else chunks.push(c);});
   res.on('error',()=>reject(fail()));res.on('end',()=>{let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return reject(fail());}if(res.statusCode!==200||!Object.hasOwn(body,'result'))return reject(typeof body?.code==='string'&&/^[A-Z][A-Z0-9_]{1,40}$/.test(body.code)?Object.assign(fail(),{code:body.code}):fail());resolve(body.result);});
  });req.setTimeout(operator&&['live_test','diagnostics'].includes(operation)?180000:TIMEOUT,()=>req.destroy(fail()));req.on('error',()=>reject(fail()));req.end(payload);
 });
}


