export const CREATOR_UPLOAD='https://creator.douyin.com/creator-micro/content/upload?default-tab=3';
// SPA controls may attach after DOMContentLoaded. Wait for presence, then let
// callers inspect the full locator so multiple matching controls still refuse.
export async function waitForControlAttachment(control?: any) {
 try{await control.first().waitFor({state:'attached',timeout:8000});return true;}
 catch(error){if(error?.name==='TimeoutError')return false;throw error;}
}
const phases=new Set<any>(['publish_upload_control','publish_editor_control','publish_button_control']);
const diagnosticPhases=new Set<any>(['navigation','attachment','control_upload','control_fileInputs','control_editor','control_publishButton','owner_queue','owner_operation','owner_ipc']);
const errorKinds=new Set<any>(['timeout','page_closed','navigation_failed','dom_failed','deadline','cancelled','owner_unavailable','operation_failed']);
export function diagnosticFailure(phase?: any,errorKind?: any) {
 return sanitizePublisherDiagnostics({state:'error',code:'DIAGNOSTICS_FAILED',phase,errorKind});
}
export function provenPublishRefusal(value?: any) {
 return value?.confirmed===false&&value.deliveryState==='not_sent'&&value.submitted===false&&value.code==='CONTROL_NOT_UNIQUE'&&phases.has(value.phase)&&!value.receiptId&&!value.id&&!value.platformId;
}
export function refusalEvidence(value?: any) {
 if(!provenPublishRefusal(value))return {};
 const count=value.control?.count,visibleCount=value.control?.visibleCount;
 return {deliveryState:'not_sent',submitted:false,phase:value.phase,...Number.isInteger(count)&&count>=0&&count<=10000&&Number.isInteger(visibleCount)&&visibleCount>=0&&visibleCount<=count?{control:{count,visibleCount}}:{}};
}
export async function controlSummary(control?: any,attributes: boolean=false,check: (...args: any[]) => any=()=>{}) {
 check();
 const count=await control.count();if(!Number.isInteger(count)||count<0||count>10000)throw Error('Invalid control count');
 const items=[];let visibleCount=0;
 for(let i=0;i<Math.min(count,10);i++){
  check();
  const item=count===1?control:control.nth(i),visible=await item.isVisible();if(visible)visibleCount++;
  const entry: any={visible};
  if(attributes){
   check();const type=await item.getAttribute('type',{timeout:2000});check();const accept=await item.getAttribute('accept',{timeout:2000});
   if(typeof type==='string'&&/^[a-z]{1,24}$/.test(type))entry.type=type;
   if(typeof accept==='string'&&/^[A-Za-z0-9/*.,;+ -]{0,200}$/.test(accept))entry.accept=accept;
  }
  items.push(entry);
 }
 return {count,visibleCount,...attributes?{items}: {},...count>10?{truncated:true}:{}};
}
export function sanitizePublisherDiagnostics(value?: any) {
 const out: any={state:['observed','unavailable','error'].includes(value?.state)?value.state:'error'};
 if(['OWNER_NOT_RUNNING','PAGE_UNAVAILABLE','DIAGNOSTICS_FAILED'].includes(value?.code))out.code=value.code;
 if(diagnosticPhases.has(value?.phase))out.phase=value.phase;
 if(errorKinds.has(value?.errorKind))out.errorKind=value.errorKind;
 try{const url=new URL(value?.url);if(url.protocol==='https:'&&url.hostname==='creator.douyin.com'&&!url.username&&!url.password&&url.pathname.length<=200)out.url=url.origin+url.pathname;}catch{}
 if(value?.controls){out.controls={};for(const name of (['upload','fileInputs','editor','publishButton'] as const)){
  const item=value.controls[name];if(!item||!Number.isInteger(item.count)||item.count<0||item.count>10000||!Number.isInteger(item.visibleCount)||item.visibleCount<0||item.visibleCount>item.count)continue;
  out.controls[name]={count:item.count,visibleCount:item.visibleCount,items:(Array.isArray(item.items)?item.items:[]).slice(0,10).map((x)=>({visible:x.visible===true,...typeof x.type==='string'&&/^[a-z]{1,24}$/.test(x.type)?{type:x.type}:{},...typeof x.accept==='string'&&/^[A-Za-z0-9/*.,;+ -]{0,200}$/.test(x.accept)?{accept:x.accept}:{}})),...item.truncated===true?{truncated:true}:{}};
 }}
 return out;
}
/** Same owned page only. No upload, editor mutation, click, or submit. */
export async function publisherDiagnostics(page?: any,{onPhase=()=>{},isExpired=()=>false}: { onPhase?: (...args: any[]) => any; isExpired?: (...args: any[]) => any; [key: string]: any }={}) {
 let phase='navigation';
 const check=()=>{if(isExpired())throw Object.assign(Error('Diagnostic expired'),{code:'DIAGNOSTIC_DEADLINE'});};
 const enter=(value)=>{check();phase=value;onPhase(value);};
 try{
  enter('navigation');await page.goto(CREATOR_UPLOAD,{waitUntil:'domcontentloaded',timeout:12000});
  enter('attachment');await waitForControlAttachment(page.locator('input[type="file"]'));
  const controls: Record<string, any>={};
  for(const [name,locator] of ([['upload',()=>page.locator('input[type="file"][accept*="image"]')],['fileInputs',()=>page.locator('input[type="file"]')],['editor',()=>page.locator('[contenteditable="true"]')],['publishButton',()=>page.getByRole('button',{name:'发布',exact:true})]] as const)){
   enter('control_'+name);controls[name]=await controlSummary(locator(),true,check);
  }
  check();return sanitizePublisherDiagnostics({state:'observed',url:page.url(),controls});
 }catch(error){
  // Never return exception messages, DOM content, request URLs or credentials.
  const closed=page.isClosed?.()===true||error?.name==='TargetClosedError';
  return diagnosticFailure(phase,closed?'page_closed':error?.code==='DIAGNOSTIC_DEADLINE'?'deadline':error?.name==='TimeoutError'?'timeout':phase==='navigation'?'navigation_failed':'dom_failed');
 }
}
