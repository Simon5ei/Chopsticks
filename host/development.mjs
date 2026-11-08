/** Durable capabilities are created only from canonical, consumed QQ input. */
export function createDevelopment({config,state,store,getCoordinator,getCaller}){
 const controllers=new Map();
 function ownerSource(sessionId){
  if(config.development?.enabled!==true)throw Error('Administrator development is disabled');
  const bound=state.binding(sessionId),event=bound&&store.get(bound.eventId),owner=config.qq?.ownerId;
  if(typeof owner!=='string'||!owner||!bound?.consumed||!event||event.kind!=='message.received'||!/^([gp]):/.test(event.channel)||event.channel!==bound.channel||event.actorId!==owner||bound.actorId!==event.actorId)throw Error('Canonical consumed QQ administrator owner event required');
  return event;
 }
 function grantFor(ticketId){const grant=state.get('development-grant',ticketId);if(!grant||grant.revoked||config.development?.enabled!==true||grant.ownerId!==config.qq?.ownerId)throw Error('No active administrator owner grant');return grant;}
 function authorize(sessionId){const worker=getCoordinator().getWorkerContext(sessionId);if(!worker?.active)throw Error('Development worker inactive');const grant=grantFor(worker.ticketId);if(worker.chatKey!==grant.channel)throw Error('Development worker source mismatch');const original=store.get(grant.eventId);if(!original||original.kind!=='message.received'||original.actorId!==grant.ownerId||original.channel!==grant.channel||original.text!==grant.originalRequest)throw Error('Original administrator event mismatch');return grant;}
 function control(sessionId,ticketId){const grant=state.get('development-grant',ticketId);if(!grant)return;const event=ownerSource(sessionId);if(event.actorId!==grant.ownerId||event.channel!==grant.channel)throw Error('Task belongs to original administrator owner');return grant;}
 async function develop(sessionId,{prompt,requestId}){
  const event=ownerSource(sessionId);
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>5000)throw Error('Invalid development prompt');
  if(event.text.length>6000)throw Error('Administrator request too long; split into explicit requests');
  const task=await getCoordinator().submit((getCaller?getCaller(sessionId):{sessionId,characterId:'fish',chatKey:event.channel,role:'qq'}), {requestId,development:true,prompt:`管理员要求：\n${event.text}\n任务摘要：\n${prompt}`});
  const previous=state.get('development-grant',task.id);
  if(previous){if(previous.eventId!==event.id||previous.ownerId!==event.actorId)throw Error('Development request source conflict');return task;}
  const grant={ticketId:task.id,eventId:event.id,ownerId:event.actorId,channel:event.channel,requestId,originalRequest:event.text,createdAt:new Date().toISOString()};
  state.put('development-grant',task.id,grant);state.put('task-source',task.id,{...state.get('task-source',task.id),eventId:event.id,channel:event.channel,requestId});return task;
 }
 function revoke(ticketId){const grant=state.get('development-grant',ticketId);if(grant&&!grant.revoked)state.put('development-grant',ticketId,{...grant,revoked:true});controllers.get(ticketId)?.abort();}
 function signalFor(ticketId){let controller=controllers.get(ticketId);if(!controller){controller=new AbortController();controllers.set(ticketId,controller);}return controller.signal;}
 async function follow(sessionId,ticketId,prompt,perform){
  const grant=control(sessionId,ticketId);if(!grant)return perform(prompt);
  const event=ownerSource(sessionId);
  if(event.text.length>6000||typeof prompt!=='string'||prompt.length>3000)throw Error('Development follow-up too long');
  const result=await perform(`管理员追加要求：\n${event.text}\n补充摘要：\n${prompt}`);
  const current=grantFor(ticketId),requests=current.authorizedRequests||[];
  if(!requests.some(r=>r.eventId===event.id))state.put('development-grant',ticketId,{...current,authorizedRequests:[...requests,{eventId:event.id,ownerId:event.actorId,channel:event.channel,text:event.text}]});
  return result;
 }
 function resolveWorker(sessionId){try{const grant=authorize(sessionId);const requests=grant.authorizedRequests||[];for(const request of requests){const event=store.get(request.eventId);if(!event||event.kind!=='message.received'||event.actorId!==grant.ownerId||event.channel!==grant.channel||event.text!==request.text)throw Error('Invalid owner follow-up source');}return {mode:'development',...grant,originalRequest:[grant.originalRequest,...requests.map(r=>`管理员追加要求（${r.eventId}）：\n${r.text}`)].join('\n\n')};}catch{return {mode:'research'};}}
 return {ownerSource,authorize,control,develop,follow,revoke,signalFor,resolveWorker,close(){for(const controller of controllers.values())controller.abort();}};
}
