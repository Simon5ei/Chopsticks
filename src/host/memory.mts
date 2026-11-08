import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {redact} from '../core/events.mjs';
import {platformRoute,publicChannel,sameScope} from '../core/platforms.mjs';

const digest=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function memoryChannel(value?: any){
 const key=String(value??'').replace(/^group:/,'g:').replace(/^private:/,'p:');
 try{if(platformRoute(key).platform==='operator')return null;return key;}catch{return null;}
}
function readJson(file?: any,fallback: Record<string, any>={}){try{if(fs.statSync(file).size>32*1024*1024)return fallback;return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return fallback;}}
export function readRoleMemory(fishHome?: any){
 if(!fishHome)return {characterId:null,records:[]};
 const current=readJson(path.join(fishHome,'characters/current.json'));
 const id=String(current.id??'');
 if(!/^[\w-]{1,100}$/.test(id))return {characterId:null,records:[]};
 const card=readJson(path.join(fishHome,'characters',id,'memory/memory-card.json'));
 return {characterId:id,records:Array.isArray(card.records)?card.records:[]};
}
function provenance(record?: any){
 const channel=memoryChannel(record.conversationKey)||memoryChannel(record.channel)||memoryChannel(record.sourceId)
  || (/^\d+$/.test(String(record.groupId??''))?`g:${record.groupId}`:null);
 if(channel)return channel;
 const platform=String(record.platform??'').toLowerCase(),scope=String(record.scope??'').toLowerCase();
 const type=`${record.source||''} ${record.kind||''}`;
 if(platform==='bili'&&['bili','shared','public'].includes(scope)&&!/(?:\bdm\b|private|私信)/i.test(type))return 'bili:public';
 return null;
}
function visible(record?: any,channel?: any,sharePlatformPrivate: boolean=false){
 if(!record||typeof record!=='object')return false;
 // Import only fish experiences, never operator/dev/system knowledge collections.
 if(/(?:^|[\s_:/-])(?:admin|operator|developer|system|knowledge)(?:$|[\s_:/-])/i.test(`${record.source||''} ${record.kind||''}`))return false;
 const source=provenance(record);if(!source)return false;
 if(publicChannel(channel)&&(record.private===true||record.sensitive===true||record.scope==='private'
  ||/(?:private|\bdm\b|私信)/i.test(`${record.source||''} ${record.kind||''}`)))return false;
 if(source===channel)return true;
 if(sharePlatformPrivate&&sameScope(source,channel)&&platformRoute(channel).scope.startsWith('private:'))return true;
 const known=['qq','bili','shared','public','group'].includes(String(record.scope??''));
 return known&&publicChannel(channel)&&publicChannel(source);
}
function body(record?: any){
 return [record.title,record.text,record.detail,Array.isArray(record.tags)?record.tags.join(' '):'',record.botReply?`我当时说：${record.botReply}`:''].filter((v)=>typeof v==='string'&&v).join('\n');
}
export function createMemory({fishHome,state,store,sharePlatformPrivate=false}: { fishHome?: any; state?: any; store?: any; sharePlatformPrivate?: boolean; [key: string]: any }={}){
 if(!state?.list||!state?.put||!state?.get)throw new Error('Memory requires host state');
 function search({query='',channel,limit=12}: { query?: string; channel?: any; limit?: number; [key: string]: any }={}){
  channel=memoryChannel(channel);if(!channel)throw new Error('Invalid memory channel');
  const current=readRoleMemory(fishHome);
  const own=state.list('memory').filter((r)=>!r.characterId||r.characterId===current.characterId);
  const migrated=state.list('social-memory').filter((r)=>!r.characterId||r.characterId===current.characterId).flatMap((r)=>Array.isArray(r.records)?r.records:[])
   .filter((r)=>!r.characterId||r.characterId===current.characterId);
  const needle=String(query).trim().toLocaleLowerCase().slice(0,500),terms=needle.split(/\s+/).filter(Boolean);
  const matches=[...current.records,...own,...migrated].filter((record)=>visible(record,channel,sharePlatformPrivate)).map((record)=>({record,text:body(record)}))
   .filter(({text}: { text?: any; [key: string]: any })=>!terms.length||terms.every((term)=>text.toLocaleLowerCase().includes(term)));
  const count=Math.max(1,Math.min(30,Math.floor(Number(limit)||12))),seen=new Set<any>(),records=[];
  for(const {record,text} of matches){
   const sourceChannel=provenance(record),id=String(record.id||digest([sourceChannel,text]));
   const key=`${sourceChannel}:${id}`;if(seen.has(key))continue;seen.add(key);
   const first=needle?text.toLocaleLowerCase().indexOf(terms[0]):0,start=Math.max(0,first-120);
   records.push({id:redact(id),channel:sourceChannel,source:redact(String(record.source||'fish-memory')).slice(0,80),sourceId:redact(String(record.sourceId||record.id||'')).slice(0,200),
    title:redact(String(record.title||'')).slice(0,120),text:redact(text.slice(start,start+800)).slice(0,800),at:record.createdAt||record.at||null,isSelf:record.isSelf===true});
   if(records.length>=count)break;
  }
  return {records,notice:'带来源的记忆记录。'};
 }
 function remember({channel,text,id}: { channel?: any; text?: any; id?: any; [key: string]: any }={}){
  channel=memoryChannel(channel);if(!channel)throw new Error('Invalid memory channel');
  if(typeof text!=='string'||!text.trim()||text.length>4000)throw new Error('Memory text must be 1–4000 characters');
  if(typeof id!=='string'||!id||id.length>256)throw new Error('Stable memory id required');
  const characterId=readRoleMemory(fishHome).characterId,key=digest([characterId,channel,id]),clean=redact(text.trim());
  const prior=state.get('memory',key);if(prior){if(prior.text!==clean)throw new Error('Memory id conflict');return prior;}
  const route=platformRoute(channel),platform=route.platform;
  const record={id,channel,conversationKey:channel,scope:sharePlatformPrivate?(route.scope==='public'?'public':route.scope):platform,source:'fish-memory',sourceId:id,
   platform,text:clean,private:route.scope!=='public',characterId,createdAt:new Date().toISOString()};
  state.put('memory',key,record);return record;
 }
 return {search,remember};
}
