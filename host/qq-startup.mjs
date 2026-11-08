/** Supervise only login/startup; the adapter owns websocket reconnects and sends. */
export function createQQStartup({adapter,onStarted=()=>{},now=Date.now}) {
 let closed=false,pending=false,timer=null,attempts=0;
 let current={state:'idle',attempts:0,nextRetryAt:null};
 async function attempt() {
  if(closed||pending||current.state==='started')return;
  pending=true;
  current={state:'starting',attempts:++attempts,nextRetryAt:null};
  try {
   await adapter.start();
   if(closed)return;
   onStarted();
   current={state:'started',attempts,nextRetryAt:null};
  } catch {
   if(closed)return;
   const wait=Math.min(30000,1000*2**Math.min(attempts-1,5));
   // Do not retain gateway exception text, URLs, account details or credentials.
   current={state:'offline',attempts,nextRetryAt:now()+wait,code:'qq_startup_unavailable'};
   timer=setTimeout(()=>{timer=null;void attempt();},wait);
   timer.unref?.();
  } finally {pending=false;}
 }
 return {
  start(){if(!closed&&!timer)void attempt();},
  status(){return {...current};},
  close(){if(closed)return;closed=true;clearTimeout(timer);timer=null;current={state:'closed',attempts,nextRetryAt:null};return adapter.close();}
 };
}
