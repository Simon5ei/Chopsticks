export function endpoint(request,host,path){try{const u=new URL(request.url());return u.protocol==='https:'&&u.hostname===host&&u.pathname.replace(/\/$/,'')===path.replace(/\/$/,'')&&request.method()==='POST';}catch{return false;}}
// The UI chooses controls; this gate verifies the actual outgoing target and
// payload before the browser may transmit it. Native retries are never allowed.
export async function guardedSubmit({page,host,path,validate,submit}) {
  let submitted=false,sent,blocked=false,resolveBlocked;
  const blockedWait=new Promise(r=>resolveBlocked=r);
  const matcher=u=>u.protocol==='https:'&&u.hostname===host&&u.pathname.replace(/\/$/,'')===path.replace(/\/$/,'');
  const handler=async route=>{
    const request=route.request();let valid=false;
    try{valid=!submitted&&endpoint(request,host,path)&&await validate(request);}catch{}
    if(!valid||submitted){await route.abort();if(!submitted){blocked=true;resolveBlocked(null);}return;}
    submitted=true;sent=request;await route.continue();
  };
  await page.route(matcher,handler);
  // Keep blocking duplicate native SDK retries until this document is gone.
  // Releasing immediately on HTTP 500 or a malformed receipt would let the
  // site's own retry run outside our exactly-once gate.
  const dispose=async()=>{page.off?.('framenavigated',navigation);await page.unroute(matcher,handler).catch(()=>{});};
  const navigation=frame=>{if(frame===page.mainFrame())void dispose();};
  if(typeof page.mainFrame==='function')page.on('framenavigated',navigation);
  try {
    const pending=page.waitForResponse(r=>r.request()===sent,{timeout:20000});pending.catch(()=>{});
    await submit();const response=await Promise.race([pending,blockedWait]);
    return {submitted,blocked,response,request:sent};
  } catch {
    // Cancel the page's SDK retry timers before releasing the request gate.
    await page.close?.().catch(()=>{});
    await dispose();
    return {submitted,blocked,unknown:true};
  }
}
