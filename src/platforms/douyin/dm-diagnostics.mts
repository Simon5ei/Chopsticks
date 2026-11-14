import {sanitizePublisherDiagnostics,diagnosticFailure} from './publish-diagnostics.mjs';
export function validDmDiagnostic(args?: any){return args?.action==='dm_controls'&&Object.keys(args).every((k)=>['action','peerName','targetId','secUid'].includes(k))&&(args.peerName===undefined||typeof args.peerName==='string'&&args.peerName.trim().length>0&&args.peerName.length<=80&&!/[\x00-\x1f\x7f]/.test(args.peerName))&&(args.targetId===undefined&&args.secUid===undefined||typeof args.targetId==='string'&&typeof args.secUid==='string'&&/^\d{6,30}$/.test(args.targetId)&&/^MS4w[A-Za-z0-9_-]{8,200}$/.test(args.secUid));}
// This function is serialized into the already-owned page. Stream at most
// 64 KiB/64 chunks before decoding JSON; no response.json()/body() allocation.
export async function fetchDiagnosticProfile(url?: any){
 const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='www.douyin.com'||u.pathname!=='/aweme/v1/web/user/profile/other/'||url.length>4096||u.username||u.password)throw Error('Invalid profile endpoint');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);let reader;
 try{
  const response=await fetch(url,{credentials:'include',redirect:'error',signal:controller.signal});if(!response.ok||!response.body)throw Error('Profile unavailable');
  reader=response.body.getReader();const chunks=[];let size=0,done=false;
  for(let i=0;i<64;i++){const part=await reader.read();if(part.done){done=true;break;}size+=part.value.byteLength;if(size>65536)throw Error('Profile too large');chunks.push(part.value);}
  if(!done)throw Error('Profile chunk limit');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));
 }finally{clearTimeout(timer);if(reader)await reader.cancel().catch(()=>{});}
}
const count=(n)=>Number.isInteger(n)&&n>=0&&n<=10000;
const markup=(x)=>Object.fromEntries(['tag','class','role','e2e'].filter((k)=>typeof x?.[k]==='string'&&x[k].length<=200&&/^[A-Za-z0-9_ :.-]*$/.test(x[k])).map((k)=>[k,x[k]]));
export function sanitizeDiagnostics(value?: any){
 if(value?.kind!=='dm_controls')return sanitizePublisherDiagnostics(value);
 const out: any={kind:'dm_controls',state:['observed','unavailable','error'].includes(value.state)?value.state:'error'};
 for(const key of (['entries','legacyRows','peers','editorCount','profilePeers','conversationRows','e2eRowRows','titleCount','titleMatches','uidRows','profileInsideRows'] as const))if(count(value[key]))out[key]=value[key];
 if(Array.isArray(value.e2eNames)&&value.e2eNames.length)out.e2eNames=value.e2eNames.filter((x?: any)=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,60}$/.test(x)).slice(0,30);
 for(const key of (['profileVerified','profileNameMatches','profileResolved'] as const))if(typeof value[key]==='boolean')out[key]=value[key];
 if(value.layout&&typeof value.layout==='object'){
  const x=value.layout;out.layout={};for(const k of (['viewportWidth','windowWidth','screenWidth','entryWidth','entryHeight'] as const))if(count(x[k]))out.layout[k]=x[k];
  if(typeof x.entryPresent==='boolean')out.layout.entryPresent=x.entryPresent;
  for(const [k,allowed] of ([['entryDisplay',['none','block','inline','inline-block','flex','inline-flex','grid']],['entryVisibility',['hidden','visible','collapse']],['documentState',['loading','interactive','complete']]] as const))if((allowed as readonly string[]).includes(x[k]))out.layout[k]=x[k];
 }
 for(const key of (['editors','peerNodes'] as const))if(Array.isArray(value[key]))out[key]=value[key].slice(0,4).map((x)=>({...markup(x),ancestors:(Array.isArray(x.ancestors)?x.ancestors:[]).slice(0,5).map(markup)}));
 return out;
}
/** Serial owner only; fixed navigation, ordinary inbox clicks, no text or submit. */
export async function dmDiagnostics(page?: any,{peerName,targetId,secUid,onPhase=()=>{},isExpired=()=>false}: { peerName?: any; targetId?: any; secUid?: any; onPhase?: (...args: any[]) => any; isExpired?: (...args: any[]) => any; [key: string]: any }={}){
 if(!validDmDiagnostic({action:'dm_controls',peerName,...targetId!==undefined||secUid!==undefined?{targetId,secUid}:{}}))return {kind:'dm_controls',state:'error'};
 let phase='navigation';const check=()=>{if(isExpired())throw Error('expired');};
 const enter=(p)=>{check();phase=p;onPhase(p);};
 try{
  const result: any={kind:'dm_controls',state:'observed'};let profileName;
  if(targetId){
   enter('navigation');const pending=page.waitForResponse((r)=>{try{const u=new URL(r.url());return u.hostname==='www.douyin.com'&&u.pathname==='/aweme/v1/web/user/profile/other/';}catch{return false;}},{timeout:8000});pending.catch(()=>{});
   await page.goto(`https://www.douyin.com/user/${secUid}`,{waitUntil:'domcontentloaded',timeout:8000});check();const response=await pending;check();const data=await page.evaluate(fetchDiagnosticProfile,response.url());
   result.profileVerified=data?.status_code===0&&String(data.user?.uid)===targetId&&data.user?.sec_uid===secUid;
   if(!result.profileVerified)return sanitizeDiagnostics(result);
   profileName=typeof data.user.nickname==='string'&&data.user.nickname.length<=80?data.user.nickname:undefined;result.profileNameMatches=profileName===peerName;
  }
  enter('navigation');await page.goto('https://www.douyin.com/',{waitUntil:'domcontentloaded',timeout:10000});
  enter('attachment');const entry=page.locator('[data-e2e="im-entry"]');
  try{await entry.first().waitFor({state:'visible',timeout:15000});}catch(e){
   if(e?.name!=='TimeoutError')throw e;check();
   const layout=await page.evaluate(()=>{const el=document.querySelector('[data-e2e="im-entry"]'),style=el?getComputedStyle(el):null,box=el?.getBoundingClientRect();return {viewportWidth:innerWidth,windowWidth:outerWidth,screenWidth:screen.width,documentState:document.readyState,entryPresent:!!el,entryWidth:Math.round(box?.width||0),entryHeight:Math.round(box?.height||0),entryDisplay:style?.display,entryVisibility:style?.visibility};});
   check();return sanitizeDiagnostics({kind:'dm_controls',state:'unavailable',layout});
  }
  check();result.entries=await entry.count();if(result.entries!==1)return sanitizeDiagnostics(result);
  check();await entry.click({timeout:3000});
  if(targetId&&secUid){try{const probe=await page.evaluate(async ({id,sec})=>{
    let name='';
    try{const r=await fetch('https://www.douyin.com/aweme/v1/web/user/profile/other/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id='+encodeURIComponent(sec),{credentials:'include'});const d=await r.json();if(d?.status_code===0&&String(d.user?.uid)===String(id)&&typeof d.user?.nickname==='string')name=d.user.nickname;}catch{}
    const titles=[...document.querySelectorAll('.conversationConversationItemtitle')].map((e)=>(e.textContent||'').trim());
    const rows=[...document.querySelectorAll('[class*="conversationConversationItemwrapper"],[data-e2e="conversation-item"]')];
    return {resolved:!!name,titleCount:titles.length,titleMatches:name?titles.filter((t)=>t===name).length:0,uidRows:rows.filter((el)=>{const h=el.outerHTML;return typeof h==='string'&&h.includes(String(id));}).length};
   },{id:targetId,sec:secUid});
   if(probe&&typeof probe==='object'){result.profileResolved=probe.resolved===true;result.titleCount=probe.titleCount;result.titleMatches=probe.titleMatches;result.uidRows=probe.uidRows;}
  }catch{}}
  const peer=page.getByText(peerName,{exact:true}).filter({visible:true});
  try{await peer.first().waitFor({state:'visible',timeout:5000});}catch(e){if(e?.name!=='TimeoutError')throw e;}
  check();result.legacyRows=await page.locator('[class*="conversationConversationItemwrapper"]').count();result.peers=await peer.count();
  // Bound before DOM extraction; never read innerText/value/HTML or request data.
  const describeNodes=(control)=>control.evaluateAll((elements)=>elements.slice(0,4).map((el)=>{
   const describe=(e)=>({tag:e.tagName,class:(e.getAttribute('class')||'').slice(0,200),role:(e.getAttribute('role')||'').slice(0,200),e2e:(e.getAttribute('data-e2e')||'').slice(0,200)});
   const ancestors=[];let parent=el.parentElement;for(let i=0;parent&&i<5;i++,parent=parent.parentElement)ancestors.push(describe(parent));return {...describe(el),ancestors};
  }));
  // A nickname could equal a submit button or message link. Observe its DOM
  // ancestry only; never click a global text match, even when unique.
  if(result.peers>0&&result.peers<=4)result.peerNodes=await describeNodes(peer);
  if(profileName)result.profilePeers=await page.getByText(profileName,{exact:true}).filter({visible:true}).count();
  if(profileName){try{result.profileInsideRows=await page.locator('[class*="conversation"],[data-e2e*="conversation"]').getByText(profileName,{exact:true}).filter({visible:true}).count();}catch{}}
  if(targetId){try{result.uidRows=await page.evaluate((id)=>{let n=0;document.querySelectorAll('[class*="conversationConversationItemwrapper"],[data-e2e="conversation-item"]').forEach((el)=>{const html=el.outerHTML;if(typeof html==='string'&&html.includes(String(id)))n++;});return n;},targetId);}catch{}}
  if(targetId&&result.peers===1){
   // These exact row/title markers were observed on the production inbox.
   const rows=page.locator('[data-e2e="conversation-item"]').filter({has:page.locator('.conversationConversationItemtitle').and(page.getByText(peerName,{exact:true})),visible:true});
   result.conversationRows=await rows.count();check();if(result.conversationRows===1)await rows.click({timeout:3000});
  }
  check();const editors=page.locator('[contenteditable="true"], textarea').filter({visible:true});result.editorCount=await editors.count();
  if(result.editorCount>0&&result.editorCount<=4)result.editors=await describeNodes(editors);
  check();return sanitizeDiagnostics(result);
 }catch(e){return diagnosticFailure(phase,e?.name==='TimeoutError'?'timeout':isExpired()?'deadline':'dom_failed');}
}
