/** Serializes physical desktop workflows, without adding a prompt or skill. */
export function createDesktopLease({now=Date.now,ttlMs=180000}={}){
 let holder;
 return {claim(caller){
  if(!caller?.consumed||!caller.sessionId||!caller.requestId)return false;
  if(holder&&holder.until>now()&&(holder.sessionId!==caller.sessionId||holder.requestId!==caller.requestId))return false;
  holder={sessionId:caller.sessionId,requestId:caller.requestId,until:now()+ttlMs};return true;
 },release(caller){if(holder&&holder.sessionId===caller?.sessionId&&holder.requestId===caller?.requestId)holder=undefined;},close(){holder=undefined;}};
}
