import fs from 'node:fs';
import {observationMedia} from './observation-media.mjs';
import {publishInput} from './publish-input.mjs';
import {operatorDmBinding} from './operator-dm.mjs';
import {createLivePlatformTests} from './live-platforms.mjs';
import {sanitizeDiagnostics as sanitizePublisherDiagnostics,validDmDiagnostic} from '../platforms/douyin/dm-diagnostics.mjs';
import {createInteractionPoller,platformContext} from './interactions.mjs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createPlatformBridge} from './bridge.mjs';
import {createQzonePlatform} from '../adapters/qzone.mjs';
import {createHeyboxPlatform} from '../adapters/heybox.mjs';
import {createDouyinPlatform} from '../platforms/douyin/index.mjs';
import {platformRoute} from '../core/platforms.mjs';
import {redact} from '../core/events.mjs';
import {platformStatus,readTarget,safeCode} from './status.mjs';
const factories={qzone:createQzonePlatform,heybox:createHeyboxPlatform,douyin:createDouyinPlatform};
const names=['qq','bilibili','qzone','heybox','douyin'];
const digest=(x)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const bounded=(x?: any,n: number=4000)=>redact(String(x??'')).slice(0,n);
const fail=()=>new Error('Platform operation failed or was refused');
const dateParts=(ms)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(ms).map((x)=>[x.type,x.value]));
const cleanItem=(x)=>({id:bounded(x.id,512),...(x.url?{url:bounded(x.url,1000)}:{}),...(x.title?{title:bounded(x.title,500)}:{}),text:bounded(x.text,6000),kind:['video','post','message','comment'].includes(x.kind)?x.kind:'post',visibility:x.visibility,...(x.actorId?{actorId:bounded(x.actorId,256)}:{}),...(Number.isFinite(x.at)?{at:x.at}:{}),...Object.fromEntries(['targetId','parentId','rootId','sequence'].filter((k)=>typeof x[k]==='string'&&x[k].length<=256).map((k)=>[k,x[k]])),context:platformContext(x),...(typeof x.fromSelf==='boolean'?{fromSelf:x.fromSelf}:{})});
export function createLifeOwner({config,state,store,socialPolicy,authorize,onEvent,now=Date.now,platforms={},validationPlatforms=[],contentObservations}: { config?: any; state?: any; store?: any; socialPolicy?: any; authorize?: any; onEvent?: any; now?: any; platforms?: Record<string, any>; validationPlatforms?: any[]; contentObservations?: any; [key: string]: any }){
 if(!config?.stateDir||!state||!store||typeof authorize!=='function')throw fail();
 const validationWritePlatforms=new Set<any>(Array.isArray(validationPlatforms)?validationPlatforms.filter((name)=>Object.hasOwn(platforms,name)):[]);
 const owners={...platforms},root=path.join(config.stateDir,'life');fs.mkdirSync(root,{recursive:true,mode:0o700});if(process.platform!=='win32')fs.chmodSync(root,0o700);
 for(const [name,factory] of Object.entries(factories)){if(!config[name]?.enabled||owners[name])continue;const dir=path.join(root,name);fs.mkdirSync(dir,{recursive:true,mode:0o700});if(process.platform!=='win32')fs.chmodSync(dir,0o700);owners[name]=factory({config,stateDir:dir,now});}
 const liveTests=createLivePlatformTests({config,owners,state,now});
 const controller=new AbortController();let bridge,timer,inboxTimer,closed=false,polling;const pending=new Set<any>();
 const emit=async (e?: any) =>{if(onEvent)return await onEvent(e);return store.append(e);};
 const pollInbox=createInteractionPoller({owners,config,state,store,emit,now,signal:controller.signal});
 const pollInteractions=()=>track(pollInbox);
 function track<T>(fn: () => T | PromiseLike<T>): Promise<T>{if(closed)throw fail();const p=Promise.resolve().then(fn);pending.add(p);p.finally(()=>pending.delete(p)).catch(()=>{});return p;}
 function authorizedScope(binding?: any,platform?: any){if(!binding||binding.platform!==platform||typeof binding.channel!=='string')throw fail();const route=platformRoute(binding.channel);const expected=platform==='bilibili'?'bili':platform;if(route.platform!==expected||binding.scope!==route.scope)throw fail();return route.scope;}
 function allowed(item?: any,scope?: any,platform?: any){if(item.visibility==='public')return scope==='public';if(item.visibility==='friends')return platform==='qzone'&&scope==='qzone:friends';if(item.visibility==='private')return scope===`private:${platform==='bilibili'?'bili':platform}`;return false;}
 function operationHealth(platform?: any,action?: any,value?: any,error: boolean=false){const code=safeCode(value?.code);const receiptId=typeof value?.receiptId==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(value.receiptId)?value.receiptId:undefined;state.put?.('health',`life-operation:${platform}:${action}`,{state:/verification_required/i.test(code||'')?'verification_required':/login_required/i.test(code||'')?'login_required':error||value?.confirmed===false?'unknown':'ready',at:now(),...code?{code}:{},...receiptId?{receiptId}:{}});return Object.assign(fail(),{...code?{code:code.toUpperCase().replace(/[^A-Z0-9_]/g,'_').slice(0,80)}:{},...receiptId?{receiptId}:{}});}
 async function handle({platform,operation,args={}}: { platform?: any; operation?: any; args?: Record<string, any>; [key: string]: any }, {operator=false,signal:requestSignal}: { operator?: boolean; signal?: any; [key: string]: any }={}){return track(async()=>{
  const signal=AbortSignal.any([controller.signal,...(requestSignal?[requestSignal]:[])]);const ensureActive=()=>{if(signal.aborted)throw fail();};ensureActive();
  const adapter=owners[platform];if(!names.includes(platform)||!adapter)throw fail();
  if(operation==='diagnostics'){if(!operator||platform!=='douyin'||!((args.action==='publish_controls'&&Object.keys(args).every((k)=>k==='action'))||validDmDiagnostic(args))||typeof adapter.diagnostics!=='function')throw fail();return sanitizePublisherDiagnostics(await adapter.diagnostics({...args.action==='dm_controls'?args:{},signal}));}
  if(operation==='live_test'){if(!operator||Object.keys(args).some((k)=>!['revision','mode'].includes(k)))throw fail();return liveTests.run({platform,...args},{operator:true,signal});}
  if(operation==='status'){const s=await adapter.status({signal}),result=platformStatus({...s,capabilities:s?.capabilities||adapter.capabilities||{}});const {accountId,...health}=result;state.put?.('health',`life-platform:${platform}`,{...health,at:now()});return result;}
  if(operation==='login'){if(!operator||!['start','poll'].includes(args.action))throw fail();if(args.action==='start'){const current=await adapter.status({signal});ensureActive();if(['verification_required','ready'].includes(current?.state))return {state:current.state};}return adapter.login({action:args.action,signal});}
  let binding;
  if(operation==='direct_message'){
   if(!operator)throw fail();binding=operatorDmBinding({platform,args,state,now});args={...args,action:'dm'};operation='write';
  }else{
   if(operator||!['read','write'].includes(operation)||typeof args.ticket!=='string'||!args.ticket)throw fail();
   binding=await authorize(args.ticket,{platform,operation,...operation==='write'?{targetId:args.targetId}:{}});
  }
  ensureActive();const scope=authorizedScope(binding,platform);
  if(binding.readOnly&&operation!=='read')throw fail();
  if(operation==='read'){
   if(!['feed','detail','comments','search','inbox','notifications'].includes(args.action)||!adapter.capabilities?.[args.action])throw fail();
   if(args.action==='notifications'&&scope!=='public')throw fail();
   if(args.action==='inbox'&&scope!==`private:${platform==='bilibili'?'bili':platform}`)throw fail();
   if(['detail','comments'].includes(args.action))args=readTarget(platform,args,binding);
   const observing=binding.readOnly&&contentObservations?.active({...binding,consumed:true});
   if(binding.readOnly&&(!observing||!['feed','search','detail','comments'].includes(args.action)))throw fail();
   const actor={...binding,consumed:true},detail=args.action==='detail',comments=args.action==='comments';
   const attempt=detail?'body':comments?'comments':undefined;
   if(observing&&!contentObservations.reserve(actor,attempt?args.id:observing.itemId,attempt??'discovery'))return {items:[],truncated:false,warnings:['BROWSE_ALREADY_ATTEMPTED']};
   const limit=Math.min(observing?(detail?1:comments?4:5):20,Math.max(1,Number.isInteger(args.limit)?args.limit:10));
   const result=await Promise.resolve().then(()=>adapter.read({action:args.action,limit,...Object.fromEntries(['id','url','cursor','query'].filter((k)=>typeof args[k]==='string'&&args[k].length<=1000).map((k)=>[k,args[k]])),context:binding,signal,...observing&&platform==='douyin'?{observeMedia:true}:{}})).catch((e)=>{
    if(observing&&attempt&&!signal.aborted)contentObservations.observe(actor,args.id,attempt,null);
    throw operationHealth(platform,args.action,e,true);
   });
   const codes=(result?.warnings||[]).filter((x)=>safeCode(x)),blocked=codes.find((x)=>/verification_required|login_required/i.test(x));state.put?.('health',`life-operation:${platform}:${args.action}`,{state:blocked?.toLowerCase().includes('verification')?'verification_required':blocked?'login_required':result?.truncated||result?.warnings?.length?'partial':'ready',at:now(),warningCount:result?.warnings?.length||0,...codes[0]?{code:codes[0]}:{}});
   if(!Array.isArray(result?.items))throw fail();const items=result.items.filter((i)=>i&&typeof i.id==='string'&&i.id&&(args.action!=='detail'||i.id===args.id)&&allowed(i,scope,platform)).slice(0,limit).map(cleanItem);
   const output: any={items,...typeof result.cursor==='string'?{cursor:bounded(result.cursor,1000)}:{},truncated:!!result.truncated||result.items.length>limit,warnings:Array.isArray(result.warnings)?result.warnings.slice(0,10).map((w)=>bounded(w,500)):[]};
   if(result.items.length!==items.length){output.truncated=true;output.warnings.push('Items omitted due to scope or limit');}
   if(observing&&attempt){
    ensureActive();
    await authorize(args.ticket,{platform,operation:'read'});
    ensureActive();
    if(!contentObservations.active(actor))throw fail();
    const item=items[0];
    const source=detail&&item?result.items.find(raw=>raw.id===item.id&&allowed(raw,scope,platform)):undefined;
    const kind=detail?source?.observationKind:'comments';
    const text=detail?item?.text:items.map(comment=>comment.text).filter(Boolean).join('\n');
    const evidence=['body','body_excerpt','description','metadata','comments'].includes(kind)&&text?.trim()?{kind,text}:null;
    if(evidence&&kind==='body'){
     const id=`life:read:${digest([platform,scope,item.id,item.text,item.title||''])}`;
     if(!store.get?.(id))await emit({id,kind:'task.result',channel:binding.channel,actorId:'fish',
      text:JSON.stringify(item),meta:{experienced:true,route:false,passive:true,sourceEventId:binding.eventId,platform,itemId:item.id,evidenceKind:kind}});
     output.sourceEventId=id;
     Object.assign(evidence,{sourceEventId:id});
    }
    contentObservations.observe(actor,args.id,attempt,evidence);
    output.observationKind=evidence?.kind??null;
    if(platform==='douyin'&&detail&&item){
     const media=observationMedia(source?.media,args.id);
     if(media){
      const id=`life:media:${digest([platform,scope,item.id,media.kind,media.seconds,media.data])}`;
      const text=media.kind==='frames'?`视频画面采样 ${media.seconds} 秒`:'已读取图文中的一张图片';
      if(!store.get?.(id))await emit({id,kind:'task.result',channel:binding.channel,actorId:'fish',text,
       meta:{experienced:true,route:false,passive:true,sourceEventId:binding.eventId,platform,itemId:item.id,evidenceKind:media.kind}});
      contentObservations.observe(actor,args.id,media.kind,{kind:media.kind,text,sourceEventId:id});
      output.media=media;
     }
     if(item.kind==='video'){
      contentObservations.observe(actor,args.id,'subtitles',null);
      if(!media||media.kind!=='frames')contentObservations.observe(actor,args.id,'frames',null);
      output.mediaMissing=media?.kind==='frames'?['subtitles']:['subtitles','frames'];
     }
    }
    return output;
   }
   if(args.action==='detail'&&items.length){const item=items[0],id=`life:read:${digest([platform,scope,item.id,item.text,item.title||''])}`;if(!store.get?.(id))await emit({id,kind:'task.result',channel:binding.channel,actorId:'fish',text:JSON.stringify(item),meta:{experienced:true,route:false,passive:true,sourceEventId:binding.eventId,platform,itemId:item.id}});output.sourceEventId=id;}
   return output;
  }
  if(config.validation===true&&!validationWritePlatforms.has(platform))return {confirmed:false,state:'refused',code:'VALIDATION_WRITES_DISABLED'};
  const {action,targetId,intentId,text,parentId}=args;if(!['like','comment','reply','publish','dm'].includes(action)||!adapter.capabilities?.[action])return {confirmed:false,state:'unsupported',code:'ACTION_UNSUPPORTED'};
  if(typeof targetId!=='string'||!targetId.trim()||targetId.length>512||typeof intentId!=='string'||!intentId.trim()||intentId.length>256||(action!=='like'&&(typeof text!=='string'||!text.trim()||text.length>4000)))throw fail();
  if(action==='publish'){const own=platform==='qzone'?'own-friends':'own-public', visibility=platform==='qzone'?'friends':'public';if(targetId!==own||binding.allowedOwnTarget!==own||scope!==(platform==='qzone'?'qzone:friends':'public')||(args.visibility!=null&&args.visibility!==visibility))throw fail();}
  if(action!=='publish'&&targetId!==String(binding.sourceTargetId||binding.targetId))throw fail();
  const date=dateParts(now()),day=`${date.year}-${date.month}-${date.day}`,category=action==='like'?'likes':action==='publish'?'posts':'comments',maximum={likes:12,posts:2,comments:8}[category];
  const publish=action==='publish'?publishInput(args,config):{};const writeContext=Object.keys(publish).length?{...binding,...publish}:binding;
  const input={...publish,platform,source:binding.requestId||binding.eventId,action,targetId,parentId:parentId||'',text:text||''},sendId=`life:${digest(input)}`;
  ensureActive();const receipt=await state.send(sendId,input,async()=>{ensureActive();const limited=!['qq','bilibili'].includes(platform);const quotaId=`${platform}:${day}:${category}`,quota=state.get('life-quota',quotaId)||{count:0};if(limited&&quota.count>=maximum)throw fail();const socialReservation=limited&&socialPolicy&&['comment','reply','dm'].includes(action)?socialPolicy.reserve({platform,action,intentId:sendId}):null;if(limited)state.put('life-quota',quotaId,{count:quota.count+1});let r;try{r=await adapter.write({action,targetId,intentId,...text?{text}:{},...parentId?{parentId}:{},context:writeContext,signal});}catch(e){throw operationHealth(platform,action,e,true);}operationHealth(platform,action,r);if(r?.confirmed!==true){if(['unsupported','refused','login_required','verification_required'].includes(r?.state)){if(socialReservation&&r.deliveryState==='not_sent')socialPolicy.release(socialReservation,{deliveryState:'not_sent'});if(limited){const current=state.get('life-quota',quotaId)||{count:0};state.put('life-quota',quotaId,{...current,count:Math.max(0,current.count-1)});}return {confirmed:false,state:r.state,code:bounded(r.code,100)};}throw operationHealth(platform,action,r,true);}if(typeof r.platformId!=='string'||!r.platformId.trim()||(action==='publish'&&platform==='qzone'?r.targetId!==r.platformId:r.targetId!==targetId)||(action==='publish'&&platform==='qzone'&&r.visibility!=='friends')||(r.visibility&&r.visibility!==(scope==='public'?'public':scope==='qzone:friends'?'friends':'private')))throw fail();let journaledEventId;if(['qq','bilibili'].includes(platform)&&r.journaledEventId!=null){if(typeof r.journaledEventId!=='string'||!r.journaledEventId)throw fail();const event=store.get(r.journaledEventId);if(event?.kind!=='message.sent'||event.channel!==binding.channel||event.meta?.messageId!==r.platformId)throw fail();journaledEventId=r.journaledEventId;}if(socialReservation)socialPolicy.settle(socialReservation,{deliveryState:'confirmed'});return {confirmed:true,platformId:bounded(r.platformId,512),targetId,kind:action,...journaledEventId?{journaledEventId}:{},...r.url?{url:bounded(r.url,1000)}:{}};});
  if(receipt.confirmed&&!receipt.journaledEventId){const id=`life:sent:${digest([platform,receipt.platformId,action])}`;if(!store.get?.(id))await emit({id,kind:action==='like'?'task.result':'message.sent',channel:binding.channel,actorId:'fish',text:action==='like'?`Liked ${targetId}`:bounded(text,4000),meta:{...action==='like'?{experienced:true}:{messageId:receipt.platformId},route:false,passive:true,...binding.operatorCommandId?{operatorCommandId:binding.operatorCommandId}:{sourceEventId:binding.eventId},platform,targetId}});}
  return receipt;
 }).catch(()=>{throw fail();});}
 async function poll(){if(polling)return polling;polling=track(async()=>{const p=dateParts(now()),day=`${p.year}-${p.month}-${p.day}`,hour=Number(p.hour);if(![9,13,20,21,22].includes(hour))return;for(const name of ['qzone','heybox','douyin']){const adapter=owners[name];if(!adapter?.capabilities?.feed)continue;const key=`${name}:${day}`,schedule=state.get('life-schedule',key)||{count:0,last:0};if(schedule.count>=4||(schedule.last&&now()-schedule.last<1200000))continue;const attemptedAt=now();state.put('life-schedule',key,{count:schedule.count,last:attemptedAt});let consumed=false;try{const cursor=state.get('life-cursor',name)?.cursor;const feed=await adapter.read({action:'feed',limit:3,...cursor?{cursor}:{},signal:controller.signal});if(typeof feed.cursor==='string'&&feed.cursor.length<=1000)state.put('life-cursor',name,{cursor:feed.cursor});for(const item of (feed.items||[]).slice(0,3)){const scope=name==='qzone'?'qzone:friends':`${name}:public`;if(!item?.id||!allowed(item,name==='qzone'?'qzone:friends':'public',name))continue;const id=`life:proposal:${digest([name,item.id])}`;if(state.get('life-proposal',id))continue;if(!consumed){state.put('life-schedule',key,{count:schedule.count+1,last:attemptedAt});consumed=true;}state.put('life-proposal',id,{at:now()});await emit({id,kind:'timer',channel:scope,actorId:'fish',text:`Platform item available: ${bounded(item.id,512)}`,meta:{platform:name,itemId:bounded(item.id,512),sourceTargetId:bounded(item.id,512)}});}}catch{if(controller.signal.aborted)break;}}});try{return await polling;}finally{polling=null;}}
 async function status(){return Object.fromEntries(await Promise.all(names.map(async (name?: any) =>{if(!owners[name])return [name,{state:'unsupported',capabilities:{}}];try{return [name,await handle({platform:name,operation:'status',args:{}})];}catch{return [name,{state:'error',capabilities:{}}];}})));}
 async function start(){if(closed||bridge)throw fail();const socketPath=config.life?.socketPath||path.join(root,'platform.sock');bridge=createPlatformBridge({socketPath,handle});await bridge.start();timer=setInterval(()=>poll().catch(()=>{}),60000);timer.unref?.();inboxTimer=setInterval(()=>pollInteractions().catch(()=>{}),20000);inboxTimer.unref?.();}
 async function close(){if(closed)return;closed=true;clearInterval(timer);clearInterval(inboxTimer);controller.abort();await bridge?.close();await Promise.allSettled([...pending]);await Promise.allSettled(Object.values(owners).map((x)=>x.close?.()));}
 return {start,close,poll,pollInteractions,handle,status};
}





