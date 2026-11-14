import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHeyboxDirectMessages } from '../platforms/heybox/dm.mjs';
import { createHeyboxWriter, normalizeHeyboxNotifications } from '../platforms/heybox/actions.mjs';

// Signing algorithm adapted from WenfuRainbow/heybox v0.2.2, MIT; see notices/heybox-MIT-LICENSE.
const alphabet = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89';
const md5 = (s) => createHash('md5').update(s).digest('hex');
const vm = (n) => n & 128 ? (n << 1 ^ 27) & 255 : n << 1;
const qm = (n) => vm(n) ^ n;
const dm = (n) => qm(vm(n));
const ym = (n) => dm(qm(vm(n)));
const gm = (n) => ym(n) ^ dm(n) ^ qm(n);
const encode = (s?: any,a?: any) => [...s].map((c)=>a[c.charCodeAt(0)%a.length]).join('');
export function generateHeyboxSignature(path?: any, timestamp?: any, nonce?: any) {
  const p='/' + path.split('/').filter(Boolean).join('/') + '/';
  const parts=[encode(String(timestamp+1),alphabet.slice(0,-2)),encode(p,alphabet),encode(nonce,alphabet)];
  let mixed=''; for(let i=0;i<Math.max(...parts.map((x)=>x.length));i++) for(const s of parts) if(i<s.length) mixed+=s[i];
  const h=md5(mixed.slice(0,20)), e=[...h.slice(-6)].map((c)=>c.charCodeAt(0));
  const t=[gm(e[0])^ym(e[1])^dm(e[2])^qm(e[3]),qm(e[0])^gm(e[1])^ym(e[2])^dm(e[3]),dm(e[0])^qm(e[1])^gm(e[2])^ym(e[3]),ym(e[0])^dm(e[1])^qm(e[2])^gm(e[3])];
  // Upstream retains the last two MD5 characters in the checksum sum.
  const sum=[...t,...e.slice(4)].reduce((a?: any,b?: any)=>a+b,0)%100;
  return {hkey:encode(h.slice(0,5),alphabet.slice(0,-4))+String(sum).padStart(2,'0'),_time:timestamp,nonce};
}
const capabilities=Object.freeze({feed:true,detail:true,search:true,comments:true,notifications:true,like:true,comment:true,reply:true,publish:true,inbox:true,dm:true});
const idOf = (x) => String(x?.link_id ?? x?.linkid ?? x?.id ?? '');
const textOf = (x) => String(x?.text ?? x?.content ?? x?.summary ?? x?.description ?? '');
const cookieHeader = (cookies) => Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; ');
const authValid = (c) => !!(c?.heybox_id || c?.user_heybox_id) && !!(c?.pkey || c?.user_pkey || c?.x_xhh_tokenid);
export async function readHeyboxJson(response?: any){
  const maximum=1048576,length=Number(response.headers.get('content-length'));
  if(length>maximum||!response.body){await response.body?.cancel().catch(()=>{});throw Error('response_bound');}
  const reader=response.body.getReader(),chunks=[];let total=0,done=false;
  try{for(let i=0;i<256;i++){const part=await reader.read();if(part.done){done=true;break;}total+=part.value.byteLength;if(total>maximum)throw Error('response_bound');chunks.push(part.value);}if(!done)throw Error('response_chunk_bound');return JSON.parse(Buffer.concat(chunks,total).toString('utf8'));}
  finally{await reader.cancel().catch(()=>{});}
}
async function defaultTransport({path,params,cookies,deviceId,now,signal,anonymous,method='GET',body,workshop=false}: { path?: any; params?: any; cookies?: any; deviceId?: any; now?: any; signal?: any; anonymous?: any; method?: string; body?: any; workshop?: boolean; [key: string]: any }) {
  const timestamp=Math.floor(now/1000), nonce=md5(timestamp+randomBytes(16).toString('hex')).toUpperCase();
  const common={os_type:'web',app:anonymous?'web':'heybox',client_type:'web',version:'999.0.4',x_client_type:'web',x_app:'heybox_website',heybox_id:anonymous?'':(cookies.heybox_id || cookies.user_heybox_id || ''),x_os_type:'Windows',device_info:'Chrome',device_id:deviceId,...(anonymous?{_notip:'true'}:{}),...generateHeyboxSignature(path,timestamp,nonce),...params};
  if(workshop){const salt='Z7mFG4tQp9Ws2LxB8H';common._rnd='15:'+createHmac('sha256',salt).update(`${salt}${nonce}${timestamp}:${nonce}`).digest('hex');common.web_version='3.0';common.x_client_version='';delete common.heybox_id;}
  // Current official message center authenticates from website cookies. A URL
  // heybox_id selects an incompatible legacy response on conversation discovery.
  if(path==='/bbs/app/user/message'){common.web_version='3.0';common.x_client_version='';delete common.heybox_id;}
  // Match the attributed native DM client's contract on both history and send.
  if(path==='/chatroom/v2/msg/user')common.web_version='2.5';
  const url=new URL(path,'https://api.xiaoheihe.cn'); for(const [k,v] of Object.entries(common)) url.searchParams.set(k,String(v));
  const response=await fetch(url,{method,redirect:'error',...(body?{body:new URLSearchParams(body).toString()}:{}),headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',Accept:'*/*',Referer:'https://www.xiaoheihe.cn/',Origin:'https://www.xiaoheihe.cn',Cookie:cookieHeader(cookies),...(body?{'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'}:{})},signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new Error('http');} const payload=await readHeyboxJson(response); const next: Record<string, any>={};
  for(const v of response.headers.getSetCookie()) {const m=/^\s*([^=;\s]+)=([^;]*)/.exec(v); if(m) next[m[1]]=m[2];}
  return {payload,cookies:next};
}
export async function verifyHeyboxCredentials(auth?: any,{signal}: { signal?: any; [key: string]: any }={}) {
  if(!authValid(auth?.cookies))return {state:'login_required'};
  try {
    const response=await defaultTransport({path:'/account/restore_login',params:{},cookies:auth.cookies,deviceId:auth.deviceId||randomBytes(16).toString('hex'),now:Date.now(),signal:signal||new AbortController().signal,anonymous:false});
    const payload=response.payload,accountId=String(payload?.result?.profile?.heybox_id??payload?.result?.account_detail?.userid??'');
    if(payload?.status!=='ok'||!accountId||accountId!==String(auth.cookies.heybox_id||auth.cookies.user_heybox_id))return {state:'login_required'};
    return {state:'ready',accountId};
  }catch{return {state:'error'};}
}
export function createHeyboxPlatform({config,stateDir,now=Date.now,transport=defaultTransport,renderQr}: { config?: any; stateDir?: any; now?: any; transport?: any; renderQr?: any; [key: string]: any }={}) {
  if(!stateDir) throw new Error('stateDir required');
  const operations: Record<string, {state: string; code?: string; checkedAt?: number}>=Object.fromEntries(Object.keys(capabilities).map((action)=>[action,{state:'unknown'}]));
  function observe(action?: any,state?: any,code?: any){if(Object.hasOwn(operations,action))operations[action]={state,...(code?{code}:{}),checkedAt:now()};}
  let auth, session, closed=false, loginTask; const active=new Set<any>(); const controller=new AbortController();
  const deviceId=randomBytes(16).toString('hex');
  async function load(){ if(auth!==undefined)return auth; try { const a=JSON.parse(await readFile(join(stateDir,'auth.json'),'utf8')); auth=authValid(a.cookies)?a:null; } catch {auth=null;} return auth; }
  async function privateWrite(name?: any,data?: any){await mkdir(stateDir,{recursive:true,mode:0o700}); await writeFile(join(stateDir,name),data,{mode:0o600}); await chmod(join(stateDir,name),0o600);}
  async function request(path?: any,params?: any,cookies?: any,anonymous?: any,signal?: any,options: Record<string, any>={}) {if(closed||signal?.aborted) throw new Error('cancelled'); const s=AbortSignal.any([controller.signal,...(signal?[signal]:[])]); const promise=transport({path,params,cookies:{...cookies},anonymous,deviceId:auth?.deviceId||deviceId,now:now(),signal:s,...options}); active.add(promise); try {const v=await promise;if(s.aborted)throw new Error('cancelled');return v;} finally{active.delete(promise);}}
  function result(v?: any){const p=v?.payload; if(p?.status==='ok')return p.result ?? {}; const marker=String(p?.status||''); if(/captcha|verification/i.test(marker))throw Object.assign(new Error('verification_required'),{platformRejection:true}); if(/login|auth/i.test(marker))throw Object.assign(new Error('login_required'),{platformRejection:true}); throw new Error('api_error');}
  async function authenticationStatus({signal}: { signal?: any; [key: string]: any }={}) { if(closed)return {state:'error',capabilities,code:'closed'}; const a=await load(); if(!a)return {state:'login_required',capabilities}; try {const r=result(await request('/account/restore_login',{},a.cookies,false,signal)); const identity=String(r.profile?.heybox_id??r.account_detail?.userid??r.heybox_id??''); if(!identity||identity!==String(a.cookies.heybox_id||a.cookies.user_heybox_id))return {state:'login_required',capabilities,code:'identity_unverified'}; return {state:'ready',accountId:identity,capabilities};}catch(e){const code=['verification_required','login_required','cancelled'].includes(e.message)?e.message:'network_error';return {state:code==='verification_required'?'verification_required':code==='login_required'?'login_required':'error',capabilities,code};}}
  async function status(args: Record<string, any>={}) {const identity=await authenticationStatus(args);return {...identity,authentication:{state:identity.state},operations:structuredClone(operations)};}
  async function loginInternal({action,signal}: { action?: any; signal?: any; [key: string]: any }={}) {if(closed||signal?.aborted){session=undefined; await rm(join(stateDir,'login-qr.png'),{force:true}); return {state:'cancelled'};} try {
    if(action==='start') {session=undefined; const v=await request('/account/get_qrcode_url/',{}, {},true,signal),r=result(v),qr=String(r.qr_url||r.qrcode||r.url||''); const u=new URL(qr); const pollParams=Object.fromEntries(u.searchParams); if(!Object.keys(pollParams).length)throw new Error('invalid_qr');
      const expiry=Number(r.expire??r.expires_in??120), ttl=Number.isFinite(expiry)?Math.max(10,Math.min(expiry>1e10?(expiry-now())/1000:expiry,600)):120;
      const renderer=renderQr || (async (value?: any) => {const q=await import('qrcode'); return (q.default||q).toBuffer(value,{type:'png'});}); const png=await renderer(qr); if(signal?.aborted||closed)return {state:'cancelled'};
      await privateWrite('login-qr.png',png); session={pollParams,cookies:{...v.cookies},expiresAt:now()+ttl*1000,polls:0}; return {state:'waiting',qrImagePath:join(stateDir,'login-qr.png'),expiresAt:session.expiresAt}; }
    if(action!=='poll')return {state:'unsupported'}; if(!session)return {state:'expired'}; if(now()>=session.expiresAt||session.polls>=120){session=undefined;await rm(join(stateDir,'login-qr.png'),{force:true});return {state:'expired'};}
    const current=session; current.polls++; const v=await request('/account/qr_state/',current.pollParams,current.cookies,true,signal); if(current!==session||closed)return {state:'cancelled'}; Object.assign(current.cookies,v.cookies); const r=result(v); const marker=String(r.error||r.err||r.state||r.status||'').toLowerCase();
    if(['ok','success','confirmed','2'].includes(marker)) {for(const obj of [r,r.user,r.account,r.profile].filter((x)=>x&&typeof x==='object')) {for(const [dst,keys] of Object.entries({heybox_id:['heybox_id','user_heybox_id','heyboxid','userid','user_id','uid','id'],pkey:['pkey','user_pkey','key'],x_xhh_tokenid:['x_xhh_tokenid']})) for(const k of keys) if(!current.cookies[dst]&&obj[k])current.cookies[dst]=String(obj[k]);} if(!authValid(current.cookies))throw new Error('invalid_credentials'); auth={cookies:current.cookies,deviceId}; await privateWrite('auth.json',JSON.stringify(auth)); session=undefined; await rm(join(stateDir,'login-qr.png'),{force:true});return {state:'success'}; }
    if(['expired','timeout','3'].includes(marker)){session=undefined;await rm(join(stateDir,'login-qr.png'),{force:true});return {state:'expired'};} if(['failed','error','-1'].includes(marker))return {state:'failed'};return {state:['scanned','ready','confirm','1'].includes(marker)?'scanned':'waiting',expiresAt:current.expiresAt};
  }catch(e){if(signal?.aborted||closed||e.message==='cancelled'){session=undefined;await rm(join(stateDir,'login-qr.png'),{force:true});return {state:'cancelled'};} return {state:'error',code:e.code==='ERR_MODULE_NOT_FOUND'?'qr_renderer_unavailable':['verification_required','login_required'].includes(e.message)?e.message:'login_failed'};}}
  async function login(args: Record<string, any>={}) {if(loginTask)return {state:'busy'}; const task=loginInternal(args); loginTask=task; try{return await task;}finally{if(loginTask===task)loginTask=undefined;}}
  async function readInternal({action,limit=20,cursor,id,query,context,signal}: { action?: any; limit?: number; cursor?: any; id?: any; query?: any; context?: any; signal?: any; [key: string]: any }={}) { if(action==='inbox')return dm.read({id,limit,cursor,context,signal}); const empty=(warning?: any)=>({items:[],truncated:false,warnings:[warning]}); if(!['feed','detail','comments','search','notifications'].includes(action))return empty('unsupported'); const a=await load(); if(!a)return empty('login_required'); const n=Math.max(1,Math.min(50,Number.isFinite(Number(limit))?Math.floor(Number(limit)):20)); const offset=/^\d+$/.test(String(cursor??'0'))?Number(cursor??0):0;
    let path,params; if(action==='notifications'){path='/bbs/app/user/message';params={list_type:'0',no_more:'false',offset:String(offset),limit:String(n)};} else if(action==='feed'){if(id){path='/bbs/app/topic/feeds';params={topic_id:String(id),offset:String(offset),limit:String(n)};}else{path='/bbs/app/feeds';params={offset:String(offset),pull:'0',dw:'800'};}} else if(action==='search'){if(!query)return empty('query_required');path='/bbs/app/api/general/search/v1';params={q:String(query),search_type:'link',is_pull_down:'0',offset:String(offset),limit:String(n),dw:'800'};} else {if(!id)return empty('id_required');path='/bbs/app/link/tree';params={link_id:String(id),offset:String(offset),limit:String(n)};}
    try {const r=result(await request(path,params,a.cookies,false,signal)); if(action==='notifications')return normalizeHeyboxNotifications(r,n,offset); let rows=action==='feed'?r.links:action==='search'?r.items:action==='comments'?(r.comments??r.comment):[r.link??r.post??r]; if(!Array.isArray(rows))return empty('unexpected_response'); const sourceCount=rows.length; if(action==='comments')rows=rows.flatMap((group)=>Array.isArray(group?.comment)?group.comment:[group]); const warnings=[]; const items=[]; for(const row of rows){const x=row?.info??row; if(action==='search'&&row?.type&&row.type!=='link')continue; const key=action==='comments'?String(x?.commentid??x?.comment_id??x?.id??''):idOf(x);if(!key){warnings.push('record_missing_id');continue;} const text=textOf(x); if(!text&&!x.title)warnings.push('record_missing_text'); items.push({id:key,...(typeof x.share_url==='string' && /^https:\/\/(?:www\.)?xiaoheihe\.cn\//i.test(x.share_url)?{url:x.share_url.split(/[?#]/,1)[0]}:{}),...(x.title?{title:String(x.title)}:{}),text,...action==='detail'?{observationKind:typeof (x.text??x.content)==='string'?'body':'body_excerpt'}:{},kind:action==='comments'?'comment':'post',visibility:'public',...((x.user?.heybox_id??x.user?.userid??x.userid)?{actorId:String(x.user?.heybox_id??x.user?.userid??x.userid)}:{})});}
      const moreFloors=action==='comments' && ![undefined,null,false,0,'0','false',''].includes(r.has_more_floors); const truncated=items.length>n || sourceCount>=n || moreFloors || Number(limit)>50; if(items.length>n)warnings.push('page_exceeds_limit'); return {items:items.slice(0,n),...(truncated&&items.length<=n?{cursor:String(offset+sourceCount)}:{}),truncated,warnings:[...new Set<any>(warnings)]};
    }catch(e){return empty(['login_required','verification_required','cancelled'].includes(e.message)?e.message:'read_failed');}}
  async function read(args: Record<string, any>={}) {
    const value=await readInternal(args),warnings=value.warnings??[];
    const blocked=warnings.find((x)=>['login_required','verification_required'].includes(x));
    observe(args.action,blocked||(warnings.length?'degraded':'ready'),blocked||warnings[0]);return value;
  }
  async function close(){closed=true;controller.abort();session=undefined;await Promise.allSettled([...active,...(loginTask?[loginTask]:[])]);await rm(join(stateDir,'login-qr.png'),{force:true});}
  const dependencies={load,status,request,result,isClosed:()=>closed};
  const dm=createHeyboxDirectMessages(dependencies), publicWrite=createHeyboxWriter(dependencies);
  let writing=false;
  async function write(args: Record<string, any>={}){if(writing)return {confirmed:false,state:'refused',code:'write_busy'};writing=true;try{const value: any=await (args.action==='dm'?dm.write(args):publicWrite(args));if(args.action==='dm'&&value.diagnostic){const d=value.diagnostic;await privateWrite('dm-diagnostic.json',JSON.stringify({at:now(),phase:d.phase,source:d.source,hint:d.hint,code:d.code||value.code})).catch(()=>{});}observe(args.action,value.confirmed?'ready':value.state||'unknown',value.code);return value;}finally{writing=false;}}
  return {platform:'heybox',capabilities,status,login,read,write,close};
}
