import {randomUUID} from 'node:crypto';
import {platformRoute} from '../core/platforms.mjs';

export function createPlatformSessions({state,characterId,ensure,execute,isIdle=()=>true,cancel=async()=>{},now=Date.now,timeoutMs=600000,presetFor,onInterrupted=()=>{},onFinished=()=>{}}: { state?: any; characterId?: any; ensure?: any; execute?: any; isIdle?: (...args: any[]) => any; cancel?: (...args: any[]) => any; now?: any; timeoutMs?: number; presetFor?: any; onInterrupted?: (...args: any[]) => any; onFinished?: (...args: any[]) => any; [key: string]: any }){
 const running=new Map(), locks=new Map(); let started=false,closed=false,timer;
 const save=(row)=>(state.put('platform-job',row.requestId,row),row);
 const interrupt=(id)=>{try{onInterrupted(id);}catch{}};
 const abortable=(promise?: any,signal?: any)=>{if(!signal)return Promise.resolve(promise);if(signal.aborted)return Promise.reject(signal.reason);return new Promise<any | void>((resolve?: any,reject?: any)=>{const abort=()=>{cleanup();reject(signal.reason);};const cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then((value)=>{cleanup();resolve(value);},(error)=>{cleanup();reject(error);});});};
 const registryId=(key)=>`${characterId}:workspaces-v2:${key}`;
 async function resolve(event?: any,{preset,adoptId,signal}: { preset?: any; adoptId?: any; signal?: any; [key: string]: any }={}){
  signal?.throwIfAborted();
  const route=platformRoute(event),key=route.sessionKey,id=registryId(key);
  let row=state.get('platform-session',id);
  if(!row){row={key,characterId,layoutVersion:2,workspace:route.workspace,sessionId:`chopsticks-platform-${randomUUID()}`,preset:preset||presetFor?.(route,event)};state.put('platform-session',id,row);}
  signal?.throwIfAborted();await abortable(Promise.resolve().then(()=>{signal?.throwIfAborted();return ensure(row.sessionId,row.preset,signal,route);}),signal);signal?.throwIfAborted();return {key,sessionId:row.sessionId,preset:row.preset};
 }
 async function enqueue({action,event,binding,preset,adoptId,signal}: { action?: any; event?: any; binding?: any; preset?: any; adoptId?: any; signal?: any; [key: string]: any }){
  signal?.throwIfAborted();
  if(!binding||binding.channel!==event?.channel||binding.eventId!==event?.id||binding.actorId!==event?.actorId)throw Error('Binding does not match source event');
  const requestId=action?.dispatchId;if(typeof requestId!=='string'||!requestId)throw Error('Stable dispatchId required');
  let prior=state.get('platform-job',requestId);
  if(prior){if(JSON.stringify([prior.action,prior.event,prior.binding])!==JSON.stringify([action,event,binding]))throw Error('Dispatch payload changed');return {accepted:true,sessionId:prior.sessionId,requestId};}
  const resolved=await resolve(event,{preset,adoptId,signal});
  signal?.throwIfAborted();
  prior=state.get('platform-job',requestId);if(prior){if(JSON.stringify([prior.action,prior.event,prior.binding])!==JSON.stringify([action,event,binding]))throw Error('Dispatch payload changed');return {accepted:true,sessionId:prior.sessionId,requestId};}
  save({...resolved,characterId,requestId,action,event,binding,status:'queued',createdAt:now(),order:state.list('platform-job').length});
  if(started&&!closed)void tick();return {accepted:true,sessionId:resolved.sessionId,requestId};
 }
 async function process(key?: any){
  if(closed||running.has(key))return;
  const jobs=state.list('platform-job').filter((j)=>j.characterId===characterId&&j.key===key).sort((a?: any,b?: any)=>a.order-b.order);
  const uncertain=jobs.find((j)=>j.status==='uncertain');
  if(uncertain){try{await cancel(uncertain.sessionId);if(!await isIdle(uncertain.sessionId))return;save({...uncertain,status:'interrupted',finishedAt:now()});}catch{return;}}
  const job=jobs.find((j)=>j.status==='queued');if(!job||closed||!await isIdle(job.sessionId)||closed)return;
  const controller=new AbortController();running.set(key,{job,controller,consumed:false});
  save({...job,status:'starting',startedAt:now()});
  const binding={...job.binding,requestId:job.requestId,consumed:false};state.put('request',job.requestId,binding);state.put('binding',job.sessionId,binding);
  void abortable(Promise.resolve().then(()=>{controller.signal.throwIfAborted();return execute({sessionId:job.sessionId,action:job.action,event:job.event,binding,signal:controller.signal});}),controller.signal).catch(()=>{const active=running.get(key);if(active?.job.requestId===job.requestId){running.delete(key);interrupt(job.requestId);save({...state.get('platform-job',job.requestId),status:'uncertain'});void tick();}});
 }
 async function tick(){if(!started||closed)return;const keys=new Set<any>(state.list('platform-job').filter((j)=>j.characterId===characterId&&['queued','uncertain'].includes(j.status)).map((j)=>j.key));for(const [key,active] of running){const row=state.get('platform-job',active.job.requestId);if(row?.startedAt+timeoutMs<=now()){running.delete(key);interrupt(active.job.requestId);active.controller.abort();save({...row,status:'uncertain'});keys.add(key);}}
  await Promise.all([...keys].map((key)=>{if(locks.has(key))return locks.get(key);const p=process(key).finally(()=>locks.delete(key));locks.set(key,p);return p;}));}
 function event(sessionId?: any,ev?: any){for(const [key,active] of running){if(active.job.sessionId!==sessionId)continue;if(ev.type==='user/message'){const source=ev.data?.message?.source||ev.data?.source;if(source?.rpcId===active.job.requestId){active.consumed=true;const b=state.get('request',active.job.requestId);state.put('binding',sessionId,{...b,consumed:true});}}else if(ev.type==='turn/end'&&active.consumed){running.delete(key);const done=save({...state.get('platform-job',active.job.requestId),status:'completed',finishedAt:now()});onFinished(done,ev.data?.reason?.kind);void tick();}break;}}
 async function start(){if(started||closed)return;for(const row of state.list('platform-job'))if(row.characterId===characterId){if(row.status==='starting'){interrupt(row.requestId);save({...row,status:'uncertain'});}else if(row.status==='queued'){const resolved=await resolve(row.event,{preset:row.preset});save({...row,...resolved});}}started=true;await tick();timer=setInterval(()=>void tick(),1000);timer.unref?.();}
 async function close(){closed=true;clearInterval(timer);const tasks=[];for(const {job,controller} of running.values()){interrupt(job.requestId);controller.abort();save({...state.get('platform-job',job.requestId),status:'uncertain'});tasks.push(Promise.resolve().then(()=>cancel(job.sessionId)).catch(()=>{}));}running.clear();await Promise.all(tasks);}
 function status(){return state.list('platform-job').filter((j)=>j.characterId===characterId).map(({requestId,key,sessionId,status}: { requestId?: any; key?: any; sessionId?: any; status?: any; [key: string]: any })=>({requestId,key,sessionId,status}));}
 return {resolve,enqueue,event,start,tick,status,close};
}
