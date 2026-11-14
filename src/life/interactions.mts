import {inboxFailureCode} from '../host/inbox-failure.mjs';
import {createHash} from 'node:crypto';
const hash=(x)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function platformContext(item?: any){
 const c=item?.context||{},out: Record<string, any>={};
 for(const key of ['conversationId','secUid'])if(typeof c[key]==='string'&&c[key].length<=256&&/^[\w:-]+$/.test(c[key]))out[key]=c[key];
 return out;
}
export function createInteractionPoller({owners,config,state,store,emit,now,signal}: { owners?: any; config?: any; state?: any; store?: any; emit?: any; now?: any; signal?: any; [key: string]: any }){
 let polling;
 const valid=(result)=>Array.isArray(result?.items)&&!(result.warnings?.length);
 async function run(){
  for(const name of ['heybox','douyin','qzone'])for(const action of ['inbox','notifications']){
   const adapter=owners[name];if(!adapter?.capabilities?.[action]||signal.aborted)continue;
   let discovered=[];
   if(name==='heybox'&&action==='inbox'){
    const previous=state.get('life-discovered-peers','heybox')||{peers:[]};let cursor=previous.cursor,discoveryComplete=false;
    try{for(let page=0;page<10;page++){
     const result=await adapter.read({action:'inbox',limit:50,...cursor?{cursor}:{},signal});signal.throwIfAborted();if(!valid(result)||!Array.isArray(result.peers))throw Error('discovery unavailable');
     discovered.push(...result.peers.map(String).filter((p)=>/^\d+$/.test(p)));
     if(!result.truncated){cursor=undefined;discoveryComplete=true;break;}
     if(typeof result.cursor!=='string'||result.cursor===cursor)break;cursor=result.cursor;
    }
    state.put('life-discovered-peers','heybox',{peers:[...new Set<any>([...previous.peers,...discovered])],cursor,at:now()});
    state.put('health','life-inbox:heybox:discovery',{state:discoveryComplete?'ready':'partial',at:now(),discovered:discovered.length});
    }catch{state.put('health','life-inbox:heybox:discovery',{state:'error',at:now()});}
   }
   const peers=name==='heybox'&&action==='inbox'?[...new Set<any>([...discovered,...(state.get('life-discovered-peers','heybox')?.peers||[]),...(config.heybox?.dmPeers||[]).map(String),...store.db.prepare("SELECT DISTINCT actor_id AS peer FROM core_events WHERE channel LIKE 'heybox:dm:%' AND kind='message.received'").all().map((r)=>r.peer)])]:[undefined];
   for(const peer of peers){if(signal.aborted)return;if(peer!==undefined&&!/^\d+$/.test(peer))continue;
    const key=`${name}:${action}:${peer||'all'}`,baseline=state.get('life-inbox',key),at=now();
    const mark=baseline||{initializedAt:at,sequence:'0',seeding:true};let cursor=mark.cursor,maxSequence=mark.pendingSequence||mark.sequence||'0',complete=false,unpageable=false,emitted=0,omitted=0;
    try{
     for(let page=0;page<10;page++){
      const result=await adapter.read({action,limit:50,...peer?{id:peer}:{},...cursor?{cursor}:{},signal});signal.throwIfAborted();
      // Warnings are adapter contracts, not English prose with assumed casing.
      // Never establish an authenticated history baseline after a failed read.
      if(!valid(result))throw Error('inbox unavailable');
      for(const item of result.items){
       if(item?.fromSelf===true)continue;
       if(!item?.id||!/^\d+$/.test(String(item.actorId||''))||(action==='inbox'?item.visibility!=='private':item.visibility!=='public')){omitted++;continue;}
       const sequence=/^\d+$/.test(item.sequence||'')?item.sequence:undefined;
       if(peer&&sequence&&BigInt(sequence)>BigInt(maxSequence))maxSequence=sequence;
       const id=`life:incoming:${hash([name,action,item.actorId,item.id])}`;
       if(state.get('life-incoming-seen',id)||store.get(id))continue;
       const channel=action==='inbox'?`${name}:dm:${item.actorId}`:`${name}:public`,target=action==='inbox'?String(item.actorId):String(item.targetId||'');
       const fresh=peer&&sequence&&mark.sequence?BigInt(sequence)>BigInt(mark.sequence):Number.isFinite(item.at)&&item.at>=Math.floor(mark.initializedAt/1000)*1000;
       if(!mark.seeding&&fresh&&target){
        await emit({id,kind:'message.received',channel,actorId:String(item.actorId),text:String(item.text||'').slice(0,6000),...(Number.isFinite(item.at)?{at:item.at}:{}),meta:{addressed:true,platform:name,messageId:String(item.id),sourceTargetId:target,parentId:item.parentId,rootId:item.rootId,platformContext:platformContext(item)}});emitted++;
       }else if(!mark.seeding&&!Number.isFinite(item.at)&&!sequence){omitted++;continue;}
       state.put('life-incoming-seen',id,{at});
      }
      if(!result.truncated){complete=true;break;}
      if(typeof result.cursor!=='string'||!result.cursor||result.cursor===cursor){cursor=undefined;unpageable=true;break;}
      cursor=result.cursor;
     }
     // A bounded catch-up keeps its cursor and prior watermark across polls/restart.
     // No high-water advance until the older pages have actually been drained.
     state.put('life-inbox',key,{initializedAt:mark.initializedAt,seeding:!!mark.seeding&&!complete&&!unpageable,...peer?{sequence:complete||(mark.seeding&&unpageable)?maxSequence:mark.sequence||'0'}:{},...!complete?{cursor,pendingSequence:maxSequence}:{},at,emitted,omitted,state:!complete||omitted?'partial':'ready',...(unpageable?{code:'pagination_unavailable'}:{})});
     state.put('health',`life-inbox:${key}`,{state:!complete||omitted?'partial':'ready',at,emitted,omitted});
    }catch(error){if(!signal.aborted)state.put('health',`life-inbox:${key}`,{state:'error',at,code:inboxFailureCode(error)});}
   }
  }
 }
 return ()=>{if(!polling)polling=run().finally(()=>{polling=undefined;});return polling;};
}
