// Modified for Chopsticks on 2026-11-05; see NOTICE.md for upstream attribution.
// Protocol reference: Sakura520222/xhh-workshop, GPL-3.0-only,
// 3f1ca9aee836691f134a2c744ff64fe6f3534ef6, crates/xhh-core/src/api/{post,comment,interaction}.rs.
// Uses an existing official website session; never synthesizes device/risk tokens.
import {heyboxTime} from './dm.mjs';
const id = (value) => (typeof value!=='number'||Number.isSafeInteger(value))&&/^\d{1,32}$/.test(String(value ?? '')) ? String(value) : '';
const actor = (row) => id(row?.userid ?? row?.user?.userid ?? row?.user?.heybox_id);
const postId = (row) => id(row?.linkid ?? row?.link_id);
const commentId = (row) => id(row?.commentid ?? row?.comment_id);
const textOf = (row) => String(row?.text ?? '');
const failed = (state?: any,code?: any) => ({confirmed:false,state,code});
const unknown = () => failed('unknown','unverified_receipt');
function comments(tree?: any) {
 return (tree?.comments ?? []).flatMap((group)=>{
  const rows=Array.isArray(group?.comment)?group.comment:[];
  const rootId=commentId(rows[0]);
  return rows.map((row)=>({row,rootId}));
 });
}
function publishedText(row?: any) {
 const value=textOf(row);
 try {const blocks=JSON.parse(value);if(Array.isArray(blocks)&&blocks.every((b)=>b.type==='text'&&typeof b.text==='string'))return blocks.map((b)=>b.text).join('');}catch{}
 // The website's tree endpoint also returns plain text or paragraph HTML.
 return value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>\s*<p[^>]*>/gi,'\n').replace(/^<p[^>]*>|<\/p>$/gi,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
}
export function createHeyboxWriter({load,status,request,result,isClosed}: { load?: any; status?: any; request?: any; result?: any; isClosed?: any; [key: string]: any }) {
 let busy=false;
 return async function write({action,targetId,parentId,text,intentId,context={},signal}: { action?: any; targetId?: any; parentId?: any; text?: any; intentId?: any; context?: Record<string, any>; signal?: any; [key: string]: any }={}) {
  if(!['like','comment','reply','publish'].includes(action))return failed('unsupported','action_unsupported');
  if(busy)return failed('refused','write_busy');
  if(isClosed()||signal?.aborted)return failed('refused','cancelled');
  if(typeof intentId!=='string'||!intentId||intentId.length>256||
    (action==='publish'?targetId!=='own-public':!id(targetId))||
    (action!=='like'&&(typeof text!=='string'||!text.trim()||text.length>4000))||
    (action==='reply'&&!id(parentId)))return failed('refused','invalid_input');
  busy=true;let submitted=false,accepted=false,receiptId;
  const uncertain=(code?: string)=>({...unknown(),...(receiptId?{receiptId}:{}),...(code?{code}: {})});
  try {
   const auth=await load();if(!auth)return failed('login_required','login_required');
   if(!auth.cookies.x_xhh_tokenid)return failed('login_required','web_session_required');
   const identity=await status({signal});if(identity.state!=='ready')return failed(identity.state==='verification_required'?'verification_required':'login_required',identity.code||'identity_unverified');
   const accountId=id(identity.accountId);if(!accountId||(context.accountId&&String(context.accountId)!==accountId))return failed('refused','account_mismatch');
   const getTree=async (link?: any) =>result(await request('/bbs/app/link/tree',{link_id:link,offset:'0',limit:'50'},auth.cookies,false,signal));
   let rootId='-1';
   if(action!=='publish') {
    const before=await getTree(targetId);if(postId(before.link)!==targetId)return failed('refused','target_unverified');
    if(action==='like'&&[true,1,'1'].includes(before.link.is_award_link))return failed('refused','already_liked');
    if(action==='like'&&![false,0,'0'].includes(before.link.is_award_link))return failed('refused','like_state_unverified');
    if(action==='reply') {
     const parent=comments(before).find((x)=>commentId(x.row)===parentId);
     if(!parent?.rootId)return failed('refused','parent_unverified');
     rootId=parent.rootId;
    }
   }
   let path,body;
   if(action==='like'){path='/bbs/app/profile/award/link';body={link_id:targetId,award_type:'1'};}
   else if(action==='publish') {
    const title=String(context.title ?? text.split(/\r?\n/).find((x)=>x.trim()) ?? '').trim();
    if(!title|| (context.title!=null&&[...title].length>30))return failed('refused','invalid_title');
    path='/bbs/app/api/link/post';body={title:[...title].slice(0,30).join(''),text:JSON.stringify([{type:'text',text}]),desc:'',post_type:'1',view_limit:'1',link_tag:'28',topic_ids:'58144',post_card_ids:'',hashtags:'',original:'1',declaration:'1',extra_declaration:'0'};
   } else {path='/bbs/app/comment/create';body={link_id:targetId,text,root_id:rootId,reply_id:action==='reply'?parentId:'-1',is_cy:'0'};}
   if(isClosed()||signal?.aborted)return failed('refused','cancelled');
   submitted=true;
   const response=await request(path,{},auth.cookies,false,signal,{method:'POST',body,workshop:true});
   const payload=response?.payload, value=result(response);accepted=true;
   const platformId=action==='like'?targetId:action==='publish'?id(payload?.link_id??value.link_id):id(payload?.commentid??value.commentid??value.comment_id);
   receiptId=action==='like'?undefined:platformId;
   if(!platformId)return uncertain();
   const tree=await getTree(action==='publish'?platformId:targetId);
   if(postId(tree.link)!==(action==='publish'?platformId:targetId))return uncertain();
   if(action==='like'&&![true,1,'1'].includes(tree.link.is_award_link))return uncertain();
   if(action==='publish'&&(actor(tree.link)!==accountId||publishedText(tree.link)!==text))return uncertain();
   if(action==='comment'||action==='reply') {
    const created=comments(tree).find((x)=>commentId(x.row)===platformId);
    if(!created||actor(created.row)!==accountId||textOf(created.row)!==text)return uncertain();
    if(action==='reply'&&(created.rootId!==rootId||(created.row.reply_id!=null&&String(created.row.reply_id)!==parentId)))return uncertain();
    if(action==='comment'&&created.rootId!==platformId)return uncertain();
   }
   const after=await status({signal});if(after.state!=='ready'||after.accountId!==accountId||isClosed()||signal?.aborted)return uncertain();
   return {confirmed:true,platformId,targetId,accountId,visibility:'public'};
  } catch(e) {
   if(submitted){
    if(!accepted&&e.platformRejection)return failed(e.message,e.message);
    return uncertain(accepted&&['login_required','verification_required'].includes(e.message)?`readback_${e.message}`:undefined);
   }
   return failed(['login_required','verification_required'].includes(e.message)?e.message:'refused',['login_required','verification_required','cancelled'].includes(e.message)?e.message:'preflight_failed');
  } finally {busy=false;}
 };
}

export function normalizeHeyboxNotifications(value?: any,limit?: any,offset?: any) {
 const rows=value?.messages??value?.entries;
 if(!Array.isArray(rows))return {items:[],truncated:false,warnings:['unexpected_response']};
 const items=[],warnings=[];
 for(const row of rows) {
  const key=id(row.message_id),targetId=id(row.linkid??row.link?.linkid??row.link?.link_id),parentId=id(row.comment_a_id),actorId=id(row.userid_a??row.user_a?.userid??row.user_a?.heybox_id);
  if(!key||!targetId||!parentId||!actorId){warnings.push('notification_missing_route');continue;}
  const at=heyboxTime(row.timestamp??row.create_time??row.created_at??row.create_at);
  items.push({id:key,targetId,parentId,...id(row.root_comment_id)?{rootId:id(row.root_comment_id)}:{},actorId,text:String(row.comment_a_text??row.text??''),kind:'comment',visibility:'public',...(at!==undefined?{at}:{})});
 }
 return {items:items.slice(0,limit),...(rows.length>=limit?{cursor:String(offset+rows.length)}:{}),truncated:rows.length>=limit,warnings:[...new Set<any>(warnings)]};
}
