import fs from 'node:fs/promises';
import path from 'node:path';

const API='https://api.bilibili.com',MAX_BYTES=1024*1024;
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,21}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
const parse=text=>JSON.parse(text,(_key,value,context)=>typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value)?context.source:value);

/** Read-only verification of one already-confirmed dynamic. Never publishes,
 * retries or substitutes a recent item for the precise receipt identifier. */
export async function readBiliDynamicReceipt({fishHome,receipt,expectedText,fetchImpl=globalThis.fetch,signal,timeoutMs=15000}={}){
 let phase='input',endpoint,apiCode;
 const controller=new AbortController(),abort=()=>controller.abort();
 const timer=setTimeout(abort,Math.max(1,Math.min(Number(timeoutMs)||15000,60000)));
 signal?.addEventListener('abort',abort,{once:true});
 try{
  if(signal?.aborted)controller.abort();controller.signal.throwIfAborted();
  if(typeof fishHome!=='string'||!path.isAbsolute(fishHome)||receipt?.status!=='confirmed'||receipt.kind!=='dynamic'||typeof receipt.id!=='string'||!id(receipt.id)||receipt.url!==`https://t.bilibili.com/${receipt.id}`||typeof expectedText!=='string'||!expectedText||expectedText.length>2000)throw Error();
  phase='credentials';
  const [cred,cfg]=await Promise.all(['bili/credentials.json','bili.config.json'].map(async name=>parse(await fs.readFile(path.join(fishHome,name),'utf8'))));
  if(!id(cfg.self?.mid)||!['sessdata','bili_jct','buvid3'].every(k=>typeof cred[k]==='string'&&cred[k]&&!/[\r\n;]/.test(cred[k])))throw Error();
  const headers={'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/',cookie:`SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`};
  async function get(route,params={}){
   endpoint=route;controller.signal.throwIfAborted();
   const response=await fetchImpl(`${API}${route}?${new URLSearchParams(params)}`,{method:'GET',headers,redirect:'manual',signal:controller.signal});
   if(!response.ok||response.redirected||Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw Error();}
   const reader=response.body?.getReader();if(!reader)throw Error();
   const chunks=[];let bytes=0;const cancel=()=>{void reader.cancel().catch(()=>{});};
   controller.signal.addEventListener('abort',cancel,{once:true});
   try{for(;;){controller.signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();throw Error();}chunks.push(value);}}
   finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
   controller.signal.throwIfAborted();const result=parse(Buffer.concat(chunks).toString('utf8'));
   if(result?.code!==0){apiCode=Number.isSafeInteger(result?.code)?result.code:null;throw Error();}return result.data;
  }
  phase='account';const nav=await get('/x/web-interface/nav');
  if(nav?.isLogin!==true||id(nav.mid)!==id(cfg.self.mid))throw Error();
  phase='detail';const detail=await get('/x/polymer/web-dynamic/v1/detail',{id:receipt.id,features:'itemOpusStyle'});
  phase='verify';const item=detail?.item,modules=item?.modules,dynamic=modules?.module_dynamic;
  const text=dynamic?.desc?.text??dynamic?.major?.opus?.summary?.text;
  if(item?.id_str!==receipt.id||id(modules?.module_author?.mid)!==id(cfg.self.mid)||text!==expectedText)throw Error();
  return {status:'verified',kind:'dynamic',id:receipt.id,url:receipt.url};
 }catch{
  throw Object.assign(new Error(`Bili dynamic readback unverified at ${phase}${apiCode!=null?` (API code ${apiCode})`:''}; keep the original receipt and do not republish`),{code:'BILI_READBACK_UNKNOWN',phase,...endpoint?{endpoint}:{},...apiCode!==undefined?{apiCode}:{}});
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
