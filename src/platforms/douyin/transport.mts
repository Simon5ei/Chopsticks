// Narrow Playwright implementation, derived from the MIT-licensed upstream selectors
// and XHR response conventions documented in notices/douyin-MIT-LICENSE.
import { mkdir, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { decodeInbox } from './im-wire.mjs';
export {decodeImRequest,decodeImResponse,decodeInbox} from './im-wire.mjs';
import {guardedSubmit} from './write-guard.mjs';
export {guardedSubmit} from './write-guard.mjs';
import {advancedWrite} from './actions.mjs';
import {publisherDiagnostics} from './publish-diagnostics.mjs';
import {dmDiagnostics} from './dm-diagnostics.mjs';

export function createBrowserTransport({config,stateDir,chromium: injectedChromium}: { config?: any; stateDir?: any; chromium?: any; [key: string]: any }) {
  let context, page, generation=0;
  const privateDir=resolve(stateDir);
  async function ensure() {
    if (page && !page.isClosed()) return page;
    if(context){page=await context.newPage();page.setDefaultTimeout(10000);await page.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded'});return page;}
    const expectedGeneration=generation;
    await mkdir(privateDir,{recursive:true,mode:0o700});
    await chmod(privateDir,0o700);
    const chromium=injectedChromium || (await import('playwright-core')).chromium;
    const executablePath=config?.douyin?.chromePath;
    if (!executablePath) throw new Error('browser unavailable');
    const headless=config?.douyin?.headless!==false;
    const browserBackend=config?.douyin?.browserBackend??'wayland';
    if(!headless&&!['wayland','x11'].includes(browserBackend))throw new Error('browser backend unavailable');
    const args=headless?['--disable-gpu']:[`--ozone-platform=${browserBackend}`];
    const launched=await chromium.launchPersistentContext(join(privateDir,'profile'),{executablePath,headless,args,timeout:30000});
    if (generation!==expectedGeneration) {await launched.close();throw new Error('cancelled');}
    context=launched;
    page=context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded',timeout:30000});
    return page;
  }
  async function identity(p?: any) {
    return await p.evaluate(async()=>{
      const path=globalThis.location?.hostname==='creator.douyin.com'?'/web/api/media/user/info/':'/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383';
      const r=await fetch(path,{credentials:'include'}); if(!r.ok) throw new Error('profile request failed'); const d=await r.json(); const uid=d?.user?.uid; return typeof uid==='string' ? uid : Number.isSafeInteger(uid) ? String(uid) : '';
    });
  }
  function captchaFrame(p?: any) {return (p.frames?.() || []).some((f)=>{try{const u=new URL(f.url());return u.hostname==='rmc.bytedance.com' && u.pathname.startsWith('/verifycenter/captcha/');}catch{return false;}});}
  async function state(p?: any) {
    if(captchaFrame(p))return 'captcha';
    if (/^\d{6,30}$/.test(await identity(p))) return 'success';
    const body=(await p.locator('body').innerText().catch(()=>''));
    if (/滑块|安全验证|图形验证/.test(body)) return 'captcha';
    if (/扫码成功|已扫码/.test(body)) return 'confirm';
    if (/短信验证|手机验证|收取验证码/.test(body)) return 'sms';
    if (/二维码.*过期|二维码.*失效/.test(body)) return 'expired';
    return 'waiting';
  }
  async function close() {generation++;const owned=context;context=undefined;page=undefined;if(owned) await owned.close();}
  return {
    async diagnostics(options?: any){if(!context||!page||page.isClosed())return {state:'unavailable',code:'OWNER_NOT_RUNNING'};return options?.action==='dm_controls'?dmDiagnostics(page,options):publisherDiagnostics(page,options);},
    async status(){const p=await ensure();if(captchaFrame(p))return {state:'verification_required'};const accountId=await identity(p);if (/^\d{6,30}$/.test(accountId)) return {state:'ready',accountId};const s=await state(p);if(['captcha','sms','confirm'].includes(s))return {state:'verification_required'}; const loginVisible=await p.getByText('登录',{exact:true}).last().isVisible().catch(()=>false);return {state:loginVisible?'login_required':'error'};},
    async login({action}: { action?: any; [key: string]: any }) {
      const p=await ensure();
      if(action==='poll') return {state:await state(p)};
      if(await state(p)==='success') return {state:'success'};
      await p.goto('https://www.douyin.com/?_t='+Date.now(),{waitUntil:'domcontentloaded'});
      let qr=p.locator("img[aria-label='二维码'], #animate_qrcode_container img, #douyin_login_comp_scan_code img, img[aria-label*='二维码']").first();
      if (!await qr.isVisible().catch(()=>false)) {
        const button=p.getByText('登录',{exact:true}).last();
        if(await button.isVisible().catch(()=>false)) await button.click();
        await qr.waitFor({state:'visible',timeout:15000});
      }
      const qrImagePath=join(privateDir,'login-qr.png');
      await qr.screenshot({path:qrImagePath}); await chmod(qrImagePath,0o600);
      return {state:'waiting',qrImagePath};
    },
    async write({action,targetId,parentId,text,context:writeContext}: { action?: any; targetId?: any; parentId?: any; text?: any; context?: any; [key: string]: any }) {
      if(['reply','dm','publish'].includes(action))return advancedWrite({p:await ensure(),input:{action,targetId,parentId,text,context:writeContext},identity,receipts:{comment:confirmCommentReceipt,dm:confirmDmReceipt,publish:confirmPublishReceipt}});
      const refused=(code)=>({confirmed:false,state:'refused',code});
      let submitted=false;
      try {
        const target=stableId(targetId); if(!target || !['comment','like'].includes(action)) return refused('INVALID_INPUT');
        const p=await ensure(); const account=stableId(await identity(p)); if(!account)return {confirmed:false,state:'login_required',code:'LOGIN_REQUIRED'};
        const match=(response?: any,path?: any)=>{try{const u=new URL(response.url());return u.protocol==='https:' && u.hostname==='www.douyin.com' && u.pathname.includes(path);}catch{return false;}};
        const detail=async()=>{
          const pending=p.waitForResponse((r)=>match(r,'/aweme/detail/'),{timeout:15000}); pending.catch(()=>{});
          await p.goto(`https://www.douyin.com/video/${target}`,{waitUntil:'domcontentloaded',timeout:30000});
          const response=await pending; const data=await response.json();
          const current=new URL(p.url());
          if(current.hostname!=='www.douyin.com' || current.pathname!==`/video/${target}` || data?.status_code!==0 || stableId(data?.aweme_detail?.aweme_id)!==target) return null;
          return data.aweme_detail;
        };
        const before=await detail(); if(!before) return refused('TARGET_UNVERIFIED');
        const selector=action==='comment'?"[data-e2e='comment-input'][contenteditable='true'], div[contenteditable='true'][data-e2e*='comment'], textarea[data-e2e='comment-input']":"[data-e2e='video-player-digg']";
        const control=p.locator(selector); if(await control.count()!==1 || !await control.isVisible()) return refused('CONTROL_NOT_UNIQUE');
        if(action==='like' && before.user_digged!==0) return refused('LIKE_STATE_NOT_UNLIKED');
        if(action==='comment') {if(typeof text!=='string' || !text.trim() || text.length>500)return refused('INVALID_INPUT');await control.click();await control.fill(text);}
        if(stableId(await identity(p))!==account) return refused('ACCOUNT_CHANGED');
        const guarded=await guardedSubmit({page:p,host:'www.douyin.com',path:action==='comment'?'/aweme/v1/web/comment/publish/':'/aweme/v1/web/commit/item/digg/',validate:async (request?: any) =>{
          const u=new URL(request.url()),body=new URLSearchParams(request.postData()||''),values=(k)=>[...u.searchParams.getAll(k),...body.getAll(k)];
          const targets=[...values('aweme_id'),...values('item_id')];if(!targets.length||targets.some((x)=>x!==target))return false;
          if(action==='like'){const types=values('type');if(!types.length||types.some((x)=>x!=='1'))return false;}
          else {const texts=values('text'),parents=[...values('reply_id'),...values('reply_to_reply_id')];if(texts.length!==1||texts[0]!==text||parents.some((x)=>x!=='0'))return false;}
          return stableId(await identity(p))===account;
        },submit:async()=>{submitted=true;if(action==='comment')await p.keyboard.press('Enter');else await control.click();}});
        if(guarded.blocked)return refused('REQUEST_BINDING_MISMATCH');if(!guarded.response)return uncertain();
        const response=guarded.response; const request=response.request(), u=new URL(request.url());
        const body=new URLSearchParams(request.postData()||''); const ids=[...u.searchParams.getAll('aweme_id'),...body.getAll('aweme_id'),...u.searchParams.getAll('item_id'),...body.getAll('item_id')];
        if(!ids.length || ids.some((x)=>stableId(x)!==target)) return uncertain();
        const data=await response.json();
        if(action==='comment') {
          if(stableId(await identity(p))!==account) return uncertain();
          return confirmCommentReceipt(data,{targetId:target,accountId:account});
        }
        const types=[...u.searchParams.getAll('type'),...body.getAll('type')]; if(!types.length || types.some((x)=>x!=='1'))return uncertain();
        const after=await detail(); const accountAfter=stableId(await identity(p));
        return confirmLikeReceipt({status_code:data?.status_code,targetId:target,accountBefore:account,accountAfter,after},{targetId:target,accountId:account});
      } catch {return submitted?uncertain():refused('PRECONDITION_UNAVAILABLE');}
    },
    async read({action,limit,targetId,query}: { action?: any; limit?: any; targetId?: any; query?: any; [key: string]: any }) {
      if(action==='inbox') {
        const p=await ensure(),accountId=await identity(p),results=[],tasks=[];
        const listener=(r)=>{try{const u=new URL(r.url());if(u.hostname==='imapi.douyin.com'&&['/v1/message/get_message_by_init','/v1/message/get_user_message','/v1/message/get_by_conversation'].includes(u.pathname))tasks.push(r.body().then((b)=>results.push(decodeInbox(b))).catch(()=>results.push({items:[],incomplete:true})));}catch{}};
        p.on('response',listener);
        const initialized=p.waitForResponse((r)=>{try{const u=new URL(r.url());return u.hostname==='imapi.douyin.com'&&['/v1/message/get_message_by_init','/v1/message/get_user_message'].includes(u.pathname);}catch{return false;}},{timeout:20000});initialized.catch(()=>{});
        try{await p.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded'});const entry=p.locator('[data-e2e="im-entry"]');await entry.waitFor({state:'visible',timeout:15000});if(await entry.count()===1)await entry.click();await initialized;await p.waitForTimeout(1000);await Promise.all(tasks);}finally{p.off('response',listener);}
        if(!stableId(accountId)||await identity(p)!==accountId)return {items:[],incomplete:true};
        const unique=new Map(results.flatMap((r)=>r.items).map((x)=>[x.serverMessageId,x]));
        return {accountId,items:[...unique.values()].slice(0,limit),hasMore:unique.size>limit||results.some((r)=>r.hasMore),incomplete:!results.length||results.some((r)=>r.incomplete)};
      }
      if(action==='notifications') {
        const p=await ensure();await p.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded'});const accountId=await identity(p);
        const data=await p.evaluate(async (n?: any) =>{const q=new URLSearchParams({device_platform:'webapp',aid:'6383',channel:'channel_pc_web',notice_group:'2',count:String(n),max_time:'0',min_time:'0',is_new_notice:'1',is_mark_read:'0'});const r=await fetch('/aweme/v1/web/notice/?'+q,{credentials:'include'});if(!r.ok)throw Error('notice request failed');return r.json();},limit);
        const items=Array.isArray(data?.notice_list)&&data.notice_list.length?data.notice_list:data?.notice_list_v2??data?.notice_list;
        if(!stableId(accountId)||await identity(p)!==accountId)return {items:[],incomplete:true};
        return {accountId,items:data?.status_code===0&&Array.isArray(items)?items:[],hasMore:!!data.has_more,incomplete:data?.status_code!==0||!Array.isArray(items)};
      }
      const p=await ensure(); const hits=[]; const tasks=[];
      const onResponse=(response)=>{
        const u=response.url();
        const relevant=action==='feed' ? /tab\/feed|module\/feed/.test(u) : action==='detail' ? /aweme\/detail\//.test(u) : action==='comments' ? /comment\/list\//.test(u) : /search\/single/.test(u);
        if(relevant) tasks.push(response.json().then((d)=>hits.push(d)).catch(()=>{}));
      };
      p.on('response',onResponse);
      try {
        const url=action==='feed'?'https://www.douyin.com/jingxuan':action==='search'?`https://www.douyin.com/search/${encodeURIComponent(query)}`:`https://www.douyin.com/video/${targetId}`;
        await p.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
        await p.waitForTimeout(3500);
        if(action==='feed') { const rec=p.getByText('推荐',{exact:true}).first(); if(await rec.isVisible().catch(()=>false)) await rec.click().catch(()=>{}); await p.waitForTimeout(2000); }
        await Promise.all(tasks);
      } finally {p.off('response',onResponse);}
      if(captchaFrame(p))return {items:[],incomplete:true,code:'VERIFICATION_REQUIRED'};
      const items=[];let hasMore=false,apiError=false;
      for(const d of hits) {
        if(d?.status_code!==0){apiError=true;continue;}
        if(action==='detail' && d.aweme_detail && String(d.aweme_detail.aweme_id)===targetId) items.push(d.aweme_detail);
        else if(action==='comments') {items.push(...(Array.isArray(d.comments)?d.comments:[])); hasMore ||= !!d.has_more;}
        else if(action==='search') {for(const x of d.data || []) {const a=x.aweme_info||x.aweme;if(a)items.push(a);} items.push(...(d.aweme_list||[]));hasMore ||= !!d.has_more;}
        else if(action==='feed') items.push(...(d.aweme_list||[]));
      }
      return {items:items.slice(0,limit),hasMore:hasMore||items.length>limit,incomplete:hits.length===0||apiError||(action==='detail'&&items.length===0),...(apiError?{code:'PLATFORM_API_ERROR'}:{})};
    },
    idleClose:close,cancel:close,close
  };
}


const stableId = (value) => (typeof value === 'number' && !Number.isSafeInteger(value)) ? '' : (/^\d{6,30}$/.test(String(value ?? '')) ? String(value) : '');
const uncertain = () => ({confirmed:false,state:'uncertain',code:'UNVERIFIED_RECEIPT'});
export function contentVisibility(raw?: any) {
  const status=raw?.status,flags=[status?.is_private,raw?.is_private].filter((x)=>x!==undefined);
  if(status?.private_status===1||flags.some((x)=>x===true||x===1))return 'private';
  if(status?.private_status!==0||flags.some((x)=>x!==false&&x!==0)||![undefined,0].includes(status?.part_see)||[status?.in_reviewing,status?.is_delete,status?.is_prohibited].some((x)=>x!==undefined&&x!==false))return 'unknown';
  return 'public';
}
export function confirmCommentReceipt(data?: any,{targetId,accountId,parentId}: { targetId?: any; accountId?: any; parentId?: any; [key: string]: any }={}) {
  const c=data?.comment, cid=stableId(c?.cid), target=stableId(targetId), account=stableId(accountId);
  const parentValue=stableId(c?.reply_to_reply_id) ? c.reply_to_reply_id : c?.reply_id; const parent=String(parentValue ?? '');
  if(data?.status_code!==0 || !cid || !target || !account || stableId(c?.aweme_id)!==target || stableId(c?.user?.uid)!==account || parentValue == null || (parentId ? parent!==stableId(parentId) : parent!=='0')) return uncertain();
  return {confirmed:true,platformId:cid,targetId:target,kind:parentId?'reply':'comment',...(parentId?{parentId:parent}:{})};
}
export function confirmDmReceipt(proof?: any,{targetId,accountId,text}: { targetId?: any; accountId?: any; text?: any; [key: string]: any }={}) {
  const account=stableId(accountId),target=stableId(targetId),r=proof?.request,members=String(r?.conversationId||'').split(':');
  if(!account||!target||account===target||proof?.status!==0||!stableId(proof?.serverMessageId)||!r?.clientMessageId||proof.clientMessageId!==r.clientMessageId||r.conversationType!==1||members.length!==4||members[0]!=='0'||members[1]!=='1'||!members.slice(2).includes(account)||!members.slice(2).includes(target)||r.text!==text||proof.accountBefore!==account||proof.accountAfter!==account||(proof.conversationId&&proof.conversationId!==r.conversationId))return uncertain();
  return {confirmed:true,platformId:proof.serverMessageId,targetId:target,kind:'dm'};
}
export function confirmPublishReceipt(proof?: any,{accountId,text,title=''}: { accountId?: any; text?: any; title?: string; [key: string]: any }={}) {
  const account=stableId(accountId),post=stableId(proof?.item_id),after=proof?.after;
  const expected=[text,...(title?[`${title}\n${text}`,`${title} ${text}`,`${title}\n\n${text}`]:[])];
  if(!account||!post||proof?.status_code!==0||proof.accountBefore!==account||proof.accountAfter!==account||stableId(after?.aweme_id)!==post||stableId(after?.author?.uid)!==account||contentVisibility(after)!=='public'||![after?.desc,after?.long_article].some((x)=>expected.includes(x)))return uncertain();
  return {confirmed:true,platformId:post,targetId:account,kind:'publish',accountId:account,visibility:'public'};
}
export function confirmLikeReceipt(proof?: any,{targetId,accountId}: { targetId?: any; accountId?: any; [key: string]: any }={}) {
  const target=stableId(targetId), account=stableId(accountId);
  if(!target || !account || proof?.status_code!==0 || stableId(proof?.targetId)!==target || stableId(proof?.accountBefore)!==account || stableId(proof?.accountAfter)!==account || stableId(proof?.after?.aweme_id)!==target || proof?.after?.user_digged!==1) return uncertain();
  return {confirmed:true,platformId:target,targetId:target,kind:'like'};
}
