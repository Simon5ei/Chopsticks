import {stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {guardedSubmit} from './write-guard.mjs';
import {decodeImRequest,decodeImResponse} from './im-wire.mjs';
import {controlSummary,waitForControlAttachment} from './publish-diagnostics.mjs';
import {fetchDiagnosticProfile} from './dm-diagnostics.mjs';
export {publisherDiagnostics} from './publish-diagnostics.mjs';
const id=(x)=>typeof x==='string'&&/^\d{6,30}$/.test(x)?x:'';
const refused=(code)=>({confirmed:false,state:'refused',code});
const uncertain=()=>({confirmed:false,state:'uncertain',code:'UNVERIFIED_RECEIPT'});
const controlRefusal=(phase?: any,control?: any)=>({...refused('CONTROL_NOT_UNIQUE'),deliveryState:'not_sent',submitted:false,phase,control});
const match=(r?: any,host?: any,path?: any)=>{try{const u=new URL(r.url());return u.hostname===host&&u.pathname.replace(/\/$/,'')===path.replace(/\/$/,'');}catch{return false;}};
async function unique(control?: any){return await control.count()===1&&await control.isVisible();}
async function navigateData(p?: any,url?: any,path?: any){const pending=p.waitForResponse((r)=>match(r,'www.douyin.com',path),{timeout:15000});pending.catch(()=>{});await p.goto(url,{waitUntil:'domcontentloaded'});return (await pending).json();}
function validConversation(value?: any,account?: any,target?: any){const m=typeof value==='string'?value.split(':'):[];return m.length===4&&m[0]==='0'&&m[1]==='1'&&m.slice(2).includes(account)&&m.slice(2).includes(target);}
function validPeer(request?: any,account?: any,target?: any,text?: any,expected?: any){return request.conversationType===1&&validConversation(request.conversationId,account,target)&&(expected===undefined||request.conversationId===expected)&&request.text===text&&!!request.clientMessageId;}
function commentRequest(request?: any,target?: any,parent?: any,text?: any){const u=new URL(request.url()),body=new URLSearchParams(request.postData()||'');const values=(k)=>[...u.searchParams.getAll(k),...body.getAll(k)];const targetValues=[...values('aweme_id'),...values('item_id')];const parents=values('reply_to_reply_id').filter((x)=>x!=='0');const p=parents.length?parents:values('reply_id');return targetValues.length>0&&targetValues.every((x)=>x===target)&&p.length>0&&p.every((x)=>x===parent)&&values('text').length===1&&values('text')[0]===text;}

// Production inbox rows are marked data-e2e="conversation-item" with the peer name
// inside .conversationConversationItemtitle; the older class-only selector is kept
// as a fallback. Matching is read-only: title first, then a plain text match.
export const CONVERSATION_ROWS='[data-e2e="conversation-item"], [class*="conversationConversationItemwrapper"]';
export function conversationRowLocator(p?: any){return p.locator(CONVERSATION_ROWS).filter({visible:true});}
export function titledPeerLocator(p?: any,nickname?: any){return conversationRowLocator(p).filter({has:p.locator('.conversationConversationItemtitle').getByText(nickname,{exact:true})});}
// Peer rows may be virtualized or the list may not scroll to the target on its
// own. Search the panel by nickname before declaring the peer invisible; this is
// a read-only filter, never a send.
export async function locatePeerConversation({p,nickname,initialMs=1200,settleMs=5000}: { p?: any; nickname?: any; initialMs?: number; settleMs?: number }){
 const matches=async()=>{const titled=titledPeerLocator(p,nickname);if(await titled.count())return titled;return conversationRowLocator(p).filter({hasText:nickname});};
 let rows=await matches();
 try{await rows.first().waitFor({state:'visible',timeout:initialMs});}catch{}
 if(await rows.count())return {found:true,searched:false,rows};
 // A cold page renders the conversation list a few seconds after the panel opens.
 // Wait for any row before spending the search round-trip.
 try{await conversationRowLocator(p).first().waitFor({state:'visible',timeout:8000});}catch{}
 rows=await matches();
 if(await rows.count())return {found:true,searched:false,rows};
 const search=p.locator('[data-e2e="im-search-input"], input[placeholder*="搜索"]').first();
 try{if(await search.count()===1&&await search.isVisible()){await search.fill(nickname);await p.waitForTimeout(600);}}catch{}
 rows=await matches();
 try{await rows.first().waitFor({state:'visible',timeout:settleMs});}catch{
  // The panel can render the peer's name outside the row wrappers (virtualized or
  // nested layout). Accept a single, visible exact text match as the peer.
  try{const text=p.getByText(nickname,{exact:true}).filter({visible:true});const n=await text.count();if(n){let index=-1;try{index=await text.evaluateAll((els, name)=>els.findIndex((el)=>String(el.textContent||'').trim()===name&&!!el.closest('[class*="conversation"],[data-e2e*="conversation"]')),nickname);}catch{}if(index>=0)return {found:true,searched:true,count:1,rows:text.nth(index),viaText:true};if(n===1)return {found:true,searched:true,count:1,rows:text,viaText:true};}}catch{}
  const legacy=await p.locator('[class*="conversationConversationItemwrapper"]').count().catch(()=>0),e2e=await p.locator('[data-e2e="conversation-item"]').count().catch(()=>0);
  let textMatches=-1;try{textMatches=await p.getByText(nickname,{exact:true}).filter({visible:true}).count();}catch{}
  return {found:false,searched:true,count:0,rows,evidence:{legacy,e2e,textMatches}};}
 const count=await rows.count();return {found:count>0,searched:true,count,rows};
}
export async function advancedWrite({p,input,identity,receipts,report}: { p?: any; input?: any; identity?: any; receipts?: any; report?: any; [key: string]: any }) {
  const {action,targetId,parentId,text,context={}}=input;let attempted=false,accepted,dmPhase='IDENTITY';
  try {
    if(typeof text!=='string'||!text.trim())return refused('INVALID_INPUT');
    const account=id(await identity(p));if(!account)return {confirmed:false,state:'login_required',code:'LOGIN_REQUIRED'};
    if(action==='reply') {
      if(!id(targetId)||!id(parentId)||text.length>500)return refused('INVALID_INPUT');
      const comments=[],tasks=[];const onResponse=(r)=>{if(match(r,'www.douyin.com','/aweme/v1/web/comment/list/')||match(r,'www.douyin.com','/aweme/v1/web/comment/list/reply/'))tasks.push(r.json().then((d)=>{if(d.status_code===0)comments.push(...(d.comments||[]));}).catch(()=>{}));};
      p.on('response',onResponse);let detail;
      try{detail=await navigateData(p,`https://www.douyin.com/video/${targetId}`,'/aweme/v1/web/aweme/detail/');await p.waitForTimeout(1500);await Promise.all(tasks);}finally{p.off('response',onResponse);}
      if(detail?.status_code!==0||id(detail.aweme_detail?.aweme_id)!==targetId)return refused('TARGET_UNVERIFIED');
      const candidates=comments.flatMap((c)=>[c,...(c.reply_comment||[])]).filter((c)=>id(c.cid)===parentId&&id(c.aweme_id)===targetId);
      const parent=candidates[0];if(!parent||candidates.some((c)=>c.text!==parent.text)||typeof parent.text!=='string'||!parent.text)return refused('PARENT_NOT_VISIBLE');
      let row=p.locator('[data-e2e="comment-item"]').filter({hasText:parent.text});
      if(/^MS4w[A-Za-z0-9_-]{8,200}$/.test(parent.user?.sec_uid||''))row=row.filter({has:p.locator(`a[href*="/user/${parent.user.sec_uid}"]`)});
      if(!await unique(row))return refused('PARENT_NOT_UNIQUE');
      const reply=row.getByText('回复',{exact:true});if(!await unique(reply))return refused('CONTROL_NOT_UNIQUE');await reply.click();
      const editor=p.locator('[data-e2e="comment-input"][contenteditable="true"], div[contenteditable="true"][data-e2e*="comment"], textarea[data-e2e="comment-input"]');
      if(!await unique(editor))return refused('CONTROL_NOT_UNIQUE');await editor.fill(text);
      const result=await guardedSubmit({page:p,host:'www.douyin.com',path:'/aweme/v1/web/comment/publish/',validate:async (r?: any) =>commentRequest(r,targetId,parentId,text)&&await identity(p)===account,submit:async()=>{attempted=true;await p.keyboard.press('Enter');}});
      if(result.blocked)return refused('REQUEST_BINDING_MISMATCH');if(!result.response)return uncertain();
      const data=await result.response.json();if(await identity(p)!==account)return uncertain();return receipts.comment(data,{targetId,accountId:account,parentId});
    }
    if(action==='dm') {
      if(context.accountId!==undefined&&id(context.accountId)!==account)return refused('ACCOUNT_CHANGED');
      if(!id(targetId)||targetId===account||text.length>1000||!/^MS4w[A-Za-z0-9_-]{8,200}$/.test(context.secUid||''))return refused('PEER_PROFILE_REQUIRED');
      if(context.conversationId!==undefined&&!validConversation(context.conversationId,account,targetId))return refused('TARGET_UNVERIFIED');
      // Keep the existing authenticated page; profile verification is a bounded
      // read-only API call, not two expensive page loads before every DM.
      dmPhase='PROFILE';let home=false;try{const u=new URL(p.url());home=u.origin==='https://www.douyin.com'&&['/','/jingxuan'].includes(u.pathname);}catch{}
      if(!home)await p.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded',timeout:10000});
      const data=await p.evaluate(fetchDiagnosticProfile,`https://www.douyin.com/aweme/v1/web/user/profile/other/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=${context.secUid}`);
      if(data?.status_code!==0||id(data.user?.uid)!==targetId||data.user.sec_uid!==context.secUid)return refused('TARGET_UNVERIFIED');
      // Wait for the actual conversation row. A cached IM panel need not issue
      // another initialization request; that request is not send authorization.
      if(!await conversationRowLocator(p).count()){
        dmPhase='IM_ENTRY';
        const entry=p.locator('[data-e2e="im-entry"]');await entry.waitFor({state:'visible',timeout:15000});
        if(!await unique(entry))return refused('CONTROL_NOT_UNIQUE');await entry.click();
      }
      const editor=p.locator('[data-e2e="msg-input"] .editor-kit-container[contenteditable="true"]');
      if(typeof data.user.nickname!=='string'||!data.user.nickname){try{await report?.({evt:'dm_peer_miss',branch:'no_nickname',statusCode:data?.status_code});}catch{}return refused('PEER_NAME_MISSING');}
      dmPhase='PEER';const located=await locatePeerConversation({p,nickname:data.user.nickname});
      if(!located.found){try{await report?.({evt:'dm_peer_miss',branch:'rows',searched:located.searched===true,...(located.evidence?{legacy:located.evidence.legacy,e2e:located.evidence.e2e,textMatches:located.evidence.textMatches}:{})});}catch{}return {...refused('PEER_NOT_VISIBLE'),...(located.evidence?{rows:located.evidence}:{})};}
      const conversation=located.rows;if(!await unique(conversation))return refused('PEER_NOT_UNIQUE');await conversation.click();
      dmPhase='EDITOR';await editor.waitFor({state:'visible',timeout:10000});
      if(!await unique(editor))return refused('CONTROL_NOT_UNIQUE');await editor.fill(text);
      const result=await guardedSubmit({page:p,host:'imapi.douyin.com',path:'/v1/message/send',validate:async (r?: any) =>validPeer(decodeImRequest(r.postDataBuffer()),account,targetId,text,context.conversationId)&&await identity(p)===account,submit:async()=>{attempted=true;await p.keyboard.press('Enter');}});
      if(result.blocked)return refused('REQUEST_BINDING_MISMATCH');if(!result.response)return uncertain();
      const proof=decodeImResponse(await result.response.body());if(proof.checkCode!=='0')return uncertain();
      return receipts.dm({...proof,request:decodeImRequest(result.request.postDataBuffer()),accountBefore:account,accountAfter:await identity(p)},{targetId,accountId:account,text});
    }
    if(action==='publish') {
      if(context.accountId!==undefined&&id(context.accountId)!==account)return refused('ACCOUNT_CHANGED');
      if(targetId!=='own-public'||text.length>8000)return refused('INVALID_INPUT');
      const article=context.format==='article',title=context.title||'',media=article?[{path:context.coverPath}]:context.media;
      if(typeof title!=='string'||title.length>30||(article&&(!title.trim()||text.trim().length<100)))return refused('ARTICLE_TITLE_OR_LENGTH');
      if(!Array.isArray(media)||!media.length||media.length>35)return refused('MEDIA_REQUIRED');
      const paths=[];for(const m of media){if(typeof m?.path!=='string'||!isAbsolute(m.path)||! /\.(?:png|jpe?g|webp|bmp)$/i.test(m.path))return refused('INVALID_MEDIA');const info=await stat(m.path);if(!info.isFile()||info.size>50*1024*1024)return refused('INVALID_MEDIA');paths.push(m.path);}
      await p.goto(article?'https://creator.douyin.com/creator-micro/content/post/article?default-tab=5&enter_from=publish_page&media_type=article&type=new':'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',{waitUntil:'domcontentloaded'});
      if(article){const chooser=p.waitForEvent('filechooser',{timeout:10000});chooser.catch(()=>{});await p.getByText('点击上传封面图',{exact:true}).click();await(await chooser).setFiles(paths);}
      else {const upload=p.locator('input[type="file"][accept*="image"]'),attached=await waitForControlAttachment(upload),control=await controlSummary(upload);if(!attached||control.count!==1)return controlRefusal('publish_upload_control',control);await upload.setInputFiles(paths);}
      const editor=p.locator(article?'.tiptap.ProseMirror[contenteditable="true"]':'[contenteditable="true"]');await editor.waitFor({state:'visible',timeout:30000});
      const editorControl=await controlSummary(editor);if(editorControl.count!==1||editorControl.visibleCount!==1)return controlRefusal('publish_editor_control',editorControl);await editor.fill(text);
      if(title){const titleInput=p.getByPlaceholder(article?'请输入文章标题，最多不超过30个字':'填写作品标题，为作品获得更多流量',{exact:true});if(!await unique(titleInput))return refused('CONTROL_NOT_UNIQUE');await titleInput.fill(title);}
      const publish=p.getByRole('button',{name:'发布',exact:true}),publishControl=await controlSummary(publish);if(publishControl.count!==1||publishControl.visibleCount!==1)return controlRefusal('publish_button_control',publishControl);
      const expected=[text,`${title}\n${text}`,`${title} ${text}`,`${title}\n\n${text}`];
      const result=await guardedSubmit({page:p,host:'creator.douyin.com',path:'/web/api/media/aweme/create_v2/',validate:async (r?: any) =>{const data=JSON.parse(r.postData()||'null');return expected.includes(article?data?.long_article:data?.text)&&await identity(p)===account;},submit:async()=>{attempted=true;await publish.click();}});
      if(result.blocked)return refused('REQUEST_BINDING_MISMATCH');if(!result.response)return uncertain();
      const proof=await result.response.json(),post=id(proof?.item_id);if(proof.status_code!==0||!post)return uncertain();
      accepted={receiptId:post,accountId:account};
      const after=await navigateData(p,`https://www.douyin.com/note/${post}`,'/aweme/v1/web/aweme/detail/');if(after.status_code!==0)return {...uncertain(),...accepted};
      const receipt=receipts.publish({...proof,after:after.aweme_detail,accountBefore:account,accountAfter:await identity(p)},{accountId:account,text,title});
      return receipt.confirmed?{...receipt,targetId:'own-public'}:{...receipt,...accepted};
    }
    return refused('INVALID_INPUT');
  }catch{return attempted?{...uncertain(),...accepted}:refused(action==='dm'?`DM_${dmPhase}_UNAVAILABLE`:'PRECONDITION_UNAVAILABLE');}
}
