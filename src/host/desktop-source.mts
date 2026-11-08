// Native owner and trusted in-process prompts omit source.principal in DSH.
// This context is only for the physical desktop lease, never platform writes.
export function createNativeDesktopSource({eligible,operatorSessionId,knownRequest,release}: { eligible?: any; operatorSessionId?: any; knownRequest?: any; release?: any; [key: string]: any }){
 const designated=typeof operatorSessionId==='string'&&/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(operatorSessionId)?operatorSessionId:undefined;
 const allowed=(id)=>eligible(id)||(designated!==undefined&&id===designated);
 const active=new Map();let closed=false;
 const clear=(id)=>{const row=active.get(id);if(row?.caller)release(row.caller);active.delete(id);};
 return {
  event(id?: any,event?: any){
   if(closed||!id||!event)return;
   if(event.type==='turn/start'){
    clear(id);
    if(allowed(id)&&Number.isSafeInteger(event.data?.turn)&&event.data.turn>0&&active.size<64)active.set(id,{turn:event.data.turn});
    return;
   }
   const row=active.get(id);if(!row)return;
   if(event.type==='turn/end'){if(event.data?.turn===row.turn)clear(id);return;}
   if(event.type!=='user/message')return;
   const source=event.data?.message?.source??event.data?.source;
   if(source?.kind!=='user')return;
   if(row.caller){release(row.caller);delete row.caller;}
   if(!allowed(id)||source.principal!==undefined||typeof source.rpcId!=='string'||!source.rpcId||source.rpcId.length>512||knownRequest(source.rpcId))return;
   row.caller={sessionId:id,requestId:source.rpcId,consumed:true};
  },
  caller(id?: any){return active.get(id)?.caller;},
  close(){closed=true;for(const id of active.keys())clear(id);},
 };
}
