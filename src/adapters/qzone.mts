const capabilities=Object.freeze({feed:true,detail:true,search:false,comments:true,like:true,comment:true,reply:true,publish:true,inbox:false,dm:false});
export function createQzonePlatform({config,stateDir,fetchImpl=globalThis.fetch}: { config?: any; stateDir?: any; fetchImpl?: any; [key: string]: any }={}) {
 const qq=config?.qq??{}, token=typeof qq.token==='string'?qq.token:qq.token?.http; let base;
 try {base=new URL(qq.httpUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)base=null;}catch{base=null;}
 let closed=false;const active=new Set<any>();const writes=new Map(), parents=new Map();
 async function request(action?: any,data?: any,signal?: any,writing: boolean=false){
  signal?.throwIfAborted();if(closed)throw Error('Qzone closed');if(!base)throw Error('QQ gateway unavailable');
  const controller=new AbortController();let finish;const done=new Promise<any | void>((resolve)=>finish=resolve);const operation={controller,done};active.add(operation);
  try {const response=await fetchImpl(`${base.href.replace(/\/$/,'')}/${action}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000),...(signal?[signal]:[])])});const result=await response.json();if(!response.ok||result?.status!=='ok'||result.retcode!==0)throw Error('gateway rejected request');return result.data;}
  catch(e){if(!writing && signal?.aborted)signal.throwIfAborted();throw Error(writing?'Qzone submission uncertain':'Qzone gateway request failed');}finally{active.delete(operation);finish();}
 }
 function normalize(feed?: any,warnings?: any){const actorId=String(feed.uin??'');const tid=String(feed.tid??'');if(!/^\d+$/.test(actorId)||!tid){warnings.push('Feed without stable post id omitted');return null;}if(feed.content==null)warnings.push('Post text unavailable');if(feed.content_complete!==true)warnings.push('Post text may be incomplete');return {id:`qzone:${actorId}:${tid}`,text:typeof feed.content==='string'?feed.content:'',kind:'post',visibility:'friends',actorId,...(Number.isFinite(feed.time)?{at:feed.time*1000}:{}),meta:{contentComplete:feed.content_complete??null}};}
 function parse(id?: any){const m=/^qzone:(\d+):([^:]+)$/.exec(String(id??''));if(!m)throw Error('Invalid Qzone post ID');return {target_uin:Number(m[1]),tid:m[2]};}
 async function read({action,limit=20,cursor,id,signal}: { action?: any; limit?: number; cursor?: any; id?: any; signal?: any; [key: string]: any }={}){signal?.throwIfAborted();if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Invalid limit');const warnings=[];
  if(action==='feed'){const data=await request('get_qzone_feeds',{count:limit,...(cursor?{cursor}:{})},signal);if(!Array.isArray(data?.feeds))throw Error('Invalid Qzone feed');const items=data.feeds.map((f)=>normalize(f,warnings)).filter(Boolean);if(data.has_more&&!data.next_cursor)warnings.push('Continuation unavailable');return {items,...(data.next_cursor?{cursor:data.next_cursor}:{}),truncated:!!data.has_more,warnings};}
  if(action==='detail'||action==='comments'){const target=parse(id);const pos=cursor==null?0:Number(cursor);if(!Number.isInteger(pos)||pos<0)throw Error('Invalid cursor');const data=await request('get_qzone_msg_detail',{...target,pos,num:limit},signal);if(action==='detail'){if(typeof data?.tid!=='string'||data.tid!==target.tid||(data.uin!=null&&String(data.uin)!==String(target.target_uin)))return {items:[],truncated:false,warnings:['DETAIL_IDENTITY_UNVERIFIED']};if(typeof data.content!=='string')warnings.push('Post text unavailable');const item={id,text:typeof data.content==='string'?data.content:'',kind:'post',visibility:'friends',observationKind:data.content_complete===true?'body':'body_excerpt',...(data.uin!=null?{actorId:String(data.uin)}:{}),meta:{visibilityVerified:false,authorVerified:data.uin!=null}};return {items:[item],truncated:false,warnings};}if(!Array.isArray(data?.comments))throw Error('Invalid comments');const items=data.comments.flatMap((c)=>{if(c.comment_id==null)return [];const commentId=`${id}:comment:${String(c.comment_id)}`;if(/^\d+$/.test(String(c.uin??'')))parents.set(commentId,{targetId:id,comment_id:String(c.comment_id),comment_uin:Number(c.uin)});return [{id:commentId,text:String(c.content??''),kind:'comment',visibility:'friends',actorId:String(c.uin??''),...(Number.isFinite(c.time)?{at:c.time*1000}:{})}];});const more=Number(data.comment_num)>pos+data.comments.length;if(more&&!data.comments.length)warnings.push('Continuation unavailable');return {items,...(more&&data.comments.length?{cursor:String(pos+data.comments.length)}:{}),truncated:more,warnings};}
  return {items:[],truncated:false,warnings:['Unsupported action']};
 }
 async function status({signal}: { signal?: any; [key: string]: any }={}){if(!base||closed)return {state:'unsupported',capabilities,code:'GATEWAY_UNAVAILABLE'};try{const login=await request('get_login_info',{},signal),profile=await request('get_qzone_profile',{},signal);const accountId=String(login?.user_id??'');if(!/^\d+$/.test(accountId)||(profile?.uin!=null&&String(profile.uin)!==accountId))return {state:'error',capabilities,code:'IDENTITY_UNVERIFIED'};return {state:'ready',accountId,capabilities};}catch{signal?.throwIfAborted();return {state:'error',capabilities,code:'QZONE_UNAVAILABLE'};}}
 async function login({signal}: { signal?: any; [key: string]: any }={}){signal?.throwIfAborted();return {state:'unsupported'};}
 async function write({action,targetId,parentId,text,intentId,context={},signal}: { action?: any; targetId?: any; parentId?: any; text?: any; intentId?: any; context?: Record<string, any>; signal?: any; [key: string]: any }={}){signal?.throwIfAborted();if(!['publish','comment','reply','like'].includes(action))return {confirmed:false,state:'unsupported',code:'ACTION_UNSUPPORTED'};if(!intentId||(action!=='like'&&(typeof text!=='string'||!text.trim())))return {confirmed:false,state:'refused',code:'INVALID_INPUT'};let params: any={};if(action!=='publish'){try{params=parse(targetId);}catch{return {confirmed:false,state:'refused',code:'INVALID_TARGET'};}}if(action==='reply'){const parent=parents.get(parentId);if(!parent||parent.targetId!==targetId)return {confirmed:false,state:'refused',code:'UNKNOWN_PARENT'};params.comment_id=parent.comment_id;params.comment_uin=parent.comment_uin;}const signature=JSON.stringify({action,targetId,parentId,text});const previous=writes.get(intentId);if(previous)return previous.signature===signature?previous.promise:{confirmed:false,state:'refused',code:'INTENT_CONFLICT'};const promise=(async()=>{try{let accountId;if(context.accountId){const identity=await status({signal});if(identity.state!=='ready'||identity.accountId!==context.accountId)return {confirmed:false,state:'refused',code:'ACCOUNT_MISMATCH'};accountId=identity.accountId;}let result;if(action==='publish')result=await request('send_qzone_msg',{content:text,ugc_right:4},signal,true);else if(action==='like')result=await request('like_qzone',params,signal,true);else result=await request('comment_qzone',{...params,content:text},signal,true);const platformId=action==='publish'?result?.tid:action==='like'?targetId:result?.comment_id;if(platformId==null||String(platformId)==='')return {confirmed:false,state:'uncertain',code:'MISSING_RECEIPT'};return {confirmed:true,platformId:String(platformId),targetId:action==='publish'?String(platformId):targetId,kind:action,visibility:'friends',...(accountId?{accountId}:{})};}catch{return {confirmed:false,state:'uncertain',code:'SUBMISSION_UNCERTAIN'};}})();writes.set(intentId,{signature,promise});return promise;}

 // The deployed gateway intentionally strips author/rights from detail. This
 // private, read-only path verifies a known own receipt using the underlying
 // response. It is not an actor MCP operation and never returns cookie material.
 async function verifyOwnPost({id,accountId,signal}: { id?: any; accountId?: any; signal?: any; [key: string]: any }={}) {
  let operation,finish;
  try {
   if(closed||signal?.aborted||typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id)||typeof accountId!=='string'||!/^\d{1,20}$/.test(accountId))throw Error();
   const login=await request('get_login_info',{},signal);
   if(String(login?.user_id??'')!==accountId)throw Error();
   const session=await request('get_cookies',{domain:'qzone.qq.com'},signal),cookie=session?.cookies;
   if(typeof cookie!=='string'||!cookie||cookie.length>16384||/[\x00-\x1f\x7f]/.test(cookie))throw Error();
   const cookies=new Map();
   for(const part of cookie.split(';').map((x)=>x.trim()).filter(Boolean)) {
    const i=part.indexOf('=');if(i<1)throw Error();const key=part.slice(0,i),value=part.slice(i+1);
    if(!/^[A-Za-z0-9_-]+$/.test(key)||cookies.has(key))throw Error();cookies.set(key,value);
   }
   for(const name of ['uin','p_uin'])if(cookies.has(name)) {
    const value=cookies.get(name);if(!/^o?\d+$/.test(value)||value.replace(/^o?0*/,'')!==accountId.replace(/^0+/,''))throw Error();
   }
   const key=cookies.get('p_skey')||cookies.get('skey');if(!key)throw Error();
   let gtk=5381;for(let i=0;i<key.length;i++)gtk=(gtk+(gtk<<5)+key.charCodeAt(i))|0;gtk&=2147483647;
   const url=new URL('https://h5.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6');
   for(const [name,value] of Object.entries({tid:id,uin:accountId,t1_source:'1',not_trunc_con:'1',need_right:'1',not_adapt_outpic:'1',g_tk:String(gtk)}))url.searchParams.set(name,value);
   const controller=new AbortController(),done=new Promise<any | void>((resolve)=>finish=resolve);operation={controller,done};active.add(operation);
   const combined=AbortSignal.any([controller.signal,AbortSignal.timeout(15000),...(signal?[signal]:[])]);combined.throwIfAborted();
   const response=await fetchImpl(url.href,{method:'GET',redirect:'manual',headers:{cookie,referer:`https://user.qzone.qq.com/${accountId}`,'user-agent':'Mozilla/5.0'},signal:combined});
   const maxBytes=1024*1024;
   if(!response.ok||response.redirected||Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw Error();}
   const reader=response.body?.getReader();if(!reader)throw Error();
   let length=0;const chunks=[],cancel=()=>{void reader.cancel().catch(()=>{});};combined.addEventListener('abort',cancel,{once:true});
   try {for(;;){combined.throwIfAborted();const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw Error();}chunks.push(value);}}
   finally {combined.removeEventListener('abort',cancel);reader.releaseLock();}
   combined.throwIfAborted();let body=Buffer.concat(chunks).toString('utf8').trim();
   const jsonp=/^[A-Za-z_$][\w$]*\s*\(\s*([\s\S]*)\s*\)\s*;?$/.exec(body);if(jsonp)body=jsonp[1];
   const raw=JSON.parse(body);
   const resultCode=raw?.code!==undefined&&raw.code!==0?raw.code:raw?.subcode??raw?.code??-1;
   if(resultCode!==0||raw.tid!==id||String(raw.uin??'')!==accountId||raw.content!=='pong'||![4,'4'].includes(raw.ugc_right))throw Error();
   if(String((await request('get_login_info',{},signal))?.user_id??'')!==accountId)throw Error();
   return {verified:true,id,accountId,text:'pong',target:'own-friends',visibility:'friends',visibilityEvidence:'qzone_raw_ugc_right_4',url:`https://user.qzone.qq.com/${accountId}/mood/${id}`};
  }catch{return {verified:false,code:'QZONE_READBACK_UNKNOWN'};}
  finally{if(operation)active.delete(operation);finish?.();}
 }

 async function close(){closed=true;const operations=[...active];for(const operation of operations)operation.controller.abort();await Promise.all(operations.map((operation: any) =>operation.done));}
 return {platform:'qzone',capabilities,status,login,read,write,verifyOwnPost,close};
}
