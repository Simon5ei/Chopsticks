import fs from 'node:fs';
import path from 'node:path';
export const ROUTER_ID='chopsticks-router';
export const isRouterSession=(id)=>/^chopsticks-router-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id);
export function createRouterSessions({state,stateDir,getAgent,archive,release=async()=>{},record=()=>{},retryMs=5000}: { state?: any; stateDir?: any; getAgent?: any; archive?: any; release?: (...args: any[]) => any; record?: (...args: any[]) => any; retryMs?: number; [key: string]: any }){
 const pending=new Map(),active=new Set<any>();let sweeping;
 function save(row?: any){state.put('router-session',row.sessionId,row);return row;}
 function begin(sessionId?: any){if(!isRouterSession(sessionId))throw Error('Invalid Router session');active.add(sessionId);pending.set(sessionId,save({sessionId,status:'active',createdAt:new Date().toISOString()}));}
 function finish(sessionId?: any,outcome?: any){active.delete(sessionId);const row=pending.get(sessionId);if(row)pending.set(sessionId,save({...row,status:'pending',outcome,finishedAt:new Date().toISOString()}));}
 function recover(){
  for(const row of state.list('router-session'))if(isRouterSession(row.sessionId)&&!['archived','absent'].includes(row.status)&&!active.has(row.sessionId))pending.set(row.sessionId,save({...row,status:'pending',outcome:row.outcome||'interrupted'}));
  const root=path.join(stateDir,'workers');if(!fs.existsSync(root))return;
  const known=new Set<any>(state.list('router-session').map((row)=>row.sessionId));
  for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isDirectory()&&isRouterSession(entry.name)&&!known.has(entry.name))pending.set(entry.name,save({sessionId:entry.name,status:'pending',outcome:'legacy'}));
 }
 async function run(){
  if(!archive)return;
  for(const [id,row] of pending){
   if(active.has(id)||(row.retryAt||0)>Date.now())continue;
   const agent=getAgent(id);
   if(agent&&(agent.status==='running'||agent.inbox?.nextTurn?.length||agent.inbox?.nextStep?.length))continue;
   try{
    // Native archive independently checks activity. Never force-stop here.
    try{await archive(id);}catch(error){if(error?.name==='WorkspaceUnknownSessionError'&&!getAgent(id)){await release(id);save({...row,status:'absent'});pending.delete(id);continue;}throw error;}
    const released=await release(id);
    if(released?.warning)record({kind:'router.release_warning',sessionId:id,level:'warn',data:{code:released.warning}});
    save({...row,status:'archived',archivedAt:new Date().toISOString(),retryAt:undefined});pending.delete(id);
    record({kind:'router.archived',sessionId:id,data:{outcome:row.outcome}});
   }catch{pending.set(id,save({...row,status:'pending',retryAt:Date.now()+retryMs}));record({kind:'router.archive_retry',sessionId:id,level:'warn'});}
  }
 }
 function sweep(){if(!sweeping)sweeping=run().finally(()=>{sweeping=undefined;});return sweeping;}
 return {begin,finish,recover,sweep};
}
