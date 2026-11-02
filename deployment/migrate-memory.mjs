import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createEventStore,redact} from '../core/events.mjs';
import {createHostState} from '../host/state.mjs';
import {memoryChannel,readRoleMemory} from '../host/memory.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function json(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
/** Offline additive import. Source files are never edited or deleted. */
export function migrateMemory({config={},runtimeStateDir,oldSocialFile,store,state}={}){
 const owned=!store;if(owned){store=createEventStore({stateDir:runtimeStateDir||config.stateDir});state=createHostState(store);}
 const stats={conversations:0,eventsImported:0,eventsExisting:0,messagesSkipped:0,memoryRecords:0,roleRecords:0};
 try{
  const old=json(oldSocialFile),role=readRoleMemory(config.fishHome);stats.roleRecords=role.records.length;
  for(const [oldKey,conversation] of Object.entries(old.conversations||{})){
   const channel=memoryChannel(oldKey);if(!channel||!conversation||typeof conversation!=='object')continue;stats.conversations++;
   for(const message of Array.isArray(conversation.recentMessages)?conversation.recentMessages:[]){
    if(!message||typeof message!=='object'){stats.messagesSkipped++;continue;}
    const text=String(message.text||message.plain||'').slice(0,100000),messageId=message.messageId==null?'':String(message.messageId);
    if(!text||(message.isSelf&&!messageId)){stats.messagesSkipped++;continue;}
    const id=messageId?`qq:${channel}:${messageId}`:`migration:qq:${hash([channel,message.userId,message.time,text])}`;
    if(store.get(id)){stats.eventsExisting++;continue;}
    let at=Number(message.time);if(!Number.isFinite(at))at=Date.parse(message.time);if(!Number.isFinite(at))at=0;if(at>0&&at<1000000000000)at*=1000;
    if(!Number.isFinite(new Date(at).getTime()))at=0;
    store.append({id,kind:message.isSelf?'message.sent':'message.received',channel,
     actorId:message.isSelf?String(config.qq?.selfId||config.selfId||'self'):String(message.userId||'unknown'),text,at,
     meta:{messageId:messageId||null,migrated:true,route:false,isSelf:message.isSelf===true,source:'social-v2',confirmed:message.isSelf===true}});
    stats.eventsImported++;
   }
   const records=[];
   for(const field of ['activeTopics','pendingThoughts','memberImpressions']){
    const value=conversation[field];const items=Array.isArray(value)?value:value&&typeof value==='object'?Object.entries(value).map(([name,item])=>typeof item==='object'?{name,...item}:{name,text:String(item)}):[];
    for(const item of items){
     const itemText=typeof item==='string'?item:JSON.stringify(item);if(!itemText)continue;
     const text=redact(itemText).slice(0,4000),id=`social:${hash([channel,field,text])}`;
     records.push({id,source:'social-v2',sourceId:id,scope:'qq',platform:'qq',channel,conversationKey:channel,title:field,text,
      private:channel.startsWith('p:')||item?.private===true,sensitive:item?.sensitive===true,characterId:role.characterId});
    }
   }
   const prior=state.get('social-memory',channel),existing=new Map((prior?.records||[]).map(record=>[record.id,record]));
   for(const record of records)existing.set(record.id,record);
   state.put('social-memory',channel,{channel,characterId:role.characterId,records:[...existing.values()]});stats.memoryRecords+=records.length;
  }
  return stats;
 }finally{if(owned)store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const [configFile,runtimeStateDir,oldSocialFile]=process.argv.slice(2);
  if(!configFile||!runtimeStateDir||!oldSocialFile)throw new Error('arguments');
  console.log(JSON.stringify(migrateMemory({config:json(configFile),runtimeStateDir,oldSocialFile})));
 }catch{console.error(JSON.stringify({failed:1}));process.exitCode=1;}
}
