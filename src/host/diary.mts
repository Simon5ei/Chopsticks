import { randomUUID } from 'node:crypto';
import {platformRoute} from '../core/platforms.mjs';
const SCOPES = ['public','qzone:friends','private:qq','private:bili','private:douyin','private:heybox','private:wechat'];
const scopeOf = (c) => {try{return platformRoute(c).scope;}catch{return null;}};
function authorize(scope?: any, caller?: any) { if (!SCOPES.includes(scope) || !Array.isArray(caller?.scopes) || !caller.scopes.includes(scope)) throw new Error('Diary scope not authorized'); }
function validDate(date?: any) { return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date; }
export function createDiary({store, now=Date.now, timezone='Asia/Shanghai'}: { store?: any; now?: any; timezone?: string; [key: string]: any }) {
 if (!store?.db || typeof store.get !== 'function') throw new TypeError('Diary requires event store');
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS life_diary (id TEXT PRIMARY KEY, scope TEXT NOT NULL, date TEXT NOT NULL, revision INTEGER NOT NULL, source_ids TEXT NOT NULL, text TEXT NOT NULL, feelings TEXT, questions TEXT, next TEXT, created_at INTEGER NOT NULL, UNIQUE(scope,date,revision)); CREATE INDEX IF NOT EXISTS life_diary_scope_date ON life_diary(scope,date,revision);`);
 const decode=(r)=>r && ({id:r.id,scope:r.scope,date:r.date,revision:r.revision,sourceEventIds:JSON.parse(r.source_ids),text:r.text,...(r.feelings!==null?{feelings:JSON.parse(r.feelings)}:{}),...(r.questions!==null?{questions:JSON.parse(r.questions)}:{}),...(r.next!==null?{next:JSON.parse(r.next)}:{}),createdAt:r.created_at});
 function write(input?: any,caller?: any) {
  const {scope,date,sourceEventIds,text,feelings,questions,next,revision}=input??{}; authorize(scope,caller);
  if(!validDate(date)||!Array.isArray(sourceEventIds)||!sourceEventIds.length||new Set<any>(sourceEventIds).size!==sourceEventIds.length||typeof text!=='string'||!text.trim()||text.length>100000) throw new Error('Invalid diary entry');
  for(const id of sourceEventIds){const e=typeof id==='string'&&store.get(id);if(!e || scopeOf(e.channel)!==scope || !(['message.received','message.sent'].includes(e.kind) || (e.kind==='task.result' && e.meta?.experienced===true))) throw new Error('Diary source is unknown, outside scope, or not an occurred experience');}
  const existing=db.prepare('SELECT MAX(revision) AS revision FROM life_diary WHERE scope=? AND date=?').get(scope,date).revision||0;
  if((existing && revision!==existing+1)||(!existing && revision!=null && revision!==1)) throw new Error('Explicit next revision required');
  const entryId=randomUUID(), rev=existing+1;
  const serialize=(v)=>v===undefined?null:JSON.stringify(v);
  db.prepare('INSERT INTO life_diary VALUES(?,?,?,?,?,?,?,?,?,?)').run(entryId,scope,date,rev,JSON.stringify(sourceEventIds),text,serialize(feelings),serialize(questions),serialize(next),now());
  return decode(db.prepare('SELECT * FROM life_diary WHERE id=?').get(entryId));
 }
 function read({id,scope,date}: { id?: any; scope?: any; date?: any; [key: string]: any }={},caller?: any){authorize(scope,caller);if(id)return decode(db.prepare('SELECT * FROM life_diary WHERE id=? AND scope=?').get(id,scope));if(!validDate(date))throw new Error('Valid date required');return decode(db.prepare('SELECT * FROM life_diary WHERE scope=? AND date=? ORDER BY revision DESC LIMIT 1').get(scope,date));}
 function search({scope,query,limit=20}: { scope?: any; query?: any; limit?: number; [key: string]: any }={},caller?: any){authorize(scope,caller);if(typeof query!=='string'||!query.trim()||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Invalid diary search');const rows=db.prepare('SELECT * FROM life_diary WHERE scope=? AND revision=(SELECT MAX(d.revision) FROM life_diary d WHERE d.scope=life_diary.scope AND d.date=life_diary.date) ORDER BY date DESC').all(scope);return rows.map(decode).filter((r)=>JSON.stringify([r.text,r.feelings,r.questions,r.next]).includes(query)).slice(0,limit);}
 function due({at=now(),scopes=SCOPES}: { at?: any; scopes?: any; [key: string]: any }={}){if(!Array.isArray(scopes)||scopes.some((s)=>!SCOPES.includes(s)))throw new Error('Invalid diary scopes');const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map((p)=>[p.type,p.value]));if(Number(parts.hour)*60+Number(parts.minute)<1410)return [];const date=`${parts.year}-${parts.month}-${parts.day}`;return [...new Set<any>(scopes)].filter((scope)=>!db.prepare('SELECT 1 FROM life_diary WHERE scope=? AND date=? LIMIT 1').get(scope,date)).map((scope)=>({scope,date}));}
 return {write,read,search,due};
}
