import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const missing = error => ['session/not-found','SESSION_QUERY_SESSION_NOT_FOUND'].includes(error?.code) || error?.name==='ApiSessionNotFound' || error?.constructor?.name==='ApiSessionNotFound';
export function createDshExecutor({controller,workerRoot,prepareWorkspace,model,getAgent=()=>null,onResult,onWorkspace,resolveWorker=()=>({mode:'research'})}) {
  const signal=new AbortController().signal;
  const admit=async(request,deliverySignal,isStillAuthorized)=>{
    const revoked=()=>deliverySignal?.aborted||isStillAuthorized?.()===false;
    if(revoked())return {accepted:false};
    // rc2 checks cancellation before (not after) potentially slow cold-session activation.
    // Restore first, then recheck ownership immediately before prompt admission.
    if(controller.resolveAgent){const resolved=await controller.resolveAgent(request.sessionId);if(resolved?.error)throw resolved.error;}
    if(revoked())return {accepted:false};
    const result=await controller.prompt(request,deliverySignal||signal);
    if(revoked()){
      const agent=getAgent(request.sessionId);
      for(const message of [...agent?.inbox?.nextTurn??[],...agent?.inbox?.nextStep??[]])if(message.source?.rpcId===request.requestId){
        try{await controller.updateQueue({sessionId:request.sessionId,itemId:message.id,action:{kind:'remove'}});}
        catch(error){if(error?.code!=='session/queue-item-not-found')throw error;}
      }
    }
    return result;
  };
  const inspect=async({sessionId,deliveryId})=>{
    try {
      const result=await controller.inspect(sessionId);
      const found=(result.events ?? []).some(event=>event.type==='user/message' && (event.data?.message?.source?.rpcId ?? event.data?.source?.rpcId)===deliveryId);
      // A queued prompt is not yet in the event log. Treat an attached busy worker
      // conservatively; request IDs are also deduplicated by DSH on admission.
      const agent=getAgent(sessionId);
      const queued=[...agent?.inbox?.nextTurn??[],...agent?.inbox?.nextStep??[]].some(message=>message.source?.rpcId===deliveryId);
      return {status:found||queued?'accepted':'unknown'};
    }catch(error){return {status:missing(error)?'not-found':'unknown'};}
  };
  return {
    async ensureSession({sessionId,ticket,caller,signal:launchSignal,isStillAuthorized}) {
      const check=()=>{launchSignal?.throwIfAborted();if(isStillAuthorized?.()===false)throw Error('Task launch authorization revoked');};
      check();
      try {await controller.inspect(sessionId);}
      catch(error){
        if(!missing(error))throw error;
        const cwd=resolveWorker(sessionId).mode==='development' ? path.join(workerRoot,'tasks',createHash('sha256').update(ticket?.id ?? sessionId).digest('hex').slice(0,32)) : workerRoot;
        fs.mkdirSync(cwd,{recursive:true,mode:0o700});
        check();const workspaceId=await prepareWorkspace?.({cwd,title:'后台任务'});check();
        const created=await controller.create({sessionId,...workspaceId?{workspaceId}:{cwd},agentPreset:resolveWorker(sessionId).mode==='development'?'chopsticks-development-worker':'chopsticks-research-worker'});
        if(created.sessionId!==sessionId) throw Error('DSH 未复用指定任务会话，停止以保护映射');
        if(resolveWorker(sessionId).mode==='development')await onWorkspace?.({sessionId,cwd,ticketId:ticket?.id});
      }
      check();if(model?.provider&&model?.model)await controller.selectModel({sessionId,...model});
    },
    async prompt({sessionId,text,deliveryId,signal:deliverySignal,isStillAuthorized}) {
      if(deliverySignal?.aborted || isStillAuthorized?.()===false)return {accepted:false};

      const trusted=resolveWorker(sessionId);
      if(trusted.mode==='development')return admit({sessionId,requestId:deliveryId,mode:'queue',content:[{type:'text',text:
        `【管理员要求】\n${trusted.originalRequest}\n【工作路径】\n代码：/opt/chopsticks\n配置：/var/lib/chopsticks/config.json\n角色与运行数据：/var/lib/chopsticks\n工作区：/root/workspace/dsh\nprojects/ 项目；notes/ 笔记；bili-watch/ 视频清单；scripts/ 脚本\n插件候选清单：/root/workspace/dsh/bili-watch/fish-dsh-plugins.csv\n【任务】\n${text}`
      }]},deliverySignal,isStillAuthorized);
      return admit({sessionId,requestId:deliveryId,mode:'queue',content:[{type:'text',text:
        `【任务】\n${text}`
      }]},deliverySignal,isStillAuthorized);
    },
    async abort({sessionId}) {
      const agent=getAgent(sessionId);
      for(const message of [...agent?.inbox?.nextTurn??[],...agent?.inbox?.nextStep??[]]) {
        if(!String(message.source?.rpcId||'').startsWith('prompt:'))continue;
        try {await controller.updateQueue({sessionId,itemId:message.id,action:{kind:'remove'}});}
        catch(error){if(error?.code!=='session/queue-item-not-found')throw error;}
      }
      try {return controller.cancel({sessionId});}catch(error){if(!missing(error))throw error;return {accepted:true};}
    },
    isRunning:({sessionId})=>{const agent=getAgent(sessionId);return agent ? {running:agent.status==='running',pending:Boolean(agent.inbox?.nextTurn?.length||agent.inbox?.nextStep?.length)} : {running:null,pending:null};},
    inspect,
    deliverResult:({sessionId,text,deliveryId,signal:deliverySignal,isStillAuthorized,ticketId,origin})=>{
      if(deliverySignal?.aborted || isStillAuthorized?.()===false)return {accepted:false};
      // The host may journal this stable delivery ID as a canonical task-result
      // event. It owns final authorization and durable deduplication; exceptions
      // remain uncertain for the coordinator's receipt reconciliation.
      if(onResult)return onResult({sessionId,text,deliveryId,signal:deliverySignal,isStillAuthorized,ticketId,origin});
      return admit({sessionId,requestId:deliveryId,mode:'queue',content:[{type:'text',text:
      `后台任务结果：\n${text}`
    }]},deliverySignal,isStillAuthorized);
    },
  };
}
