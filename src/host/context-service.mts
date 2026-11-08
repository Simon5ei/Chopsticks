import {platformRoute,publicChannel} from '../core/platforms.mjs';

const MAX_ROWS=12, SCAN_ROWS=2048, SEARCH_CHARS=4096;
const publicSql="(channel GLOB 'g:[0-9]*' OR channel GLOB 'wechat:group:*' OR channel IN ('bili:public','douyin:public','heybox:public'))";
const count=(value)=>Number.isFinite(value)?Math.max(1,Math.min(MAX_ROWS,Math.floor(value))):8;
function scope(caller?: any){
 const channel=caller?.channel||caller?.chatKey;
 if(typeof channel!=='string'||channel.length>512)throw Error('Trusted caller scope required');
 try{platformRoute(channel);}catch{throw Error('Trusted caller scope required');}
 return {channel,sql:publicChannel(channel)?publicSql:'channel = ?',args:publicChannel(channel)?[]:[channel]};
}
function reference(id?: any){if(typeof id!=='string'||!id||id.length>512)throw Error('Invalid context reference');return id;}
function cursor(value?: any){if(value==null)return Number.MAX_SAFE_INTEGER;if(!Number.isSafeInteger(value)||value<=0)throw Error('Invalid context cursor');return value;}
const columns=(chars)=>`seq,id,kind,channel,substr(actor_id,1,256) AS actorId,substr(at,1,40) AS at,substr(text,1,${chars}) AS text,length(text) AS textLength`;
// Invalid/oversized task metadata is unknown, hence cannot cross its source.
const taskRef="CASE WHEN kind!='task.result' THEN NULL WHEN json_valid(substr(meta,1,32000)) THEN json_extract(substr(meta,1,32000),'$.ticketId') ELSE '__unknown__' END AS ticketId";
const projected='seq,id,kind,channel,actorId,at,text,textLength';
function envelope(rows?: any,limit?: any,extra: Record<string, any>={}){
 const events=[];let bytes=0;
 for(const row of rows.slice(0,limit)){
  const {textLength,...item}=row;item.threadId=item.channel;item.truncated=textLength>item.text.length;
  // JSON escaping also counts against the output budget.
  while(JSON.stringify(item).length>11000-bytes&&item.text.length){item.text=item.text.slice(0,Math.floor(item.text.length/2));item.truncated=true;}
  const size=JSON.stringify(item).length;if(bytes+size>11000)break;
  events.push(item);bytes+=size;
 }
 const truncated=rows.length>events.length;
 return {events,truncated,nextBeforeSeq:truncated?events.at(-1)?.seq??null:null,...extra};
}

/** Historical evidence only: retrieved text never confers operation authority.
 * Search deliberately covers the latest 2048 authorized events' first 4096 chars.
 * Exact event/thread references expand older evidence without scanning memory cards.
 */
export function createContextService({store,state,coordinator}: { store?: any; state?: any; coordinator?: any; [key: string]: any }){
 const db=store.db;
 function visible(access?: any){
  const hasState=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='host_kv' LIMIT 1").get();
  const knownResearch=hasState?`EXISTS (SELECT 1 FROM host_kv WHERE kind='task-source' AND id=candidates.ticketId AND CASE WHEN json_valid(substr(value,1,4096)) THEN json_extract(substr(value,1,4096),'$.mode') ELSE NULL END='research')`:'0';
  return {sql:`(channel=? OR ticketId IS NULL OR ${knownResearch})`,args:[access.channel]};
 }
 function search(caller?: any,{query,limit}: { query?: any; limit?: any; [key: string]: any }={}){
  const access=scope(caller),n=count(limit),visibility=visible(access);
  if(typeof query!=='string'||!query.trim()||query.length>200)throw Error('Search query required (max 200 characters)');
  const pattern=`%${query.trim().replace(/[\\%_]/g,'\\$&')}%`;
  // The MATERIALIZED bound prevents LIKE from turning into a whole-journal scan.
  const rows=db.prepare(`WITH candidates AS MATERIALIZED (
   SELECT ${columns(SEARCH_CHARS)},${taskRef} FROM core_events WHERE ${access.sql} AND length(channel)<=512 ORDER BY seq DESC LIMIT ${SCAN_ROWS}
  ) SELECT seq,id,kind,channel,actorId,at,substr(text,1,512) AS text,textLength FROM candidates
   WHERE ${visibility.sql} AND text LIKE ? ESCAPE '\\' ORDER BY seq DESC LIMIT ?`).all(...access.args,...visibility.args,pattern,n+1);
  return envelope(rows,n,{coverage:{maxRows:SCAN_ROWS,textChars:SEARCH_CHARS,scope:'latest authorized events only'}});
 }
 function read(caller?: any,{kind,id,beforeSeq,limit}: { kind?: any; id?: any; beforeSeq?: any; limit?: any; [key: string]: any }={}){
  const access=scope(caller);reference(id);const before=cursor(beforeSeq),n=count(limit);
  if(kind==='task'){
   if(!coordinator?.knowledge)throw Error('Task context unavailable');
   return coordinator.knowledge(caller,{id,limit:n});
  }
  let rows;
  const visibility=visible(access);
  if(kind==='event')rows=db.prepare(`WITH candidates AS MATERIALIZED (SELECT ${columns(4096)},${taskRef} FROM core_events WHERE id=? AND ${access.sql} AND seq<? AND length(channel)<=512 LIMIT 1) SELECT ${projected} FROM candidates WHERE ${visibility.sql}`).all(id,...access.args,before,...visibility.args);
  else if(kind==='thread'){
   try{platformRoute(id);}catch{throw Error('Context reference not found in caller scope');}
   rows=db.prepare(`WITH candidates AS MATERIALIZED (SELECT ${columns(640)},${taskRef} FROM core_events WHERE channel=? AND ${access.sql} AND seq<? ORDER BY seq DESC LIMIT ${SCAN_ROWS}) SELECT ${projected} FROM candidates WHERE ${visibility.sql} ORDER BY seq DESC LIMIT ?`).all(id,...access.args,before,...visibility.args,n+1);
  }else throw Error('Invalid context reference kind');
  if(!rows.length)throw Error('Context reference not found in caller scope');
  return envelope(rows,kind==='event'?1:n,kind==='thread'?{coverage:{maxRows:SCAN_ROWS,scope:'latest scoped thread events before cursor'}}:{});
 }
 async function overview(caller?: any){
  scope(caller);
  if(!coordinator?.knowledge)return {tasks:[]};
  const result=await coordinator.knowledge(caller,{limit:5});
  const source=Array.isArray(result)?result:result?.tasks??[];
  const tasks=[];
  for(const item of source.slice(0,5)){
   const card={id:String(item.id??'').slice(0,200),state:String(item.state??'').slice(0,40),summary:String(item.summary??'').slice(0,180)};
   while(JSON.stringify({tasks:[...tasks,card]}).length>1900&&card.summary.length)card.summary=card.summary.slice(0,Math.floor(card.summary.length/2));
   if(JSON.stringify({tasks:[...tasks,card]}).length>1900)break;
   tasks.push(card);
  }
  return {tasks};
 }
 return {search,read,overview};
}
