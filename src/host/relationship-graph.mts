import {platformRoute} from '../core/platforms.mjs';

// Source selection is enforced before inference and again when projecting old reports.
export const socialSource=(e)=>Boolean(e&&['message.received','message.sent'].includes(e.kind)&&/^(?:[pg]:\d+|(?:bili|douyin|heybox):dm:\d+)$/.test(e.channel));
const platform=(e)=>/^[pg]:/.test(e.channel)?'qq':e.channel.split(':')[0];
const identity=(actor?: any,p?: any)=>actor==='fish'?'fish':`${p}:${actor}`;
const VERSION=2;
const empty=()=>({version:VERSION,revision:0,updatedAt:null,nodes:[],edges:[],truncated:false});

export function createRelationshipGraph({state,store,now=Date.now,clean=(x)=>x,maxNodes=2000,maxEdges=6000}: { state?: any; store?: any; now?: any; clean?: (...args: any[]) => any; maxNodes?: number; maxEdges?: number; [key: string]: any }){
 const get=()=>{const saved=state.get('relationship-graph','current');return saved?.version===VERSION?saved:empty();};
 function accept(report?: any){
  if(report?.kind!=='social'||typeof report.id!=='string'||state.get('relationship-applied',report.id)?.version===VERSION)return false;
  const sources=new Map<string, {id: string; actorId: string; kind: string; channel: string; meta?: any}>((report.sourceEventIds||[]).slice(0,20).map((id)=>[id,store.get(id)]));
  const allowed=(e)=>socialSource(e)&&platformRoute(e.channel).scope===report.scope;
  const valid=[...sources.values()].filter(allowed);
  if(!valid.length)return false;
  const ownIds=new Set<any>(valid.filter((e: any) =>e.kind==='message.sent').map((e: any) =>identity(e.actorId,platform(e))));
  const graph=structuredClone(get()),nodes=new Map(graph.nodes.map((n)=>[n.id,n])),edges=new Map(graph.edges.map((e)=>[e.id,e]));
  const at=Number.isFinite(report.createdAt)?report.createdAt:now();
  function node(actor?: any,p?: any,e?: any){
   if(typeof actor!=='string'||!actor||actor.length>128)return null;
   if(ownIds.has(identity(actor,p)))actor='fish';
   const id=identity(actor,p),previous: any=nodes.get(id);
   if(!previous&&nodes.size>=maxNodes){graph.truncated=true;return null;}
   const label=actor==='fish'?'大肥鱼':String(clean(e?.meta?.senderName||e?.meta?.nickname||actor)).slice(0,80);
   if(!previous)nodes.set(id,{id,actorId:actor,platform:actor==='fish'?'fish':p,label,lastAt:at});
   else if(at>=previous.lastAt){previous.lastAt=at;if(label!==actor)previous.label=label;}
   return id;
  }
  for(const e of valid)node(e.actorId,platform(e),e);
  for(const r of (report.relationships||[]).slice(0,20)){
   if(!['observed','hypothesis'].includes(r.certainty)||r.from===r.to||typeof r.relation!=='string'||!r.relation.trim())continue;
   const ids=r.sourceEventIds;if(!Array.isArray(ids)||!ids.length||ids.length>20)continue;
   const evidence=ids.map((id)=>sources.get(id));if(evidence.some((e)=>!allowed(e)))continue;
   const platforms=new Set<any>(evidence.map(platform));if(platforms.size!==1)continue;
   const p=platform(evidence[0]),actors=new Set<any>(['fish',...evidence.map((e: any) =>e.actorId)]);
   if(!actors.has(r.from)||!actors.has(r.to))continue;
   const endpoints=[node(r.from,p,evidence.find((e: any) =>e.actorId===r.from)),node(r.to,p,evidence.find((e: any) =>e.actorId===r.to))].sort();
   if(endpoints.some((x)=>!x)||endpoints[0]===endpoints[1])continue;
   const id=JSON.stringify(endpoints);let edge: any=edges.get(id);
   if(!edge){if(edges.size>=maxEdges){graph.truncated=true;continue;}edge={id,source:endpoints[0],target:endpoints[1],platform:p,observations:[],lastAt:at};edges.set(id,edge);}
   edge.lastAt=Math.max(edge.lastAt,at);
   edge.observations.push({reportId:report.id,relation:String(clean(r.relation)).slice(0,600),certainty:r.certainty,at,evidence:evidence.map((e: any) =>({id:e.id,channel:e.channel,at:e.at}))});
   edge.observations.sort((a?: any,b?: any)=>b.at-a.at);edge.observations=edge.observations.slice(0,8);
   edge.certainty=edge.observations.some((o)=>o.certainty==='observed')?'observed':'hypothesis';
  }
  Object.assign(graph,{revision:graph.revision+1,updatedAt:now(),nodes:[...nodes.values()],edges:[...edges.values()]});
  // Keep both database writes and management responses bounded, including evidence.
  let bytes=Buffer.byteLength(JSON.stringify(graph));
  while(bytes>4*1024*1024&&graph.edges.length){graph.truncated=true;graph.edges.sort((a?: any,b?: any)=>b.lastAt-a.lastAt);graph.edges.length=Math.floor(graph.edges.length*.7);bytes=Buffer.byteLength(JSON.stringify(graph));}
  const save=()=>{state.put('relationship-graph','current',graph);state.put('relationship-applied',report.id,{version:VERSION,revision:graph.revision});};
  if(store.db){store.db.exec('SAVEPOINT relationship_projection');try{save();store.db.exec('RELEASE relationship_projection');}catch(e){store.db.exec('ROLLBACK TO relationship_projection');store.db.exec('RELEASE relationship_projection');throw e;}}else save();
  return true;
 }
 function sync(){
  if(!store.db)return;
  // Resume bounded batches so older social reports cannot be crowded out by other kinds.
  const prior=state.get('relationship-backfill','cursor'),cursor=prior?.version===VERSION?prior.rowid:0;
  const rows=store.db.prepare("SELECT rowid,CASE WHEN length(value)<=30000 THEN value END AS value FROM host_kv WHERE kind='evolution-report' AND rowid>? ORDER BY rowid LIMIT 200").all(cursor);
  for(const row of rows)if(row.value)accept(JSON.parse(row.value));
  if(rows.length)state.put('relationship-backfill','cursor',{version:VERSION,rowid:rows.at(-1).rowid});
 }
 return {get,accept,sync};
}
