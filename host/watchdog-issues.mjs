import {open} from 'node:fs/promises';
import {hash} from './state.mjs';

// This private administrator file is evidence, never an execution policy.
// Bound both the read itself and every accepted field before persisting sources.
export async function readWatchdogIssues(file,clean){
 let handle;
 try{
  handle=await open(file,'r');
  if(!(await handle.stat()).isFile())return {state:'error',code:'read_failed'};
  const buffer=Buffer.alloc(65537);let size=0;
  while(size<buffer.length){const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead;}
  if(size>65536)return {state:'error',code:'too_large'};
  let doc;
  try{
   doc=JSON.parse(buffer.subarray(0,size).toString('utf8'));
   const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
   const text=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error();return clean(v);};
   const list=v=>{if(!Array.isArray(v)||v.length>8)throw Error();return v.map(s=>text(s,400));};
   // Total bytes and validated content remain bounded; record count is not capped.
   if(!exact(doc,['version','issues'])||doc.version!==1||!Array.isArray(doc.issues))throw Error();
   const seen=new Set();
   const issues=doc.issues.map(v=>{
    if(!exact(v,['id','title','symptom','confirmedFacts','hypotheses','recovery','status'])||typeof v.id!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(v.id)||seen.has(v.id)||!['open','investigating','mitigated','resolved'].includes(v.status))throw Error();
    seen.add(v.id);
    const issue={id:v.id,title:text(v.title,160),symptom:text(v.symptom,800),confirmedFacts:list(v.confirmedFacts),hypotheses:list(v.hypotheses),recovery:list(v.recovery),status:v.status};
    if(JSON.stringify(issue).length>3000)throw Error();return issue;
   }).sort((a,b)=>a.id.localeCompare(b.id));
   if(JSON.stringify(issues).length>24000)throw Error();
   return {state:'ready',version:1,digest:hash({version:1,issues}),issues};
  }catch{return {state:'error',code:'invalid_document'};}
 }catch{return {state:'error',code:'read_failed'};}finally{await handle?.close().catch(()=>{});}
}
