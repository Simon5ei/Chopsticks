import {createHash} from 'node:crypto';
export function createContentRounds({state,store,onEvent,now=Date.now,maxQueued=24}){
 async function queue({caller,platform,itemId}){
  if(caller.domain!=='surf'||caller.audience==='dm'||!caller.consumed||typeof itemId!=='string'||!itemId||itemId.length>256||!/^[\w:-]+$/.test(itemId))throw Error('Consumed surfing source required');
  const id=`surf-next:${createHash('sha256').update(JSON.stringify([platform,caller.requestId,itemId])).digest('hex')}`;
  if(!state.get('content-next',id)){
   const day=new Date(now()).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}),key=`${platform}:${day}`,budget=state.get('content-continuations',key)||{count:0};
   if(budget.count>=maxQueued)return {allowed:false,queued:false,reason:'daily_continuation_limit'};
   state.put('content-next',id,{itemId});state.put('content-continuations',key,{count:budget.count+1});
   await onEvent({id,kind:'timer',channel:caller.channel,actorId:'fish',text:`待阅读内容：${itemId}`,meta:{platform,itemId,sourceTargetId:itemId}});
  }
  return {allowed:false,queued:true,nextEventId:id};
 }
 return {async admit({caller,platform,itemId}){
  if(caller.domain!=='surf'||caller.audience==='dm'||!caller.consumed||typeof itemId!=='string'||!itemId||itemId.length>256)throw Error('Consumed surfing source required');
  const source=store.get(caller.eventId),expected=source?.meta?.sourceTargetId||source?.meta?.itemId||source?.meta?.bili?.bvid;
  let current=state.get('content-round',caller.requestId);if(!current){current={itemId:expected||itemId};state.put('content-round',caller.requestId,current);}
  if(current.itemId===itemId)return {allowed:true,itemId};
  return queue({caller,platform,itemId});
 },async next({caller,itemId}){
  const source=store.get(caller.eventId),current=state.get('content-round',caller.requestId)?.itemId||source?.meta?.sourceTargetId||source?.meta?.itemId||source?.meta?.bili?.bvid;
  if(current===itemId)return {queued:false,reason:'already_current_item'};
  return queue({caller,platform:caller.platform,itemId});
 }};
}
