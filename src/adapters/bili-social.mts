// Narrow extraction of SurfCore msgfeed/DM parameter contracts; upstream MIT
// attribution is retained in notices/surfcore-bili-LICENSE. No legacy runtime.
// History parameters/WBI requirement verified from bilibili-api-python 17.4.2
// session.py and data/api/session.json (read only, never installed or executed).
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const API='https://api.bilibili.com',IM='https://api.vc.bilibili.com';
const MAX_BYTES=1024*1024,MAX_PEERS=6,MAX_PAGES=3,PAGE_SIZE=30,COMMENTS_PER_SOURCE=3;
const MIXIN=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const id=(value)=>typeof value==='string'&&/^[1-9][0-9]{0,21}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
const human=(value)=>id(value)&&BigInt(id(value))>=1000n;
const problem=(code?: any,message?: any)=>Object.assign(new Error(message),{code});
const knownCode=(error)=>typeof error?.code==='string'&&error.code.startsWith('BILI_')?error.code:null;
function parseJSON(text?: any){return JSON.parse(text,(_key?: any,value?: any,context?: any)=>typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)?context.source:value);}
function messageText(value?: any){try{const p=JSON.parse(String(value));return typeof p.content==='string'?p.content:typeof p.text==='string'?p.text:'';}catch{return typeof value==='string'?value:'';}}
function videoCard(value?: any){
 if(typeof value!=='string'||value.length>8192||Buffer.byteLength(value)>8192)return;
 let card;try{card=JSON.parse(value);}catch{return;}
 if(!card||typeof card!=='object'||Array.isArray(card)||card.source!==5||
    typeof card.title!=='string'||!card.title.trim()||card.title.length>300||
    /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u.test(card.title)||
    typeof card.url!=='string'||card.url.length>64)return;
 for(const [key,limit] of ([['headline',300],['author',150],['thumb',2048]] as const)){
  if(Object.hasOwn(card,key)&&(typeof card[key]!=='string'||card[key].length>limit))return;
 }
 if(Object.hasOwn(card,'id')&&(typeof card.id==='string'?card.id.length>64:!Number.isSafeInteger(card.id)))return;
 // Match the literal wire URL before normalizing; URL parsers can discard
 // default ports and whitespace or reinterpret separators.
 const match=/^https:\/\/www\.bilibili\.com\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(card.url);
 if(!match||match[0]!==card.url)return;
 const bvid=match[1],url=`https://www.bilibili.com/video/${bvid}`,title=card.title.trim();
 return {kind:'video-card',bvid,url,title};
}
const stamp=(value)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):0;

/** No watermarks or read acknowledgements: the host persists and deduplicates
 * events before advancing its own baseline. Poll is intentionally bounded. */
export function createBiliSocial({fishHome,fetchImpl=globalThis.fetch,timeoutMs=30000,now=Date.now}: { fishHome?: any; fetchImpl?: any; timeoutMs?: number; now?: any; [key: string]: any }={}){
 if(typeof fishHome!=='string'||!path.isAbsolute(fishHome))throw Error('Absolute fishHome required');
 const active=new Set<any>(),commentOffsets={reply:0,at:0};let closed=false;
 async function operation(signal?: any,perform?: any){
  if(closed)throw problem('BILI_CLOSED','Bili social adapter is closed');
  const controller=new AbortController(),cancel=()=>controller.abort();
  if(signal?.aborted)throw problem('BILI_CANCELLED','Bili operation cancelled');signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,Math.max(1,Math.min(Number(timeoutMs)||30000,120000)));active.add(controller);
  try{return await perform(controller.signal);}catch(error){if(knownCode(error)||error?.code==='SEND_UNCERTAIN')throw error;throw problem(controller.signal.aborted?'BILI_CANCELLED':'BILI_UNAVAILABLE',controller.signal.aborted?'Bili operation cancelled or timed out':'Bili social operation unavailable');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);active.delete(controller);}
 }
 async function client(signal?: any){
  const [cred,cfg]=await Promise.all(['bili/credentials.json','bili.config.json'].map(async (file?: any) =>parseJSON(await fs.readFile(path.join(fishHome,file),'utf8'))));
  if(!id(cfg.self?.mid)||!['sessdata','bili_jct','buvid3'].every((k)=>typeof cred[k]==='string'&&cred[k]&&!/[\r\n;]/.test(cred[k])))throw problem('BILI_CONFIG','Bili account configuration invalid');
  const headers={'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/',cookie:`SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`};
  async function request(origin?: any,endpoint?: any,params: Record<string, any>={},body?: any){
   signal.throwIfAborted();
   // Origin and path are private constants, never caller supplied. All redirects
   // are rejected, including redirects between two official Bili origins.
   if(![API,IM].includes(origin)||!endpoint.startsWith('/'))throw problem('BILI_DESTINATION','Invalid Bili destination');
   const response=await fetchImpl(`${origin}${endpoint}?${new URLSearchParams(params)}`,{method:body?'POST':'GET',headers:{...headers,...body?{'content-type':'application/x-www-form-urlencoded'}:{}},body,redirect:'manual',signal});
   if(!response.ok||response.redirected){await response.body?.cancel();throw problem('BILI_RESPONSE','Bili response rejected');}
   if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw problem('BILI_RESPONSE','Bili response exceeds size limit');}
   let size=0;const chunks=[];const reader=response.body?.getReader();
   if(!reader)throw problem('BILI_RESPONSE','Bili response is empty');
   const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
   try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw problem('BILI_RESPONSE','Bili response exceeds size limit');}chunks.push(value);}}
   finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
   signal.throwIfAborted();const data=parseJSON(Buffer.concat(chunks).toString('utf8'));
   if(data.code!==0){
    // Only constant route and numeric code may cross the adapter boundary.
    // Platform message/data fields can contain private or untrusted text.
    const apiCode=Number.isSafeInteger(data.code)?data.code:null;
    throw Object.assign(problem('BILI_API',`Bili API did not confirm ${endpoint} (code ${apiCode??'invalid'})`),{apiCode,endpoint});
   }return data.data;
  }
  const nav=await request(API,'/x/web-interface/nav');
  if(nav?.isLogin!==true||id(nav.mid)!==id(cfg.self.mid))throw problem('BILI_ACCOUNT','Bili account does not match configured self.mid');
  const keyOf=(value)=>{try{return new URL(value).pathname.split('/').at(-1).split('.')[0];}catch{return '';}};
  const raw=keyOf(nav.wbi_img?.img_url)+keyOf(nav.wbi_img?.sub_url),mixin=MIXIN.map((i)=>raw[i]).join('').slice(0,32);
  function signed(params?: any){if(raw.length!==64||mixin.length!==32)throw problem('BILI_WBI','Bili signing keys unavailable');const all={...params,wts:Math.floor(now()/1000)};const query=Object.keys(all).sort().map((k)=>`${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g,''))}`).join('&');return {...all,w_rid:createHash('md5').update(query+mixin).digest('hex')};}
  return {request,signed,cfg,cred,selfId:id(nav.mid)};
 }
 async function sessions(c?: any){const data=await c.request(IM,'/session_svr/v1/session_svr/get_sessions',{session_type:'1',group_id:'0',count:'50',mobi_app:'web'});if(!Array.isArray(data?.session_list))throw problem('BILI_RESPONSE','Bili session list unavailable');return data.session_list;}
 function commentCandidate(item?: any,kind?: any,c?: any,seen?: any){
  const actorId=id(item.user?.mid),sourceId=id(item.item?.source_id),notificationId=id(item.id),notificationKey=`${kind}:${notificationId}`;
  if(!human(actorId)||actorId===c.selfId||!sourceId||!notificationId||seen.has(notificationKey))return null;
  try{
   const uri=new URL(item.item?.uri);if(uri.protocol!=='https:'||uri.username||uri.password||uri.port||!['www.bilibili.com','bilibili.com','t.bilibili.com'].includes(uri.hostname))return null;
   const type=Number(item.item?.business_id),oid=id(item.item?.subject_id),sourceRoot=id(item.item?.root_id);
   const bvid=type===1?(uri.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/)||[])[1]:null;
   const dynamicId=[11,17].includes(type)?(uri.pathname.match(/^\/(?:opus\/)?([1-9][0-9]{5,21})\/?$/)||[])[1]:null;
   if(type===1?(!oid||!bvid):(![11,17].includes(type)||!dynamicId))return null;
   return {item,actorId,sourceId,sourceRoot,notificationId,notificationKey,uri,type,oid,bvid,dynamicId};
  }catch{return null;}
 }
 function threadFloors(data?: any){
  const stack=[data?.root,...Array.isArray(data?.replies)?data.replies:[]],out=[];
  for(let n=0;stack.length&&n<1000;n++){const r=stack.pop();if(!r||typeof r!=='object')continue;out.push(r);if(Array.isArray(r.replies))stack.push(...r.replies.slice(0,1000));}return out;
 }
 async function resolveComment(c?: any,x?: any){
  let {oid,type}=x;const {sourceId,sourceRoot,actorId}=x,root=sourceRoot||sourceId;
  if(x.dynamicId){const detail=await c.request(API,'/x/polymer/web-dynamic/v1/detail',{id:x.dynamicId});oid=id(detail?.item?.basic?.comment_id_str);type=Number(detail?.item?.basic?.comment_type);if(!oid||![11,17].includes(type))throw problem('BILI_COMMENT_UNRESOLVED','Dynamic comment coordinates unavailable');}
  const floors=new Map(),add=(data)=>{for(const r of threadFloors(data)){const key=id(r.rpid_str??r.rpid);if(key)floors.set(key,r);}};
  const noticeAt=stamp(x.item.reply_time??x.item.at_time);
  function pick(){
   const all=[...floors.values()].filter((r)=>id(r.member?.mid??r.mid)===actorId&&(!sourceRoot||!id(r.root_str??r.root)||id(r.root_str??r.root)===sourceRoot));
   const exact=all.find((r)=>id(r.rpid_str??r.rpid)===sourceId);
   if(exact)return exact;
   // Legacy msgfeed variants identify the replied-to floor in source_id.
   // Require the actor, exact parent relation and notification timestamp; a
   // different/latest author reply is never a substitute for this event.
   let children=all.filter((r)=>id(r.parent_str??r.parent)===sourceId&&noticeAt&&stamp(r.ctime)===noticeAt);
   if(children.length>1&&typeof x.item.item?.source_content==='string'&&x.item.item.source_content)children=children.filter((r)=>r.content?.message===x.item.item.source_content);
   return children.length===1?children[0]:null;
  }
  // Jump locates a specific rpid without assuming that it lives in pn=1..2.
  // Verified against seiuna/bilibili-api src/api/comment.ts getReply.
  add(await c.request(API,'/x/v2/reply/jump',{oid,type:String(type),rpid:sourceId}));
  let floor=pick();
  if(!floor)for(let pn=1;pn<=2;pn++){
   const data=await c.request(API,'/x/v2/reply/reply',{type:String(type),oid,root,ps:'20',pn:String(pn)});add(data);floor=pick();
   if(floor||(data?.replies?.length??0)<20)break;
  }
  if(!floor||typeof floor.content?.message!=='string'||!floor.content.message.trim()||floor.content.message.length>10000)throw problem('BILI_COMMENT_UNRESOLVED','Exact incoming comment could not be verified');
  const parent=id(floor.rpid_str??floor.rpid),actualRoot=id(floor.root_str??floor.root)||root,at=stamp(floor.ctime)||noticeAt;
  if(!at||!parent)throw problem('BILI_COMMENT_UNRESOLVED','Exact incoming comment coordinates unavailable');
  const bili={kind:'comment',oid,type,root:actualRoot,parent,...x.bvid?{bvid:x.bvid}:{dynamicId:x.dynamicId}};
  return {id:`bili:comment:${type}:${oid}:${parent}`,kind:'message.received',channel:'bili:public',actorId,text:floor.content.message,at:at*1000,meta:{addressed:true,messageId:parent,senderName:String(x.item.user?.nickname||actorId).slice(0,100),url:x.uri.href,notificationId:x.notificationId,notificationKey:x.notificationKey,notificationKeys:[x.notificationKey],bili}};
 }
 async function comments(c?: any,signal?: any,progress?: any,seen?: any){
  const {events,warnings}=progress;let truncated=false;
  for(const kind of ['reply','at']){
   const status={truncated:false,examined:0};progress.commentSources[kind]=status;
   try{
    const candidates=new Map(),cursors=new Set<any>();let cursor: Record<string, any>={};
    for(let page=0;page<2;page++){
     // Both streams use id + reply_time in the maintained author SDK;
     // cursor.time is not a serialized cursor query parameter.
     const data=await c.request(API,`/x/msgfeed/${kind}`,{platform:'web',build:'0',mobi_app:'web',...cursor});
     if(!Array.isArray(data?.items))throw problem('BILI_RESPONSE','Bili comment inbox unavailable');
     if(data.items.length>30)status.truncated=true;
     for(const item of data.items.slice(0,30)){const x=commentCandidate(item,kind,c,seen);if(x)candidates.set(x.notificationKey,x);}
     if(!data.items.length||data.cursor?.is_end==null||data.cursor.is_end===true||Number(data.cursor.is_end)===1)break;
     const cursorId=id(data.cursor.id),time=stamp(data.cursor.time),key=`${cursorId}:${time}`;
     if(!cursorId||!time||cursors.has(key)||page===1){status.truncated=true;break;}
     cursors.add(key);cursor={id:cursorId,reply_time:String(time)};
    }
    const list=[...candidates.values()],offset=list.length?commentOffsets[kind]%list.length:0,count=Math.min(COMMENTS_PER_SOURCE,list.length);
    if(list.length>count)status.truncated=true;
    // Rotation affects only unconsumed candidates in this live instance. It
    // never claims delivery, persists a watermark or acknowledges platform reads.
    commentOffsets[kind]=list.length?(offset+count)%list.length:0;
    for(let n=0;n<count;n++){
     signal.throwIfAborted();const x=list[(offset+n)%list.length];status.examined++;
     try{events.push(await resolveComment(c,x));}
     catch(error){status.truncated=true;signal.throwIfAborted();warnings.push({phase:'comments.thread',code:knownCode(error)||'comment_unresolved',notificationKey:x.notificationKey});}
    }
   }catch(error){status.truncated=true;signal.throwIfAborted();warnings.push({phase:`comments.${kind}`,code:knownCode(error)||'BILI_UNAVAILABLE'});}
   truncated||=status.truncated;
  }
  return {events,warnings,truncated};
 }
 async function poll({comments:readComments=true,dm=true,dmScope='all',seenNotificationKeys=[],signal}: { comments?: boolean; dm?: boolean; dmScope?: string; seenNotificationKeys?: any[] | Set<string>; signal?: any; [key: string]: any }={}){
  if(!['all','owner'].includes(dmScope))throw problem('BILI_INPUT','Invalid DM scope');
  if(!Array.isArray(seenNotificationKeys)&&!(seenNotificationKeys instanceof Set))throw problem('BILI_INPUT','seenNotificationKeys must be an array or Set');
  const seen=new Set<any>(seenNotificationKeys);
  return operation(signal,async (scoped?: any) =>{
   const c=await client(scoped),result={events:[],peers:[],selfId:c.selfId,truncated:false,warnings:[],commentSources:{}};
   try{
   if(readComments){const r=await comments(c,scoped,result,seen);result.truncated||=r.truncated;}
   if(dm){
    let all;
    try{all=(await sessions(c)).filter((s)=>human(s.talker_id)&&id(s.talker_id)!==c.selfId&&Number(s.session_type??1)===1&&(dmScope!=='owner'||id(s.talker_id)===id(c.cfg.owner?.mid))).sort((a?: any,b?: any)=>Number(Number(b.unread_count)>0)-Number(Number(a.unread_count)>0)||stamp(b.last_msg?.timestamp)-stamp(a.last_msg?.timestamp));}
    catch(error){scoped.throwIfAborted();result.truncated=true;result.warnings.push({phase:'dm.sessions',code:knownCode(error)||'BILI_UNAVAILABLE'});all=[];}
    if(all.length>MAX_PEERS)result.truncated=true;
    for(const s of all.slice(0,MAX_PEERS)){
     const peerId=id(s.talker_id),peer={peerId,truncated:false},keys=new Set<any>();let begin='0';result.peers.push(peer);
     try{
     for(let page=0;page<MAX_PAGES;page++){
      const data=await c.request(IM,'/svr_sync/v1/svr_sync/fetch_session_msgs',c.signed({talker_id:peerId,session_type:1,size:PAGE_SIZE,begin_seqno:begin}));
      if(!Array.isArray(data?.messages))throw problem('BILI_RESPONSE','Bili private history unavailable');
      const messages=data.messages.slice(0,PAGE_SIZE);if(data.messages.length>PAGE_SIZE)peer.truncated=true;
      let oldest;
      for(const m of messages){
       const seq=id(m.msg_seqno);if(seq&&(!oldest||BigInt(seq)<BigInt(oldest)))oldest=seq;
       const msgKey=id(m.msg_key),key=msgKey||seq;if(!key||keys.has(key))continue;keys.add(key);
       if(id(m.sender_uid)!==peerId||id(m.receiver_id)!==c.selfId||Number(m.receiver_type??1)!==1||Number(m.msg_status??0)!==0)continue;
       const type=Number(m.msg_type),share=type===7?videoCard(m.content):undefined;
       const text=type===1?messageText(m.content):share?`分享的视频卡片（不是观看记录）\n链接：${share.url}\n卡片标题（外部数据）：${JSON.stringify(share.title)}`:'';
       const at=stamp(m.timestamp);if(!text.trim()||text.length>10000||!at)continue;
       result.events.push({id:`bili:dm:${c.selfId}:${peerId}:${msgKey?'key':'seq'}:${key}`,kind:'message.received',channel:`bili:dm:${peerId}`,actorId:peerId,text,at:at*1000,meta:{addressed:true,messageId:key,senderName:String(s.account_info?.name||peerId).slice(0,100),bili:{kind:'dm',peerId,msgKey:msgKey||null,seqno:seq||null,...share?{share}:{}}}});
      }
      if(data.has_more==null&&messages.length===PAGE_SIZE)peer.truncated=true;
      if(!Number(data.has_more))break;
      if(!oldest||oldest===begin||page===MAX_PAGES-1){peer.truncated=true;break;}begin=oldest;
     }
     }catch(error){peer.truncated=true;scoped.throwIfAborted();result.warnings.push({phase:'dm.history',code:knownCode(error)||'BILI_UNAVAILABLE'});}
     result.truncated||=peer.truncated;
    }
   }
   }catch(error){
    if(!scoped.aborted||signal?.aborted||closed)throw error;
    result.truncated=true;result.warnings.push({phase:'deadline',code:'BILI_CANCELLED'});
   }
   const unique=new Map();for(const e of result.events){const prior=unique.get(e.id);if(prior?.meta.notificationKeys&&e.meta.notificationKeys)prior.meta.notificationKeys=[...new Set<any>([...prior.meta.notificationKeys,...e.meta.notificationKeys])];else unique.set(e.id,e);}
   result.events=[...unique.values()].sort((a?: any,b?: any)=>a.at-b.at||a.id.localeCompare(b.id));return result;
  });
 }
 async function sendDM({peerId,text,expectedMsgKey,expectedSeqno,beforeSend,signal}: { peerId?: any; text?: any; expectedMsgKey?: any; expectedSeqno?: any; beforeSend?: any; signal?: any; [key: string]: any }={}){
  let attempted=false;
  try{
  if(!human(peerId)||typeof text!=='string'||!text.trim()||[...text].length>200||text.includes('\0'))throw problem('BILI_INPUT','Invalid DM peer or text (maximum 200 characters)');
  if((expectedMsgKey!=null&&!id(expectedMsgKey))||(beforeSend!=null&&typeof beforeSend!=='function'))throw problem('BILI_INPUT','Invalid trusted DM preflight contract');
  return await operation(signal,async (scoped?: any) =>{
   const c=await client(scoped);if(peerId===c.selfId)throw problem('BILI_INPUT','Cannot send DM to self');
   const s=(await sessions(c)).find((s)=>id(s.talker_id)===peerId&&Number(s.session_type??1)===1),last=s?.last_msg,age=now()/1000-stamp(last?.timestamp);
   if(!last||id(last.sender_uid)!==peerId||id(last.receiver_id)!==c.selfId||Number(last.receiver_type??1)!==1||Number(last.msg_status??0)!==0||age<0||age>48*3600)throw problem('BILI_DM_GATE','DM reply requires the peer to be the latest sender within 48 hours');
   if(expectedMsgKey!=null&&id(last.msg_key)!==id(expectedMsgKey))throw problem('BILI_DM_GATE','DM context changed; read the latest incoming message before replying');
   if(expectedMsgKey==null&&id(expectedSeqno)&&id(last.msg_seqno)&&id(expectedSeqno)!==id(last.msg_seqno))throw problem('BILI_DM_GATE','DM context changed; read the latest incoming message before replying');
   const devId=randomUUID().toUpperCase(),body=new URLSearchParams({'msg[sender_uid]':c.selfId,'msg[receiver_id]':peerId,'msg[receiver_type]':'1','msg[msg_type]':'1','msg[msg_status]':'0','msg[timestamp]':String(Math.floor(now()/1000)),'msg[dev_id]':devId,'msg[new_face_version]':'1','msg[content]':JSON.stringify({content:text}),csrf:c.cred.bili_jct,csrf_token:c.cred.bili_jct,build:'0',mobi_app:'web'});
   // Exactly one POST. Any missing/ambiguous receipt remains uncertain forever
   // unless the host explicitly reconciles it; this adapter never retries.
   const params=c.signed({w_sender_uid:c.selfId,w_receiver_id:peerId,w_dev_id:devId});
   // Host-only reservation hook: failed reads/gates never reserve daily quota.
   // Cancellation while reserving still precedes the sole POST and is certain.
   await beforeSend?.({signal:scoped});scoped.throwIfAborted();
   attempted=true;
   try{const data=await c.request(IM,'/web_im/v1/web_im/send_msg',params,body.toString());const messageId=id(data?.msg_key);if(!messageId)throw Error('Missing server message id');return {status:'confirmed',kind:'dm',id:messageId};}
   catch(error){
    const diagnostics=error?.code==='BILI_API'?{apiCode:error.apiCode,endpoint:error.endpoint}:{};
    throw Object.assign(problem('SEND_UNCERTAIN',`Bili DM outcome uncertain${diagnostics.apiCode!=null?` (API code ${diagnostics.apiCode})`:''}; inspect the conversation before deliberate recovery`),diagnostics);
   }
  });
  }catch(error){error.deliveryState=attempted?'unknown':'not_sent';throw error;}
 }
 return {poll,sendDM,close(){closed=true;for(const c of active)c.abort();}};
}
