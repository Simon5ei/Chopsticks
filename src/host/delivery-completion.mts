import {redact} from '../core/events.mjs';

// A completed native turn is not an outbound receipt. This module never sends
// or interprets assistant prose; it only records evidence and permits one
// fresh, host-authorized continuation when no send was ever attempted.
export function createDeliveryCompletion({state,store,now=Date.now}: { state?: any; store?: any; now?: any; [key: string]: any }){
 const applicable=(event)=>(event?.kind==='message.received'||(event?.kind==='task.result'&&state.get('result-source',event.id)?.channel===event.channel))&&event.channel?.startsWith('bili:dm:');
 const sameSource=(row?: any,event?: any)=>row.eventId===event.id&&row.channel===event.channel;
 const attempts=(event)=>state.list('delivery-attempt').filter((row)=>sameSource(row,event));
 const receipt=(event)=>store.db.prepare("SELECT id FROM core_events WHERE kind='message.sent' AND channel=? AND json_extract(meta,'$.inReplyTo')=? LIMIT 1").get(event.channel,event.id);
 function source(binding?: any){
  if(!binding?.consumed||binding.interrupted)throw Error('Delivery requires a consumed active source');
  const event=store.get(binding.eventId);
  if(!binding.requestId||!applicable(event)||event.channel!==binding.channel||event.actorId!==binding.actorId)throw Error('Delivery source mismatch');
  return event;
 }
 async function track(binding?: any,perform?: any){
  const event=source(binding);
  if(typeof perform!=='function')throw Error('Delivery operation required');
  if(attempts(event).length)throw Error('Delivery already attempted; do not resend');
  const row={requestId:binding.requestId,eventId:event.id,channel:event.channel,at:now(),status:'attempting'};
  state.put('delivery-attempt',binding.requestId,row);
  try{
   const result=await perform(),persisted=result?.kind==='message.sent'&&typeof result.id==='string'&&store.get(result.id);
   const confirmed=persisted?.kind==='message.sent'&&persisted.channel===event.channel&&persisted.meta?.inReplyTo===event.id;
   state.put('delivery-attempt',binding.requestId,{...row,status:confirmed?'confirmed':'refused',finishedAt:now(),...confirmed?{receiptEventId:persisted.id}:{}});
   return result;
  }catch(error){state.put('delivery-attempt',binding.requestId,{...row,status:'unknown',finishedAt:now()});throw error;}
 }
 function decline(binding?: any,reason?: any){
  const event=source(binding);
  if(typeof reason!=='string'||!reason.trim())throw Error('Decline reason required');
  if(attempts(event).length)throw Error('Delivery already attempted; cannot decline its outcome');
  state.put('delivery-decline',binding.requestId,{requestId:binding.requestId,eventId:event.id,channel:event.channel,reason:redact(reason.trim()).slice(0,1000),at:now()});
  return {status:'declined'};
 }
 function finish(job?: any){
  const requestId=job?.requestId||job?.binding?.requestId;
  if(!requestId)throw Error('Delivery completion requires request identity');
  const event=job.event;
  const done=(status?: any,reason?: any)=>{
   const result={status,...reason?{reason}:{}};
   state.put('delivery-completion',requestId,{...state.get('delivery-completion',requestId),requestId,eventId:event?.id,channel:event?.channel,...result,at:now()});
   return result;
  };
  if(!applicable(event)||job.action?.kind!=='respond')return done('completed');
  const stored=store.get(event.id);
  if(!stored||stored.channel!==event.channel||!applicable(stored))return done('undelivered','source_missing');
  if(receipt(event))return done('delivered','confirmed_receipt');
  if(state.list('delivery-decline').some((row)=>sameSource(row,event)))return done('declined','explicit_decline');
  if(attempts(event).length)return done('undelivered','attempt_without_receipt');
  if(job.binding?.interrupted||state.get('request',requestId)?.interrupted||['interrupted','uncertain','cancelled'].includes(job.status))return done('undelivered','interrupted');
  if(store.db.prepare("SELECT 1 FROM core_events WHERE channel=? AND kind='message.received' AND seq>? LIMIT 1").get(event.channel,stored.seq))return done('superseded','newer_incoming');
  if(Number(job.action.completionRetry)>=1||state.get('delivery-retry',event.id))return done('undelivered','continuation_exhausted');
  // Synchronous state mutation precedes returning retry. A crash can omit a
  // continuation but cannot create duplicate authorizations after restart.
  state.put('delivery-retry',event.id,{requestId,eventId:event.id,channel:event.channel,issuedAt:now()});
  state.put('delivery-completion',requestId,{retryIssued:true});
  return done('retry','no_delivery_attempt');
 }
 return {track,decline,finish};
}
