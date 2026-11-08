// Modified for Chopsticks on 2026-11-05; see NOTICE.md for upstream attribution.
// Client protocol reference: advent259141/astrbot_plugin_xiaoheihe_adapter
// 534b9479e9bebe4ef82d9ec959d0c11146c90078 (Apache-2.0), xhh_client.py.
// Narrow independent integration; server acknowledgements must match readback.
import {randomInt} from 'node:crypto';
const id=(x)=>(typeof x!=='number'||Number.isSafeInteger(x))&&/^\d{1,32}$/.test(String(x??''))?String(x):'';
const sender=(x)=>id(x?.sender_id??x?.from_user_id??x?.sender?.user_id??x?.sender_info?.user_id??x?.user?.userid);
const seq=(x)=>id(x?.seq??x?.msg_seq??x?.sequence);
const rawId=(x)=>id(x?.msg_id??x?.message_id??x?.id);
const messageId=(x?: any,peer?: any)=>rawId(x)||(seq(x)?`${peer}:${seq(x)}`:'');
const text=(x)=>String(x?.content??x?.msg??x?.text??'');
const empty=(warning)=>({items:[],truncated:false,warnings:[warning]});
const refusal=(code)=>({confirmed:false,state:'refused',code});
const unknown=(code: string='unverified_receipt')=>({confirmed:false,state:'unknown',code});
function protocolCode(value?: any){
 const raw=value?.heybox__protocol__execute__directly;if(typeof raw!=='string'||!raw)return;
 if(raw.length>4096)return 'client_action_required';let protocol=raw;try{protocol=decodeURIComponent(raw);}catch{}
 // Server hints are diagnostic data only. Never return or execute their URL.
 return /web_auth|name_verify/i.test(protocol)?'verification_required':'client_action_required';
}
export function heyboxTime(value?: any) {
 if(value===undefined||value===null||value==='')return undefined;
 const n=Number(value);
 if(Number.isFinite(n)&&n>0){const ms=n<1e11?n*1000:n;return Number.isSafeInteger(ms)?ms:undefined;}
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)){const ms=Date.parse(value);return Number.isFinite(ms)?ms:undefined;}
 return undefined;
}
function participants(value?: any,account?: any,peer?: any) {
 return id(value?.sender_info?.user_id)===account&&id(value?.recipient_info?.user_id)===peer&&Array.isArray(value?.list);
}
export function createHeyboxDirectMessages({load,status,request,result,isClosed}: { load?: any; status?: any; request?: any; result?: any; isClosed?: any; [key: string]: any }) {
 const get=async(auth?: any,peer?: any,limit?: any,signal?: any,cursor?: any)=>result(await request('/chatroom/v2/msg/user',{to_user_id:peer,offset:'0',limit:String(limit),...(id(cursor)?{seq:id(cursor)}:{})},auth.cookies,false,signal));
 async function discover({limit=20,cursor,signal}: { limit?: number; cursor?: any; signal?: any; [key: string]: any }={}) {
  try {
   const auth=await load();if(!auth)return empty('login_required');
   const identity=await status({signal});if(identity.state!=='ready')return empty('identity_unverified');
   const n=Math.max(1,Math.min(50,Number(limit)||20)),offset=/^\d{1,9}$/.test(String(cursor??''))?Number(cursor):0;
   const value=result(await request('/bbs/app/user/message',{list_type:'2',offset:String(offset),limit:String(n)},auth.cookies,false,signal));
   if(!Array.isArray(value.messages))return empty('discovery_unexpected_response');
   const peers=[...new Set<any>(value.messages.filter((x)=>x.entry==='message').map((x)=>id(x.user_a?.userid??x.user_a?.user_id??x.user?.userid??x.recipient_info?.user_id??x.to_user_id??x.user_id??x.userid??x.message_id)).filter((x)=>x&&x!==identity.accountId))];
   return {items:[],peers,...(value.messages.length>=n?{cursor:String(offset+value.messages.length)}:{}),truncated:value.messages.length>=n,warnings:[]};
  }catch(e){return empty(['login_required','verification_required','cancelled'].includes(e.message)?e.message:'discovery_failed');}
 }
 async function read({id:peer,limit=20,cursor,context={},signal}: { id?: any; limit?: number; cursor?: any; context?: Record<string, any>; signal?: any; [key: string]: any }={}) {
  if(!peer&&context.sourceActor)peer=String(context.sourceActor);
  if(!peer)return discover({limit,cursor,signal});
  if(!id(peer))return empty('peer_required');
  if(context.sourceActor&&String(context.sourceActor)!==peer)return empty('peer_mismatch');
  try {
   const auth=await load();if(!auth)return empty('login_required');
   const identity=await status({signal});if(identity.state!=='ready')return empty('identity_unverified');
   const n=Math.max(1,Math.min(50,Number(limit)||20)),value=await get(auth,peer,n,signal,cursor);
   if(!participants(value,identity.accountId,peer))return empty('participants_unverified');
   const items=[],warnings=[];
   for(const row of value.list) {
    const key=messageId(row,peer),actorId=sender(row);
    if(!key||![peer,identity.accountId].includes(actorId)){warnings.push('message_missing_identity');continue;}
    const at=heyboxTime(row.send_time??row.timestamp??row.time??row.create_time??row.created_at);
    items.push({id:key,targetId:peer,actorId,text:text(row),kind:'message',visibility:'private',fromSelf:actorId===identity.accountId,...seq(row)?{sequence:seq(row)}:{},...(at!==undefined?{at}:{})});
   }
   const last=seq(value.list.at(-1));
   return {items:items.slice(0,n),...(value.list.length>=n&&last?{cursor:last}:{}),truncated:value.list.length>=n,warnings:[...new Set<any>(warnings)]};
  }catch(e){return empty(['login_required','verification_required','cancelled'].includes(e.message)?e.message:'read_failed');}
 }
 async function write({targetId:peer,text:content,intentId,context={},signal}: { targetId?: any; text?: any; intentId?: any; context?: Record<string, any>; signal?: any; [key: string]: any }={}) {
  if(!id(peer)||typeof content!=='string'||!content.trim()||content.length>4000||typeof intentId!=='string'||!intentId)return refusal('invalid_input');
  if(context.sourceActor&&String(context.sourceActor)!==peer)return refusal('peer_mismatch');
  if(isClosed()||signal?.aborted)return refusal('cancelled');
  let submitted=false,phase='auth_load';
  try {
   const auth=await load();if(!auth)return {confirmed:false,state:'login_required',code:'login_required'};
   phase='identity_before';const identity=await status({signal}),accountId=identity.accountId;
   if(identity.state!=='ready')return {confirmed:false,state:'login_required',code:'identity_unverified'};
   if(context.accountId&&String(context.accountId)!==accountId)return refusal('account_mismatch');
   phase='history_before';const before=await get(auth,peer,50,signal);
   if(!participants(before,accountId,peer))return refusal('participants_unverified');
   const previous=new Set<any>(before.list.map((x)=>messageId(x,peer)).filter(Boolean));
   if(isClosed()||signal?.aborted)return refusal('cancelled');
   const submittedAt=Date.now();submitted=true;phase='submit';
   const value=result(await request('/chatroom/v2/msg/user',{to_user_id:peer},auth.cookies,false,signal,{method:'POST',body:{heybox_ack_id:String(randomInt(1,1_000_000_000)),img:'',msg:content,msg_type:'6'}}));
   const instruction=protocolCode(value);if(instruction){let hint=String(value.heybox__protocol__execute__directly||'').slice(0,4096);try{hint=decodeURIComponent(hint);}catch{}return {...unknown(instruction),diagnostic:{phase,source:'client_protocol',hint:/name_verify/i.test(hint)?'name_verify':/web_auth/i.test(hint)?'web_auth':'other'}};}
   // An echoed heybox_ack_id is client-generated and is never a receipt.
   const serverId=id(value.msg_id),serverSeq=id(value.msg_seq),serverAck=id(value.heychat_ack_id);
   if(!serverId&&!serverSeq&&!serverAck)return unknown('server_ack_missing');
   phase='history_after';const after=await get(auth,peer,50,signal);if(!participants(after,accountId,peer))return unknown('readback_participants_unverified');
   const readbackAt=Date.now(),priorSequence=before.list.reduce((max?: any,row?: any)=>seq(row)&&BigInt(seq(row))>max?BigInt(seq(row)):max,0n);
   // heychat_ack_id acknowledges submission, but need not be a history seq.
   // In that case require a unique new own message in this submission window.
   const matches=after.list.filter((row)=>{
    if(previous.has(messageId(row,peer))||!messageId(row,peer)||sender(row)!==accountId||text(row)!==content)return false;
    if(serverId)return rawId(row)===serverId;if(serverSeq)return seq(row)===serverSeq;
    const at=heyboxTime(row.send_time??row.timestamp??row.time??row.create_time??row.created_at);
    return !!serverAck&&!!seq(row)&&BigInt(seq(row))>priorSequence&&Number.isFinite(at)&&at>=submittedAt-1000&&at<=readbackAt+1000;
   });
   const found=matches.length===1?matches[0]:undefined;
   if(!found)return unknown('readback_unverified');
   phase='identity_after';const current=await status({signal});if(current.state!=='ready'||current.accountId!==accountId||isClosed()||signal?.aborted)return unknown();
   return {confirmed:true,platformId:messageId(found,peer),targetId:peer,accountId,visibility:'private'};
  }catch(e) {const code=['verification_required','login_required','api_error'].includes(e?.message)?e.message:'send_response_unavailable';return {...(submitted?unknown(code):refusal('preflight_failed')),diagnostic:{phase,source:'exception',code}};}
 }
 return {read,write};
}
