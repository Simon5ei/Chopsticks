const MAX_BYTES=8*1024*1024;
const engines=new Set<any>(['auto','saucenao','tracemoe','iqdb','lens']);
const explicitRequest=/(?:帮(?:我|忙)|请|麻烦|能否|能不能|给我|我要|想要).{0,20}(?:搜图|识图|找图|找鸡|查图|查人|找人|识别)|(?:查|找|搜|求).{0,30}(?:出处|来源|账号|主页|是谁|身份)|什么番|哪部(?:番|动漫|动画)|什么(?:动漫|动画)|这.{0,12}(?:哪来的|哪儿来的|出自哪|哪一集|是谁|账号|主页)|^(?:\/鱼鱼找鸡|搜图|识图|找图|找鸡|查图|出处|来源)[?？!！。\s]*$|(?:please\s+)?(?:find|search).{0,20}(?:anime|image|coser|account)\s*source/i;
const declinedRequest=/(?:不要|不用|不必|别|禁止|停止|取消|无需|不需要).{0,24}(?:搜|查|找|识图|上传)|(?:do\s*not|don't|stop|cancel|no\b).{0,24}(?:search|upload|reverse)/i;
function abort(signal?: any){if(signal?.aborted)throw signal.reason??new Error('Search aborted');}
function decodeImage(image?: any){
 if(image?.type!=='image'||typeof image.data!=='string'||image.data.length>4*Math.ceil(MAX_BYTES/3)||image.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))throw Error('Unsupported or oversized image');
 const bytes=Buffer.from(image.data,'base64'),mime=image.mimeType;
 if(bytes.length>MAX_BYTES||bytes.toString('base64')!==image.data)throw Error('Unsupported or oversized image');
 const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  :mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255
  :mime==='image/gif'?/^GIF8[79]a$/.test(bytes.subarray(0,6).toString())
  :mime==='image/webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':false;
 if(!valid)throw Error('Unsupported image signature');
 return {bytes,mime};
}

/** Scoped, explicit image-source queries. No URLs/paths or send API; only public-account candidates from search results, never face recognition. */
export function createAnimeSourceService({store,adapter,search,now=Date.now}: { store?: any; adapter?: any; search?: any; now?: any; [key: string]: any }){
 const run=search??((...args)=>import('../image-source/client.mjs').then((m)=>m.searchAnimeImage(...args)));
 const cache=new Map();let busy=false;
 return {async lookup(caller?: any,args?: any,{signal,callId}: { signal?: any; callId?: any; [key: string]: any }={}){
  abort(signal);
  if(caller?.role!=='qq'||!/^[gp]:\d+$/.test(caller?.channel||'')||caller.consumed!==true)throw Error('Consumed QQ source required');
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some((k)=>!['messageId','engine'].includes(k))||typeof args.messageId!=='string'||!/^[-]?\d{1,20}$/.test(args.messageId)||!engines.has(args.engine??'auto'))throw Error('Only a received image message ID and anime engine are accepted');
  const source=store.get(caller.eventId);
  if(source?.channel!==caller.channel||source.kind!=='message.received'||source.actorId!==caller.actorId)throw Error('Current QQ source mismatch');
  const requestText=(source.meta?.segments||[]).filter((s)=>s.type==='text').map((s)=>String(s.data?.text||'')).join(' ').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|'[^']*'|^>.*$/gm,'');
  if(!explicitRequest.test(requestText)||declinedRequest.test(requestText))throw Error('An explicit image source or public-account request is required');
  const ids=new Set<any>([String(source.meta?.messageId),...(source.meta?.segments||[]).filter((s)=>s.type==='reply').map((s)=>String(s.data?.id))]);
  if(!ids.has(args.messageId))throw Error('Only the current image or its explicit reply target is allowed');
  const imageEvent=store.get(`qq:${caller.channel}:${args.messageId}`);
  if(imageEvent?.channel!==caller.channel||imageEvent.kind!=='message.received'||!(imageEvent.meta?.segments||[]).some((s)=>s.type==='image'||s.type==='mface'))throw Error('Image was not received in this channel');
  const selected=args.engine??'auto',key=JSON.stringify([source.id,args.messageId,selected]);
  const existing=cache.get(key);if(existing&&existing.until>now())return structuredClone(existing.result);
  if(busy)throw Error('Image source service busy; retry later');
  busy=true;
  try{
   const controller=AbortSignal.timeout(45000),combined=signal?AbortSignal.any([signal,controller]):controller;
   const image=await adapter.getImage({channel:caller.channel,messageId:args.messageId,maxImages:1,signal:combined});
   abort(combined);const {bytes,mime}=decodeImage(image.content?.[0]);
   const result=await run(bytes,mime,{...(selected==='auto'?{}:{engines:[selected]}),signal:combined});
   abort(combined);
   store.append({id:`anime-source:${source.id}:${args.messageId}:${selected}`,kind:'task.result',channel:caller.channel,actorId:'fish',text:`我按用户要求查询了图片来源与公开社交账号。候选并非身份确认：${JSON.stringify(result).slice(0,6000)}`,meta:{route:false,passive:true,sourceEventId:source.id,messageId:args.messageId,...callId?{callId}:{}}});
   cache.set(key,{until:now()+600000,result:structuredClone(result)});while(cache.size>100)cache.delete(cache.keys().next().value);
   return result;
  }finally{busy=false;}
 }};
}
