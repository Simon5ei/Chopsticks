import type {DatabaseSync} from 'node:sqlite';
import {redact} from '../core/events.mjs';
import {platformRoute} from '../core/platforms.mjs';

export const contentPlatforms = ['bili','heybox','qzone','douyin'] as const;
type Platform = typeof contentPlatforms[number];
type Scope = 'public' | 'qzone:friends';
type EvidenceKind = 'metadata' | 'description' | 'body' | 'body_excerpt' | 'subtitles' | 'frames' | 'comments' | 'images';
type Evidence = {kind: EvidenceKind; text: string; sourceEventId?: string};
type Entry = {
 platform: Platform; channel: string; scope: Scope; day: string; itemId: string; eventId: string;
 status: 'open' | 'completed' | 'interrupted'; evidence: Evidence[]; missing: string[]; attempts: string[];
 summary?: string; reaction?: string; next?: string; skip?: string;
};
type Config = {platforms?: Partial<Record<Platform,boolean>>; report?: 'off' | 'brief' | 'full'};
const dateFormat = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const timeFormat = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const dayAt = (time: number) => dateFormat.format(time);
const evidenceKinds: EvidenceKind[] = ['metadata','description','body','body_excerpt','subtitles','frames','comments','images'];
const safeText = (value: string, limit: number) => redact(value.slice(0,limit));
const validScope = (scope: string): scope is Scope => scope==='public'||scope==='qzone:friends';
const validDate = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10)===day;
const substantive = (entry: Entry) => entry.evidence.some(({kind}) =>
 kind==='body'||kind==='subtitles'||kind==='frames'||kind==='images');

export function createContentObservations({db,config,now=Date.now}: {db:DatabaseSync;config:Config;now?:()=>number}) {
 const enabled = new Set(contentPlatforms.filter(platform=>config.platforms?.[platform]===true));
 const reportLevel = config.report==='off'||config.report==='full'?config.report:'brief';
 db.exec(`
  CREATE TABLE IF NOT EXISTS content_observations (
   request_id TEXT PRIMARY KEY, scope TEXT NOT NULL, day TEXT NOT NULL, started_at INTEGER NOT NULL, value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS content_observations_date ON content_observations(scope,day,started_at,request_id);
  CREATE TABLE IF NOT EXISTS content_recaps (
   scope TEXT NOT NULL, day TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,day)
  );
 `);
 const get = db.prepare('SELECT value FROM content_observations WHERE request_id=?');
 const insert = db.prepare('INSERT OR IGNORE INTO content_observations VALUES(?,?,?,?,?)');
 const update = db.prepare('UPDATE content_observations SET value=? WHERE request_id=?');
 const rows = db.prepare('SELECT value FROM content_observations WHERE scope=? AND day=? ORDER BY started_at,request_id LIMIT 161');
 const writeReport = db.prepare('INSERT INTO content_recaps VALUES(?,?,?) ON CONFLICT(scope,day) DO UPDATE SET value=excluded.value WHERE value<>excluded.value');
 let archivedDay: string|undefined;
 const save = (id:string,entry:Entry) => {
  archivedDay=undefined;
  update.run(JSON.stringify(entry),id);
 };
 const load = (id: string): Entry|undefined => {
  const row=get.get(id);
  return row?JSON.parse(String(row.value)):undefined;
 };
 function active(caller: any) {
  if(caller?.consumed!==true)return;
  const entry=load(caller.requestId);
  if(entry?.status==='open'&&entry.channel===caller.channel&&entry.platform===caller.platform&&
     entry.eventId===caller.eventId&&entry.scope===caller.scope)return entry;
 }
 function target(event: any) {
  if(event?.kind!=='timer'||typeof event.meta?.itemId!=='string'||!event.meta.itemId||
     event.meta.itemId.length>256||event.meta.sourceTargetId!==event.meta.itemId)return;
  const route=platformRoute(event);
  if(route.activity==='browse'&&enabled.has(route.platform)&&validScope(route.scope))return {route,itemId:event.meta.itemId};
 }
 function start(caller: any,event: any) {
  const source=target(event);
  if(!source||caller.eventId!==event.id||caller.channel!==event.channel||typeof caller.requestId!=='string')return false;
  const {route,itemId}=source;
  const entry: Entry = {platform:route.platform,channel:event.channel,scope:route.scope,day:dayAt(now()),itemId,
   eventId:event.id,status:'open',evidence:[],missing:[],attempts:[]};
  if(insert.run(caller.requestId,entry.scope,entry.day,now(),JSON.stringify(entry)).changes)archivedDay=undefined;
  return true;
 }
 function reserve(caller: any,itemId: string,kind: string) {
  const entry=active(caller);
  if(!entry||entry.itemId!==itemId||(kind!=='discovery'&&!evidenceKinds.includes(kind as EvidenceKind))||
     entry.attempts.includes(kind)||entry.attempts.length>=4)return false;
  entry.attempts.push(kind);
  save(caller.requestId,entry);
  return true;
 }
 function observe(caller: any,itemId: string,attempt: string,evidence: Evidence|null) {
  const entry=active(caller);
  if(!entry||entry.itemId!==itemId||!evidenceKinds.includes(attempt as EvidenceKind))return false;
  if(evidence&&evidenceKinds.includes(evidence.kind)&&typeof evidence.text==='string'&&evidence.text.trim()){
   const normalized: Evidence={kind:evidence.kind,text:safeText(evidence.text,1800),
    ...evidence.sourceEventId?{sourceEventId:evidence.sourceEventId}:{}};
   const previous=entry.evidence.findIndex(e=>e.kind===normalized.kind);
   if(previous<0)entry.evidence.push(normalized);
   else if(entry.evidence[previous].text!==normalized.text)entry.evidence[previous]=normalized;
   entry.missing=entry.missing.filter(kind=>kind!==attempt);
  }else if(!entry.evidence.some(e=>e.kind===attempt)&&!entry.missing.includes(attempt))entry.missing.push(attempt);
  save(caller.requestId,entry);
  return true;
 }
 function reflect(caller: any,input: {summary?:string;reaction?:string;next?:string;skip?:string}) {
  const entry=active(caller);
  if(!entry)throw Error('An active content browsing round is required');
  const values = [input.summary,input.reaction,input.next,input.skip];
  if(!values.some(value=>typeof value==='string'&&value.trim())||
     values.some(value=>value!==undefined&&(typeof value!=='string'||value.length>600)))throw Error('A brief summary, reaction, next idea, or skip reason is required');
  if(input.summary?.trim()&&!substantive(entry))throw Error('A summary requires substantive source evidence');
  if(input.skip&&substantive(entry))throw Error('Material already read cannot be marked skipped');
  for(const key of ['summary','reaction','next','skip'] as const)if(input[key]?.trim())entry[key]=safeText(input[key].trim(),600);
  save(caller.requestId,entry);
  return {saved:true,itemId:entry.itemId,evidence:entry.evidence.map(e=>e.kind),missing:entry.missing};
 }
 function finish(requestId: string,interrupted=false) {
  const entry=load(requestId);
  if(entry?.status!=='open')return;
  entry.status=interrupted?'interrupted':'completed';
  save(requestId,entry);
 }
 function recap(scope: string,day=dayAt(now())) {
  if(!validScope(scope)||!validDate(day))throw Error('Invalid content recap scope or date');
  const counts={read:0,partial:0,skipped:0,unfinished:0};
  const items=[];
  const selected=reportLevel==='off'?[]:rows.all(scope,day);
  for(const row of selected.slice(0,160)){
   const entry: Entry=JSON.parse(String(row.value));
   const outcome=entry.status!=='completed'?'unfinished':substantive(entry)?'read':
    entry.skip?'skipped':entry.evidence.length||entry.missing.length?'partial':'unfinished';
   counts[outcome]++;
   items.push({platform:entry.platform,itemId:entry.itemId,eventId:entry.eventId,outcome,
    evidence:entry.evidence.map(e=>reportLevel==='full'?e:{...e,text:e.text.slice(0,180)}),
    missing:entry.missing,...entry.summary?{summary:entry.summary}:{},...entry.reaction?{reaction:entry.reaction}: {},
    ...entry.next?{next:entry.next}:{},...entry.skip?{skip:entry.skip}:{}});
  }
  return {scope,day,level:reportLevel,counts,items,truncated:selected.length>160};
 }
 function archiveDue() {
  if(reportLevel==='off')return;
  const time=now(),day=timeFormat.format(time)>='23:30'?dayAt(time):dayAt(time-86400000);
  if(day===archivedDay)return;
  for(const scope of ['public','qzone:friends']){
   const report=recap(scope,day);
   if(report.items.length)writeReport.run(scope,day,JSON.stringify(report));
  }
  archivedDay=day;
 }
 return {start,active,reserve,observe,reflect,finish,recap,archiveDue,manages:(event:any)=>Boolean(target(event))};
}

