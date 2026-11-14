import {validId} from './registry-common.mjs';
const endpoints=new Set<any>(['overview','events','traces','logs','relationships','mood','pipeline','prompts','prompt']);
function validMoodQuery(payload?: any){
 const keys=Object.keys(payload);
 return keys.length===0||(keys.length===2&&keys.includes('action')&&keys.includes('mode')&&payload.action==='mode'&&['paused','observe','express'].includes(payload.mode));
}
function validPipelineQuery(payload?: any){
 const textKeys=['eventId','batchId','requestId','ticketId','channel','sessionId'];
 return Object.entries(payload).every(([key,value])=>textKeys.includes(key)?typeof value==='string'&&value.length<=512:key==='limit'?typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=100:key==='beforeSeq'?typeof value==='number'&&Number.isSafeInteger(value)&&value>0:false);
}
// One prompt by id: its definition, a page of its recorded renders, or one render expanded by `seq`.
function validPromptQuery(payload?: any){
 const positive=(value?: any)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
 return validId(payload.id)&&Object.entries(payload).every(([key,value])=>key==='id'||(key==='limit'?positive(value)&&(value as number)<=100:['beforeSeq','seq'].includes(key)&&positive(value)));
}
export function registerConsole(ctx?: any,runtime?: any){
 if(typeof ctx.inject!=='function')return;
 return ctx.inject(['connection'],(host)=>host.connection.fetch.register({path:'/api/chopsticks-console',methods:['POST'],requestBody:'buffered',async fetch(request?: any){
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return new Response('JSON required',{status:415});
  let envelope;try{envelope=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
  if(envelope?.type!=='client-request'||typeof envelope.rpcId!=='string'||envelope.rpcId.length>512||envelope.method!=='chopsticks-console')return new Response('Invalid RPC request',{status:400});
  let result;try{const {endpoint,payload={}}=envelope.payload||{};if(!endpoints.has(endpoint))throw Error('Unknown console endpoint');if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid query');if(endpoint==='pipeline'&&!validPipelineQuery(payload))throw Error('Invalid pipeline query');if(endpoint==='mood'&&!validMoodQuery(payload))throw Error('Invalid mood query');if(endpoint==='prompts'&&Object.keys(payload).length)throw Error('Invalid prompts query');if(endpoint==='prompt'&&!validPromptQuery(payload))throw Error('Invalid prompt query');result={ok:true,value:await runtime.queryConsole(endpoint,payload)};}catch{result={ok:false,error:{message:'Console query unavailable or invalid'}};}
  return Response.json({type:'server-response',rpcId:envelope.rpcId,result});
 }}));
}
