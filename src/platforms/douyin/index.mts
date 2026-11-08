import { createBrowserTransport,contentVisibility } from './transport.mjs';
import {createUserPlatform,resolveUserLaunch} from './user-platform.mjs';
import {platformTime} from './im-wire.mjs';
import {refusalEvidence,diagnosticFailure} from './publish-diagnostics.mjs';

import {sanitizeDiagnostics as sanitizePublisherDiagnostics,validDmDiagnostic} from './dm-diagnostics.mjs';

export const CAPABILITIES = Object.freeze({feed:true,detail:true,search:true,comments:true,notifications:true,like:true,comment:true,reply:true,publish:true,inbox:true,dm:true});
const id = (value) => (typeof value === 'number' && !Number.isSafeInteger(value)) ? '' : (/^\d{6,30}$/.test(String(value ?? '')) ? String(value) : '');
const safeText = (value) => typeof value === 'string' ? value.slice(0, 5000) : '';

export function createDouyinPlatform({config = {}, stateDir, now = Date.now, transport, idleMs = 120000, diagnosticsTimeoutMs=25000, userPlatformFactory=createUserPlatform, userLaunchResolver=resolveUserLaunch}: { config?: Record<string, any>; stateDir?: any; now?: any; transport?: any; idleMs?: number; diagnosticsTimeoutMs?: number; userPlatformFactory?: any; userLaunchResolver?: any; [key: string]: any } = {}) {
  if (!stateDir) throw new TypeError('stateDir required');
  if(config?.douyin?.desktopUser && !transport) return userPlatformFactory({launchResolver:()=>userLaunchResolver(config.douyin)});
  const browser = transport || createBrowserTransport({config,stateDir,now});
  let tail=Promise.resolve(), pending=0, closed=false, loginActive=false, timer;
  const diagnosticControllers=new Set<any>();
  async function run(signal?: any, fn?: any) {
    if (closed || signal?.aborted) throw new Error('cancelled');
    if (pending >= 16) throw new Error('busy');
    pending++;
    clearTimeout(timer);
    const task=tail.catch(()=>{}).then(async()=>{
      if (closed || signal?.aborted) throw new Error('cancelled');
      let cancellation; const abort=()=>{ cancellation=Promise.resolve(browser.cancel?.()).catch(()=>{}); };
      signal?.addEventListener('abort',abort,{once:true});
      try { const value=await fn(); if(signal?.aborted) throw new Error('cancelled'); return value; } finally { signal?.removeEventListener('abort',abort); if(signal?.aborted) await cancellation; }
    });
    tail=task.catch(()=>{});
    try { return await task; } finally {
      pending--;
      if (!pending && !closed && !loginActive && idleMs > 0 && browser.idleClose) {
        timer=setTimeout(()=>{tail=tail.then(()=>browser.idleClose()).catch(()=>{});}, idleMs);
        timer.unref?.();
      }
    }
  }
  return {
    platform:'douyin', capabilities:CAPABILITIES,
    async diagnostics({signal,action,peerName,targetId,secUid}: { signal?: any; action?: any; peerName?: any; targetId?: any; secUid?: any; [key: string]: any }={}) {
      if(action!==undefined&&(action!=='dm_controls'||!validDmDiagnostic({action,peerName,...targetId!==undefined||secUid!==undefined?{targetId,secUid}:{}})))return diagnosticFailure('owner_operation','operation_failed');
      let phase='owner_queue',expired=false,deadline;
      const controller=new AbortController();diagnosticControllers.add(controller);
      const ownedSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
      // Deadline ends the caller's wait, not ownership of the page. The original
      // run remains on tail until its real operation/idleClose settles. A queued
      // expired request cannot navigate later after its caller has returned.
      const operation=run(ownedSignal,()=>{
        if(expired)return diagnosticFailure(phase,'deadline');
        phase='owner_operation';
        return browser.diagnostics({...action?{action,peerName,...targetId!==undefined||secUid!==undefined?{targetId,secUid}:{}}:{},signal:ownedSignal,onPhase:(value)=>{phase=value;},isExpired:()=>expired});
      }).then(sanitizePublisherDiagnostics,()=>diagnosticFailure(phase,ownedSignal.aborted?'cancelled':'operation_failed')).finally(()=>diagnosticControllers.delete(controller));
      try{return await Promise.race([operation,new Promise<any | void>((resolve)=>{deadline=setTimeout(()=>{expired=true;resolve(diagnosticFailure(phase,'deadline'));},diagnosticsTimeoutMs);})]);}
      finally{clearTimeout(deadline);}
    },
    async status({signal}: { signal?: any; [key: string]: any }={}) {
      try {
        const result=await run(signal,()=>browser.status({signal}));
        const state=['ready','login_required','verification_required','unsupported','error'].includes(result?.state) ? result.state : 'error';
        const out: any={state,capabilities:CAPABILITIES};
        if (state==='ready' && id(result.accountId)) out.accountId=id(result.accountId);
        return out;
      } catch { return {state:'error',capabilities:CAPABILITIES,code:signal?.aborted?'CANCELLED':'TRANSPORT_ERROR'}; }
    },
    async login({action,signal}: { action?: any; signal?: any; [key: string]: any }={}) {
      if (!['start','poll'].includes(action)) return {state:'error'};
      try {
        const result=await run(signal,async()=>{const value=await browser.login({action,signal}); loginActive=['waiting','scanned','confirm','sms','captcha'].includes(value?.state); return value;});
        const state=['waiting','scanned','confirm','sms','captcha','success','expired','error'].includes(result?.state)?result.state:'error';
        const out: any={state};
        if (action==='start' && state==='waiting' && typeof result.qrImagePath==='string') out.qrImagePath=result.qrImagePath;
        if (Number.isFinite(result?.expiresAt)) out.expiresAt=result.expiresAt;
        if (['sms','captcha','confirm'].includes(state)) out.verification=state;
        return out;
      } catch { return {state:'error'}; }
    },
    async read({action,limit=10,cursor,id:targetId,url,query,signal}: { action?: any; limit?: number; cursor?: any; id?: any; url?: any; query?: any; signal?: any; [key: string]: any }={}) {
      if (cursor != null && cursor !== '') return {items:[],truncated:true,warnings:['CURSOR_UNSUPPORTED']};
      if (!['feed','detail','comments','search','inbox','notifications'].includes(action)) return {items:[],truncated:false,warnings:['UNSUPPORTED']};
      const n=Math.max(1,Math.min(50,Number.isFinite(Number(limit))?Math.floor(Number(limit)):10));
      const target=id(targetId || (typeof url==='string' ? url.match(/^https:\/\/www\.douyin\.com\/(?:video|note)\/(\d{6,30})(?:[/?#]|$)/)?.[1] : ''));
      if (['detail','comments'].includes(action) && !target) return {items:[],truncated:false,warnings:['INVALID_TARGET']};
      if (action==='search' && (!safeText(query).trim() || safeText(query).length>200)) return {items:[],truncated:false,warnings:['INVALID_QUERY']};
      try {
        const result=await run(signal,()=>browser.read({action,limit:n,cursor,targetId:target,query:safeText(query),signal}));
        const items=[]; let discarded=false;
        for (const raw of Array.isArray(result?.items)?result.items:[]) {
          if(action==='notifications') {
            const payload=raw.comment_notice??raw,from=id(payload.from_user?.uid),viewer=id(result.accountId);
            const candidates=[payload.comment,payload.reply_comment].filter((c)=>c&&id(c.user?.uid)!==viewer&&(!from||id(c.user?.uid)===from));
            const distinct=[...new Map(candidates.map((c)=>[id(c.cid),c])).values()];
            if(distinct.length!==1){discarded=true;continue;}
            const c=distinct[0],notificationId=id(raw.nid_str??raw.nid??raw.notice_id),commentId=id(c?.cid),postId=id(c?.aweme_id),actor=id(c?.user?.uid);
            if(!notificationId||!commentId||!postId||!actor){discarded=true;continue;}
            items.push({id:notificationId,kind:'comment',visibility:'public',actorId:actor,targetId:postId,parentId:commentId,text:safeText(c.text),at:platformTime(raw.create_time??c.create_time),url:`https://www.douyin.com/video/${postId}`,context:{commentId,postId,...(/^MS4w[A-Za-z0-9_-]{8,200}$/.test(c.user?.sec_uid||'')?{secUid:c.user.sec_uid}:{})}});
            if(items.length>=n)break;continue;
          }
          if(action==='inbox') {
            const messageId=id(raw.serverMessageId), actor=id(raw.sender), account=id(result.accountId);
            const members=String(raw.conversationId||'').split(':');
            if(raw.conversationType!==1||actor===account||raw.sender==='0')continue;
            if(!messageId || !actor || !account || members.length!==4 || members[0]!=='0' || members[1]!=='1' || !members.slice(2).includes(account) || !members.slice(2).includes(actor)) {discarded=true;continue;}
            items.push({id:messageId,kind:'message',visibility:'private',actorId:actor,text:safeText(raw.text),at:platformTime(raw.at),context:{conversationId:raw.conversationId,...(/^MS4w[A-Za-z0-9_-]{8,200}$/.test(raw.secUid||'')?{secUid:raw.secUid}:{})}});
            if(items.length>=n)break;continue;
          }
          const itemId=id(action==='comments'?raw.cid:raw.aweme_id);
          if (!itemId) {discarded=true;continue;}
          const kind=action==='comments'?'comment':([68,150,211].includes(Number(raw.aweme_type))?'post':'video');
          const item: any={id:itemId,...(kind!=='comment'?{url:`https://www.douyin.com/${kind==='post'?'note':'video'}/${itemId}`}:{}) ,text:safeText(raw.desc ?? raw.text ?? raw.title),kind,visibility:kind==='comment'?'public':contentVisibility(raw)};
          const actor=id(raw.author?.uid ?? raw.user?.uid); if(actor) item.actorId=actor;
          const secUid=raw.author?.sec_uid ?? raw.user?.sec_uid;if(/^MS4w[A-Za-z0-9_-]{8,200}$/.test(secUid||''))item.context={secUid};
          items.push(item); if(items.length>=n) break;
        }
        const warnings=[]; if(discarded) warnings.push('ITEMS_WITHOUT_STABLE_IDS_OMITTED');
        if(['VERIFICATION_REQUIRED','PLATFORM_API_ERROR'].includes(result?.code))warnings.push(result.code);
        if(result?.incomplete) warnings.push('INCOMPLETE');
        const out: any={items,truncated:!!result?.hasMore || items.length>=n || !!result?.incomplete,warnings};
        if(typeof result?.cursor==='string' && /^\d{1,30}$/.test(result.cursor)) out.cursor=result.cursor;
        return out;
      } catch { return {items:[],truncated:true,warnings:[signal?.aborted?'CANCELLED':'TRANSPORT_ERROR']}; }
    },
    async write({action,targetId,parentId,text,intentId,context,signal}: { action?: any; targetId?: any; parentId?: any; text?: any; intentId?: any; context?: any; signal?: any; [key: string]: any }={}) {
      if(!['like','comment','reply','publish','dm'].includes(action)) return {confirmed:false,state:'unsupported',code:'UNSUPPORTED'};
      const target=action==='publish'&&targetId==='own-public'?'own-public':id(targetId);
      if(!target || (action==='reply'&&!id(parentId)) || typeof intentId!=='string' || !intentId.trim() || (action!=='like' && (typeof text!=='string' || !text.trim() || text.length>(action==='publish'?8000:action==='dm'?1000:500)))) return {confirmed:false,state:'refused',code:'INVALID_INPUT'};
      try {
        const result=await run(signal,()=>browser.write({action,targetId:target,parentId:id(parentId),text,context,signal}));
        if(result?.confirmed===true && result.kind===action && (action==='publish'?(result.targetId==='own-public'&&id(result.accountId)&&result.visibility==='public'):id(result.targetId)===target) && (action!=='reply'||id(result.parentId)===id(parentId)) && id(result.platformId) && (action!=='like' || id(result.platformId)===target)) return {confirmed:true,platformId:id(result.platformId),targetId:target,kind:action,...(action==='reply'?{parentId:id(parentId)}:{}),...(action==='publish'&&id(result.accountId)&&result.visibility==='public'?{accountId:id(result.accountId),visibility:'public'}:{})};
        if(['refused','login_required','verification_required','uncertain'].includes(result?.state)) return {confirmed:false,state:result.state,code:typeof result.code==='string'?result.code:'UNVERIFIED_RECEIPT',...(action==='publish'&&result.state==='refused'?refusalEvidence(result):{}),...(action==='publish'&&result.state==='uncertain'&&id(result.receiptId)&&id(result.accountId)?{receiptId:id(result.receiptId),accountId:id(result.accountId)}:{})};
        return {confirmed:false,state:'uncertain',code:'UNVERIFIED_RECEIPT'};
      } catch { return {confirmed:false,state:'uncertain',code:'SUBMISSION_UNKNOWN'}; }
    },
    async close() { closed=true; clearTimeout(timer); for(const controller of diagnosticControllers)controller.abort(); await tail; await browser.close?.(); }
  };
}




