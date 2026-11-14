import {createHostPrompts} from './prompts.mjs';
import {hash} from './state.mjs';
import {readWatchdogIssues} from './watchdog-issues.mjs';
import {platformRoute} from '../core/platforms.mjs';
import {redact} from '../core/events.mjs';
import {createRelationshipGraph,socialSource} from './relationship-graph.mjs';

export const evolutionNames={watchdog:'watchdog',reflection:'自我反思',social:'人际环境图',diary:'私密日志'};
const scopes=['public','qzone:friends','private:qq','private:bili','private:douyin','private:heybox','private:wechat'];
const occurred=(e)=>e&&!e.channel.startsWith('evolution:')&&!e.channel.startsWith('diary:')&&(['message.received','message.sent'].includes(e.kind)||(e.kind==='task.result'&&e.meta?.experienced===true));
// Deliberately allowlist diagnostics: never forward bodies, credentials, targets or raw errors.
export function evolutionSnapshot(raw: Record<string, any>={}){
 const node=(value?: any,depth: number=0)=>{if(!value||typeof value!=='object'||depth>3)return {};const out: Record<string, any>={};for(const key of ['ready','ok','enabled','connected','authenticated','state','code']){const v=value[key];if(typeof v==='boolean')out[key]=v;else if(typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,80}$/.test(v))out[key]=v;}for(const key of ['qq','bili','feed','inbox','qzone','heybox','douyin','health'])if(value[key]&&typeof value[key]==='object')out[key]=node(value[key],depth+1);return out;};
 const result: any=node(raw);if(Array.isArray(raw.issues))result.issues=raw.issues.filter((x)=>['qq','bili','bilibili','qzone','heybox','douyin','runtime'].includes(x.platform)&&/^[a-z_]{1,40}$/.test(x.operation||'')&&['error','unknown','verification_required','login_required','partial','unsupported','uncertain'].includes(x.state)).slice(0,30).map((x)=>({platform:x.platform,operation:x.operation,...node(x),...(Number.isSafeInteger(x.warningCount)?{warningCount:Math.max(0,Math.min(1000,x.warningCount))}:{})})).sort((a?: any,b?: any)=>`${a.platform}:${a.operation}`.localeCompare(`${b.platform}:${b.operation}`));return result;
}
export function createEvolution({prompts=createHostPrompts(),state,store,diary,sessions,caller,snapshot=()=>({}),clean=redact,now=Date.now,config={}}: { prompts?: any; state?: any; store?: any; diary?: any; sessions?: any; caller?: any; snapshot?: (...args: any[]) => any; clean?: any; now?: any; config?: Record<string, any>; [key: string]: any }){
 const relationshipGraph=createRelationshipGraph({state,store,clean,now});
 const interval=Math.max(60000,Number(config.reviewIntervalMs)||1800000);
 let closed=false,timer,polling,issueMemory: {state: string; version?: number; count?: number; digest?: string; code?: string}=config.knownIssuesFile?{state:'pending'}:undefined;
 const sourceView=(e)=>({id:e.id,kind:e.kind,channel:e.channel,actorId:e.actorId,at:e.at,text:state.get('evolution-snapshot',e.id)?.issueMemory?e.text:clean(e.text).slice(0,600)});
 async function enqueue(kind?: any,scope?: any,sources?: any,watermark?: any,cursorKey?: any,commit?: any,attempt: number=1){
  const requestId=`evolution:${kind}:${hash([scope,watermark,attempt]).slice(0,24)}`;
  const saved=state.get('evolution-turn',requestId);
  const event=saved?.event||store.append({id:requestId,kind:'timer',channel:`evolution:${kind}`,actorId:'fish',at:new Date(now()).toISOString(),text:JSON.stringify(sources.map(sourceView)),meta:{scope,sourceEventIds:sources.map((e)=>e.id),recoveryAttempt:attempt,internal:true,passive:true}});
  const turn=saved||{kind,scope,sourceEventIds:sources.map((e)=>e.id),event,requestId,createdAt:now(),cursorKey,watermark,commit,attempt,status:'pending'};
  state.put('evolution-turn',requestId,turn);
  await sessions.enqueue({event,action:{dispatchId:requestId,kind:'respond'},binding:{channel:event.channel,eventId:event.id,actorId:event.actorId,scope,role:'evolution',admin:false,consumed:false},preset:'chopsticks-evolution'});
  state.put('evolution-cursor',cursorKey,{...state.get('evolution-cursor',cursorKey),at:now(),pendingRequestId:requestId});
 }
 function commitReport(turn?: any){
  let receipt=state.get(turn.kind==='diary'?'diary-receipt':'evolution-report',turn.requestId);
  if(turn.kind==='diary'&&!receipt&&diary){const entry=diary.read({scope:turn.scope,date:turn.event.meta.date},{scopes:[turn.scope]});if(entry&&entry.createdAt>=turn.createdAt&&entry.sourceEventIds.every((id)=>turn.sourceEventIds.includes(id))){receipt={status:'saved',entryId:entry.id,scope:entry.scope,date:entry.date,sourceEventIds:entry.sourceEventIds,recovered:true,at:now()};state.put('diary-receipt',turn.requestId,receipt);}}
  if(!receipt||turn.kind==='diary'&&(receipt.scope!==turn.scope||receipt.date!==turn.event.meta.date))return false;
  if(turn.kind==='social')relationshipGraph.accept(receipt);
  for(const id of turn.commit?.issueIds||[]){const source=state.get('evolution-snapshot',id);if(source?.issueMemory&&!source.reviewed)state.put('evolution-snapshot',id,{...source,reviewed:true});}
  state.put('evolution-turn',turn.requestId,{...turn,status:'completed',completedAt:now(),...(turn.kind==='diary'?{completion:receipt.status}:{})});
  const cursor=state.get('evolution-cursor',turn.cursorKey);
  if(cursor?.pendingRequestId===turn.requestId)state.put('evolution-cursor',turn.cursorKey,{...cursor,...turn.commit,at:now(),pendingRequestId:null});
  return true;
 }
 function finish(job?: any){
  const turn=state.get('evolution-turn',job.requestId);if(!turn||commitReport(turn))return;
  if(['incomplete','attention_required'].includes(turn.status))return;
  state.put('evolution-turn',turn.requestId,{...turn,status:turn.attempt>=2?'attention_required':'incomplete',reason:turn.kind==='diary'?'no_persisted_diary_decision':'no_persisted_report',finishedAt:now(),nextAttemptAt:now()+interval});
 }
 async function ready(key?: any,candidate?: any,unseenEvidence: boolean=false){
  const cursor=state.get('evolution-cursor',key),pending=cursor?.pendingRequestId;
  if(!pending)return true;
  let turn=state.get('evolution-turn',pending);if(!turn)return false;
  if(commitReport(turn))return true;
  const job=state.get('platform-job',pending);
  if(['completed','interrupted'].includes(job?.status)){finish(job);turn=state.get('evolution-turn',pending);}
  if(turn.status==='incomplete'&&now()>=turn.nextAttemptAt){
   if(turn.kind==='diary')await enqueueDiary(turn.event,turn.attempt+1);else await enqueue(turn.kind,turn.scope,turn.sourceEventIds.map((id)=>store.get(id)),turn.watermark,key,turn.commit,turn.attempt+1);
   return false;
  }
  // After one delayed recovery, retain an explicit unresolved record. Only genuinely
  // new evidence may open a fresh review; the same reportless input never loops.
  return turn.status==='attention_required'&&now()>=turn.nextAttemptAt&&(unseenEvidence||candidate!==(turn.kind==='watchdog'?turn.commit.signature:turn.commit.seq));
 }
 async function runPoll(){
  if(closed)return;
  relationshipGraph.sync();
  for(const cursor of state.list('evolution-cursor'))if(cursor.id.startsWith('diary:')&&cursor.pendingRequestId)await ready(cursor.id,undefined);
  const diagnostic: any=evolutionSnapshot(snapshot());
  let issueSources=[],pendingIssues=[];
  if(config.knownIssuesFile){
   const loaded=await readWatchdogIssues(config.knownIssuesFile,clean);
   if(loaded.state==='ready'){
    const ids=[];
    for(const issue of loaded.issues){
     const body={version:1,provenance:'operator-maintained',issue},digest=hash(body),id=`evolution-known-issue:${issue.id}:${digest}`;
     const source=store.append({id,kind:'timer',channel:'evolution:watchdog',actorId:'runtime',at:new Date(now()).toISOString(),text:JSON.stringify(body),meta:{internal:true,passive:true,issueMemory:true,provenance:'operator-maintained'}});
     if(!state.get('evolution-snapshot',id))state.put('evolution-snapshot',id,{signature:digest,issueMemory:true,seq:source.seq,reviewed:false});
     ids.push(id);
    }
    state.put('watchdog-issue-memory','current',{digest:loaded.digest,ids});
    issueMemory={state:'ready',version:1,count:ids.length,digest:loaded.digest};
   }else issueMemory={state:'error',code:loaded.code};
   diagnostic.issueMemory=issueMemory;
   // Persisted turns distinguish never-dispatched versions from reportless ones.
   // Only the former may bypass an exhausted turn with the same health signature.
   const attempted=new Set<any>(state.list('evolution-turn').filter((t)=>t.kind==='watchdog').flatMap((t)=>t.commit?.issueIds||[]));
   pendingIssues=state.list('evolution-snapshot').filter((s)=>s.issueMemory&&!s.reviewed&&!attempted.has(s.id)).sort((a?: any,b?: any)=>a.seq-b.seq);
   const current=state.get('watchdog-issue-memory','current');
   // Register changes even while an earlier native turn is queued. A report only
   // acknowledges the versions it actually read; bounded batches drain later.
   const ids=pendingIssues.length?pendingIssues.slice(0,19).map((s)=>s.id):(current?.ids||[]);
   let size=0;
   for(const id of ids){const source=store.get(id),length=JSON.stringify(sourceView(source)).length+1;if(size+length>80000)break;issueSources.push(source);size+=length;}
  }
  const signature=hash(diagnostic);
  if(await ready('watchdog',signature,pendingIssues.length>0)){
   const previous=state.get('evolution-cursor','watchdog');
   if((!previous||previous.signature!==signature||pendingIssues.length)&&(!previous||now()-previous.at>=interval)){
    const pendingTurn=previous?.pendingRequestId&&state.get('evolution-turn',previous.pendingRequestId);
    const generation=Math.max(previous?.generation||0,pendingTurn?.commit?.generation||0)+1,id=`evolution-snapshot:${generation}:${signature.slice(0,16)}`;
    const source=store.append({id,kind:'timer',channel:'evolution:watchdog',actorId:'runtime',at:new Date(now()).toISOString(),text:JSON.stringify(diagnostic),meta:{internal:true,passive:true,snapshot:true}});
    state.put('evolution-snapshot',id,{signature});
    await enqueue('watchdog','internal:runtime',[source,...issueSources],id,'watchdog',{signature,generation,...(config.knownIssuesFile?{issueIds:issueSources.map((e)=>e.id)}:{})});
   }
  }
  // Query only actual occurrence classes, preventing timer/report self-trigger loops.
  const rows=store.db.prepare("SELECT id FROM core_events WHERE kind IN ('message.received','message.sent','task.result') ORDER BY seq DESC LIMIT 5000").all();
  const events=rows.map((r)=>store.get(r.id)).filter(occurred).reverse();
  for(const kind of ['reflection','social'])for(const scope of scopes){
   const key=`${kind}:${scope}`,pool=events.filter((e)=>platformRoute(e.channel).scope===scope&&(kind!=='social'||socialSource(e)));
   if(!pool.length||!await ready(key,pool.at(-1).seq))continue;
   const cursor=state.get('evolution-cursor',key);
   if(cursor&&now()-cursor.at<interval)continue;
   const fresh=pool.filter((e)=>e.seq>(cursor?.seq||0));if(!fresh.length)continue;
   // Bound initial backlog; every report cites only its explicit retained evidence window.
   const sources=fresh.slice(-20),seq=fresh.at(-1).seq;
   await enqueue(kind,scope,sources,seq,key,{seq,omitted:Math.max(0,fresh.length-sources.length)});
  }
 }
 function poll(){if(polling)return polling;polling=runPoll().finally(()=>{polling=null;});return polling;}
 function authorize(sessionId?: any,signal?: any){
  signal?.throwIfAborted();if(closed)throw Error('Evolution closed');
  const c=caller(sessionId),turn=state.get('evolution-turn',c?.requestId),job=state.get('platform-job',c?.requestId);
  if(!c?.consumed||c.interrupted||c.role!=='evolution'||!turn||c.channel!==turn.event.channel||c.eventId!==turn.event.id||c.scope!==turn.scope||job?.sessionId!==sessionId||job?.status!=='starting')throw Error('Evolution requires active consumed internal binding');
  return turn;
 }
 function read(sessionId?: any,signal?: any){const turn=authorize(sessionId,signal);return {kind:turn.kind,scope:turn.scope,sourceEventIds:turn.sourceEventIds,sources:turn.sourceEventIds.map((id)=>store.get(id)).filter((e)=>turn.kind!=='social'||socialSource(e)).map(sourceView),reports:state.list('evolution-report').filter((r)=>r.kind===turn.kind&&r.scope===turn.scope&&(turn.kind!=='social'||(r.sourceEventIds?.length>0&&r.sourceEventIds.every((id)=>socialSource(store.get(id)))))).sort((a?: any,b?: any)=>b.createdAt-a.createdAt).slice(0,3).map((r)=>({id:r.id,kind:r.kind,scope:r.scope,createdAt:r.createdAt,facts:r.facts.slice(0,5).map((c)=>({...c,text:c.text.slice(0,400)})),hypotheses:r.hypotheses.slice(0,5).map((c)=>({...c,text:c.text.slice(0,400)})),relationships:r.relationships.slice(0,8)}))};}
 function report(sessionId?: any,input?: any,signal?: any){
  const turn=authorize(sessionId,signal);
  if(input?.scope!==turn.scope)throw Error('Evolution scope mismatch');
  const validateSources=(ids)=>{if(!Array.isArray(ids)||!ids.length||ids.length>20||new Set<any>(ids).size!==ids.length)throw Error('Canonical sources required');for(const id of ids){const e=store.get(id);if(!turn.sourceEventIds.includes(id)||!e||(turn.kind==='watchdog'?!state.get('evolution-snapshot',id):!occurred(e)||platformRoute(e.channel).scope!==turn.scope||(turn.kind==='social'&&!socialSource(e))))throw Error('Evolution source outside bound scope or not occurred');}return [...ids];};
  const text=(value)=>{if(typeof value!=='string'||!value.trim()||value.length>2000)throw Error('Bounded nonempty text required');return clean(value);};
  const claims=(value)=>{if(!Array.isArray(value)||value.length>20)throw Error('Invalid claims');return value.map((v)=>({text:text(v.text),sourceEventIds:validateSources(v.sourceEventIds)}));};
  const facts=claims(input.facts),hypotheses=claims(input.hypotheses||[]);if(!facts.length)throw Error('At least one sourced observation required');
  if(!Array.isArray(input.relationships||[])||(input.relationships||[]).length>20)throw Error('Invalid relationships');
  const relationships=(input.relationships||[]).map((r)=>{if(turn.kind!=='social'||!['observed','hypothesis'].includes(r.certainty))throw Error('Invalid social relationship');const ids=validateSources(r.sourceEventIds),actors=new Set<any>(['fish',...ids.map((id)=>store.get(id).actorId)]);if(!actors.has(r.from)||!actors.has(r.to)||r.from===r.to)throw Error('Relationship actors require canonical provenance');return {from:r.from,to:r.to,relation:text(r.relation),certainty:r.certainty,sourceEventIds:ids};});
  const body={kind:turn.kind,scope:turn.scope,facts,hypotheses,relationships};if(JSON.stringify(body).length>24000)throw Error('Evolution report exceeds bounded size');const receipt=(row)=>({id:row.id,kind:row.kind,scope:row.scope,createdAt:row.createdAt,persisted:true});const previous=state.get('evolution-report',turn.requestId);if(previous){if(previous.digest!==hash(body))throw Error('Evolution report already persisted');if(turn.kind==='social')relationshipGraph.accept(previous);return receipt(previous);}
  signal?.throwIfAborted();const row={id:turn.requestId,...body,digest:hash(body),sourceEventIds:turn.sourceEventIds,createdAt:now(),sessionId};state.put('evolution-report',turn.requestId,row);commitReport(turn);return receipt(row);
 }
 async function enqueueDiary(event?: any,attempt: number=1){
  if(closed)return;
  const source=store.append({...event,id:attempt>1?`${event.id}:recovery:${attempt-1}`:event.id,meta:{...event.meta,recoveryAttempt:attempt,internal:true,passive:true}}),scope=platformRoute(source.channel).scope;
  const cursorKey=`diary:${scope}:${source.meta.date}`,requestId=source.id;
  const turn=state.get('evolution-turn',requestId)||{kind:'diary',scope,sourceEventIds:source.meta.sourceEventIds,event:source,requestId,createdAt:now(),cursorKey,commit:{date:source.meta.date,scope},attempt,status:'pending'};
  state.put('evolution-turn',requestId,turn);
  await sessions.enqueue({event:source,action:{dispatchId:requestId,kind:'respond'},binding:{channel:source.channel,eventId:source.id,actorId:source.actorId,scope,role:'diary',admin:false,consumed:false},preset:'chopsticks-diary'});
  state.put('evolution-cursor',cursorKey,{...state.get('evolution-cursor',cursorKey),at:now(),pendingRequestId:requestId});
 }
 function prompt(event?: any,source?: any){const kind=event.channel.split(':')[1];return prompts.render('evolution.review',{role:String(evolutionNames[kind]),recovery:event.meta.recoveryAttempt>1?'yes':undefined,scope:String(event.meta.scope),focus:kind==='social'?'social':kind==='watchdog'?'watchdog':'reflection',sources:String(event.text)},source||{eventId:event.id,channel:event.channel});}
 return {relationships:relationshipGraph,poll,read,report,prompt,enqueueDiary,finish,status:()=>({...issueMemory?{issueMemory}:{},sessions:state.list('platform-session').filter((r)=>r.workspace==='evolution').map(({key,sessionId}: { key?: any; sessionId?: any; [key: string]: any })=>({key,sessionId})),reports:state.list('evolution-report').length,incomplete:state.list('evolution-turn').filter((r)=>['incomplete','attention_required'].includes(r.status)).map(({requestId,kind,scope,status,nextAttemptAt}: { requestId?: any; kind?: any; scope?: any; status?: any; nextAttemptAt?: any; [key: string]: any })=>({requestId,kind,scope,status,nextAttemptAt})),reviewIntervalMs:interval}),async start(){relationshipGraph.sync();for(const channel of ['evolution:watchdog','evolution:reflection','evolution:social','diary:public'])await sessions.resolve({channel},{preset:channel.startsWith('diary:')?'chopsticks-diary':'chopsticks-evolution'});await poll();timer=setInterval(()=>void poll().catch(()=>{}),60000);timer.unref?.();},async close(){closed=true;clearInterval(timer);await polling;}};
}
