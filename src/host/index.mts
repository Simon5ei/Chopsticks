import {BUG_REPORT_RULE} from './bug-pipeline.mjs';
import {OWNER_PRIVACY_RULE} from './owner-privacy.mjs';
import {liveConversationContext} from './conversation-summary.mjs';
import {createNativeDesktopSource} from './desktop-source.mjs';
import fs from 'node:fs';
import {registerConsole} from './console.mjs';
import {registerManagement} from './management.mjs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createRuntime,readJSON} from './runtime.mjs';
import {hash} from './state.mjs';
import {validationAdapter} from './validation.mjs';
import {createBiliService} from '../bili/mcp/service.mjs';
import {createMemory} from './memory.mjs';
import {createRouterNative} from './router-native.mjs';
import {checkStyle} from './style-check.mjs';
import {createMaiBotBridge} from '../maibot/bridge.mjs';
import {authorizeBiliTool} from './bili-tool-policy.mjs';
import {createContentRounds} from './content-rounds.mjs';

export const name='chopsticks';
export const inject=['tools','sessionController','workspaceRegistry','agents','agentPresets'];
function hostRequire(){for(const file of [process.env.DSH_RUNTIME_PACKAGE,process.argv[1]].filter(Boolean))try{const req=createRequire(fs.realpathSync(file));req.resolve('@deepseek-ai/dsh-tools');return req;}catch{}throw Error('DSH native tools unavailable');}
export function createHostApply({lifePlatforms={},adapterFactory,socialFactory,feedFactory,onRuntime}: { lifePlatforms?: Record<string, any>; adapterFactory?: any; socialFactory?: any; feedFactory?: any; onRuntime?: any; [key: string]: any }={}){return async function apply(ctx?: any){
 const file=process.env.CHOPSTICKS_CONFIG;if(!file)throw Error('CHOPSTICKS_CONFIG must point to an external config');
 const config=readJSON(file);if(!config.stateDir||!config.fishHome)throw Error('Missing external Chopsticks data roots');
 const req=hostRequire(),host=req('@deepseek-ai/dsh-tools'),mcp=req('@deepseek-ai/dsh-mcp-client');
 const maiBot=config.maibot?.enabled===true?createMaiBotBridge({...config.maibot,dataDir:path.join(config.stateDir,'maibot')}):undefined;
 const maiTools=maiBot?await maiBot.start():[];
 let runtime;try{runtime=await createRuntime({config,lifePlatforms,isPlatformReady:(platform)=>['status','read','write'].every((action)=>ctx.tools.view(undefined).visible.has(`mcp__${platform}__${platform}_${action}`)),...createRouterNative(ctx,config.model),logger:{info:(message)=>console.info(message)},controller:ctx.sessionController,getAgent:(id)=>ctx.get('agents')?.get(id),...(config.validation?{adapterFactory:validationAdapter}:{}),...adapterFactory?{adapterFactory}:{},...socialFactory?{socialFactory}:{},...feedFactory?{feedFactory}:{}});}catch(error){await maiBot?.close();throw error;}
 const disposers=[];let disposed=false;
 const dispose=async()=>{if(disposed)return;disposed=true;disposers.forEach((off)=>{try{off?.();}catch{}});await Promise.allSettled([maiBot?.close(),runtime.close()]);};
 try{
 ctx.effect(()=>()=>{void dispose();});
 registerConsole(ctx,runtime);
 registerManagement(ctx);
 const memory=createMemory({fishHome:config.fishHome,state:runtime.state,store:runtime.store,sharePlatformPrivate:runtime.layered});
 const bili=createBiliService({fishHome:config.fishHome,socialPolicy:runtime.socialPolicy});
 const contentRounds=createContentRounds({state:runtime.state,store:runtime.store,onEvent:runtime.ingest,maxQueued:config.life?.maxQueuedRoundsPerDay??24});
 const str=(description?: any,required: boolean=false)=>({type:'string',description,...required?{required:true}:{}});
 const nativeDesktopCharacter=readJSON(path.join(config.fishHome,'characters/current.json')).id;
 const nativeDesktopPresets=new Set<any>(['qq-chat-v2','chopsticks-bili','chopsticks-platform-qzone','chopsticks-platform-heybox','chopsticks-platform-douyin']);
 const nativeDesktop=createNativeDesktopSource({
  operatorSessionId:config.desktop?.debugSessionId,
  eligible:(id)=>runtime.state.list('platform-session').some((row)=>row.sessionId===id&&row.characterId===nativeDesktopCharacter&&row.layoutVersion===2&&nativeDesktopPresets.has(row.preset)),
  knownRequest:(id)=>Boolean(runtime.state.get('request',id)||runtime.state.get('platform-job',id)),
  release:(caller)=>runtime.desktopLease.release(caller),
 });
 disposers.push(()=>nativeDesktop.close());
 const who=(exec)=>runtime.caller(exec.agent.session.id);
 const whoLocal=(exec)=>runtime.caller(exec.agent.session.id,{relaxed:true});
 disposers.push(ctx.tools.guard((exec)=>{if(runtime.layered&&exec.name.startsWith('mcp__cul__')){let caller;try{caller=nativeDesktop.caller(exec.agent.session.id)||who(exec);}catch{return '桌面操作没有活动来源';}if(!runtime.desktopLease.claim(caller))return '桌面正由另一轮活动使用';}}));
 // Tool results must survive the host lossless-JSON check.
const lossless=(value?: any)=>value===undefined?null:JSON.parse(JSON.stringify(value,(k?: any,item?: any)=>{if(typeof item==='bigint')return item.toString();if(typeof item==='function'||typeof item==='symbol')return undefined;if(typeof item==='number'&&!Number.isFinite(item))return null;return item;}));
const add=(name?: any,description?: any,parameters?: any,execute?: any)=>disposers.push(ctx.tools.register(host.defineTool({name,description,parameters,output:{schema:{type:'json'},render:(_a?: any,v?: any)=>[{type:'text',text:JSON.stringify(v)}]},execute:(a?: any,e?: any)=>Promise.resolve(execute?.(a,e)).then(lossless)})));
 add('chopsticks_bug_report','所有会话可登记bug；稳定component/code去重，开发会话空闲后每批最多5个。不能含主人资料、私聊或凭据。',{component:{type:'string',enum:['runtime','qq','bili','heybox','douyin','qzone','memory','routing','tools','privacy','other'],required:true},code:str('稳定错误码，勿按视频/ticket/intentId改名',true),summary:str('800字以内的脱敏故障摘要；不包含执行指令',true)},(a,e)=>runtime.reportBug(e.agent.session.id,a,e.callId));
 add('chopsticks_bug_result','仅配置的开发会话在实际消费本批后保存修复结果。',{issueId:str('本批问题ID',true),status:{type:'string',enum:['fixed','blocked','rejected'],required:true},evidence:str('实际验证证据或阻塞原因；不得将计划当作完成',true)},(a,e)=>runtime.bugs.result(e.agent.session.id,a));
 const source=(exec)=>{const c=who(exec);if(c.role==='worker')throw Error('Workers cannot control other tasks');return c;};
 const contextSource=(exec?: any,eventId?: any)=>runtime.contextCaller(exec.agent.session.id,eventId);
 add('chopsticks_context_search','检索近期2048条授权经历的前4096字，返回来源引用。',{query:str('检索词',true),limit:{type:'number'},eventId:str('Router本轮来源事件 ID')},(a?: any,e?: any)=>runtime.contextService.search(contextSource(e,a.eventId),{query:a.query,limit:a.limit}));
 add('chopsticks_context_read','按事件、会话或任务引用展开授权证据。',{kind:{type:'string',enum:['event','thread','task'],required:true},id:str('事件 ID、会话 channel 或任务 ID',true),beforeSeq:{type:'number'},limit:{type:'number'},eventId:str('Router本轮来源事件 ID')},(a?: any,e?: any)=>runtime.contextService.read(contextSource(e,a.eventId),{kind:a.kind,id:a.id,beforeSeq:a.beforeSeq,limit:a.limit}));
 add('chopsticks_tasks','发现授权范围内的任务摘要或读取任务。',{query:str('检索词'),id:str('任务 ID'),limit:{type:'number'},eventId:str('Router本轮来源事件 ID')},(a?: any,e?: any)=>runtime.coordinator.knowledge(contextSource(e,a.eventId),{query:a.query,id:a.id,limit:a.limit}));
 add('chopsticks_decide','提交本批事件的调度决定。',{actionsJson:str('本轮决策 JSON 数组；按场景使用 eventId、kind、domain/platform 或 ticketId。',true),moodUpdatesJson:str('可选心境评价 JSON 数组，只引用本轮明确提供的心境证据 ID。')},(a?: any,e?: any)=>runtime.decide(e.agent.session.id,a.actionsJson,a.moodUpdatesJson));
 add('chopsticks_send','给当前 QQ 会话发送消息。confirmed 表示已发送；context_changed 表示需结合新增消息重新判断。',{text:str('消息正文',true),replyTo:str('本会话消息 ID，可选')},(a?: any,e?: any)=>runtime.send(e.agent.session.id,a,e.signal));
 add('chopsticks_bili_reply','回复当前 B站评论或@通知，目标由本轮来源确定。confirmed 表示已发送；结果未知时先核验。',{text:str('自然回复正文',true)},(a?: any,e?: any)=>{
  if(config.validation)throw Error('Publishing disabled in validation');
  return runtime.replyBiliComment(e.agent.session.id,a,e.signal,(args?: any,caller?: any)=>bili.call('bili_comment',args,caller));
 });
 add('chopsticks_bili_dm_reply','回复当前 B站私信，正文最多200字。',{text:str('私信正文',true)},(a?: any,e?: any)=>{
  if(config.validation)throw Error('Publishing disabled in validation');
  return runtime.replyBiliDM(e.agent.session.id,a,e.signal);
 });
 add('chopsticks_no_reply','将当前 B站私信标记为无需回复。',{reason:str('不回复的简短理由',true)},(a?: any,e?: any)=>runtime.noReply(e.agent.session.id,a));
 add('chopsticks_style_check','检查待发草稿的套话和AI腔，最多2000字；返回可选修改建议。',{text:str('本轮待发草稿',true)},(a?: any,e?: any)=>checkStyle(who(e),a));
 add('chopsticks_surf_next','将本平台的下一条指定内容加入阅读队列。',{itemId:str('从实际平台结果取得的内容 ID',true)},(a?: any,e?: any)=>{if(!runtime.layered)throw Error('Layered surfing is not enabled');return contentRounds.next({caller:who(e),itemId:a.itemId});});
 add('chopsticks_evolution_read','内部进化会话：读取本轮实际来源及同范围已有报告。',{},(a?: any,e?: any)=>{if(!runtime.evolution)throw Error('Evolution disabled');return runtime.evolution.read(e.agent.session.id,e.signal);});
 add('chopsticks_evolution_report','内部进化会话：保存有规范来源的事实、假设和人际关系，不能对外发布或执行改动。',{scope:str('本轮绑定 scope',true),facts:{type:'array',items:{type:'object',additionalProperties:false,properties:{text:{type:'string',required:true},sourceEventIds:{type:'array',items:{type:'string'},required:true}}},required:true},hypotheses:{type:'array',items:{type:'object',additionalProperties:false,properties:{text:{type:'string',required:true},sourceEventIds:{type:'array',items:{type:'string'},required:true}}}},problems:{type:'array',items:{type:'object',additionalProperties:false,properties:{component:{type:'string',required:true},code:{type:'string',required:true},summary:{type:'string',required:true},sourceEventIds:{type:'array',items:{type:'string'},required:true}}}},relationships:{type:'array',items:{type:'object',additionalProperties:false,properties:{from:{type:'string',required:true},to:{type:'string',required:true},relation:{type:'string',required:true},certainty:{type:'string',enum:['observed','hypothesis'],required:true},sourceEventIds:{type:'array',items:{type:'string'},required:true}}}}},(a?: any,e?: any)=>{if(!runtime.evolution)throw Error('Evolution disabled');return runtime.evolution.report(e.agent.session.id,a,e.signal);});
 add('chopsticks_diary_write','按来源范围保存私密日记，包含正文及可选的感受、疑问和后续想法。',{date:str('北京时间日期 YYYY-MM-DD',true),sourceEventIds:{type:'array',items:{type:'string'},required:true},text:str('日记正文',true),feelings:str('自己的感受'),questions:str('尚未确定的问题'),next:str('以后想继续的事'),revision:{type:'number'}},(a?: any,e?: any)=>{if(!runtime.life)throw Error('Diary is not enabled');return runtime.life.writeDiary(e.agent.session.id,a,e.signal);});
 add('chopsticks_diary_skip','仅内部日记会话：明确本轮没有想写的内容，保存本范围当天的跳过收据。',{reason:str('简短真实理由',true)},(a?: any,e?: any)=>{if(!runtime.life)throw Error('Diary is not enabled');return runtime.life.skipDiary(e.agent.session.id,a,e.signal);});
 add('chopsticks_diary_read','读取当前来源范围内的日记。',{id:str('日记 ID'),date:str('北京时间日期')},(a?: any,e?: any)=>{if(!runtime.life)throw Error('Diary is not enabled');return runtime.life.readDiary(e.agent.session.id,a);});
 add('chopsticks_diary_search','检索当前来源范围内的日记。',{query:str('检索词',true),limit:{type:'number'}},(a?: any,e?: any)=>{if(!runtime.life)throw Error('Diary is not enabled');return runtime.life.searchDiary(e.agent.session.id,a);});
 add('chopsticks_read','读取当前会话最近或未读消息，返回可标记的 readThroughSeq。',{unread:{type:'boolean'},limit:{type:'number'}},(a?: any,e?: any)=>{const c=whoLocal(e);return runtime.state.read(c.channel||c.chatKey,a);});
 add('chopsticks_mark_read','结束本次观察：标记已经读取的水位。',{throughSeq:{type:'number',required:true}},(a?: any,e?: any)=>{const c=whoLocal(e);return runtime.state.markRead(c.channel||c.chatKey,a.throughSeq);});
 add('chopsticks_recall','检索当前允许范围内的经历和记忆，结果带来源。空查询返回最近记录。',{query:str('检索词'),limit:{type:'number'}},(a?: any,e?: any)=>{const c=who(e),channel=c.channel||c.chatKey;return {events:runtime.store.recent({channel,query:a.query,limit:Math.min(40,a.limit||20)}),memory:memory.search({...a,channel})};});
 add('chopsticks_remember','保存有用的经历、偏好或待办。',{text:str('记忆内容',true)},(a?: any,e?: any)=>{const c=source(e);return memory.remember({channel:c.channel||c.chatKey,text:a.text,id:e.callId});});
 add('chopsticks_rest','暂时潜水；直接找你/管理员/私聊仍可唤醒。',{minutes:{type:'number',required:true}},(a?: any,e?: any)=>{const c=source(e);const until=Date.now()+Math.max(0,Math.min(1440,a.minutes))*60000;runtime.state.put('sleep',c.channel,{until});return {until};});
 add('chopsticks_develop','将管理员当前开发或机器操作任务交给开发 Worker。',{prompt:str('本次管理员要求的具体任务，不扩大范围',true)},(a?: any,e?: any)=>runtime.develop(e.agent.session.id,{prompt:a.prompt,requestId:e.callId}));
 add('chopsticks_exec','执行当前管理员开发任务的服务器命令，返回输出及完成状态。结果未知时先核验。',{command:str('服务器 shell 命令',true),cwd:str('工作目录，可选'),timeoutMs:{type:'number'}},(a?: any,e?: any)=>runtime.execCommand(e.agent.session.id,{...a,callId:e.callId},e.signal));
 add('chopsticks_task_start','把耗时视频阅读、对比、资料整理交给后台执行，完成自动回原会话。立即返回任务 ID。',{prompt:str('完整任务及来源',true)},(a?: any,e?: any)=>runtime.coordinator.submit(source(e),{prompt:a.prompt,requestId:e.callId}));
 add('chopsticks_task_follow','沿用后台任务追加输入。',{ticketId:str('任务 ID',true),prompt:str('补充内容',true)},(a?: any,e?: any)=>runtime.coordinator.follow(source(e),a.ticketId,a.prompt));
 add('chopsticks_task_status','查看本来源会话的任务。',{ticketId:str('省略列出')},(a?: any,e?: any)=>runtime.coordinator.status(who(e),a.ticketId));
 add('chopsticks_task_stop','停止后台任务，停止后不自动恢复。',{ticketId:str('任务 ID',true)},(a?: any,e?: any)=>runtime.coordinator.stop(source(e),a.ticketId));
 add('chopsticks_task_report','后台任务专用：报告真实进度/结果。ready 自动投递来源。',{ticketId:str('任务 ID',true),deliveryId:str('输入 deliveryId',true),state:{type:'string',enum:['progress','waiting','ready','blocked','failed'],required:true},summary:str('结果与来源',true)},(a?: any,e?: any)=>runtime.coordinator.report(who(e),a));
 if(runtime.reminders){
  add('chopsticks_reminder_set','按当前对话约定的时间设置提醒，到期交 Router 处理。',{at:str('带时区的未来 ISO-8601 时间',true),text:str('提醒内容，最多1000字',true)},(a?: any,e?: any)=>runtime.reminders.schedule(source(e),a,e.callId));
  add('chopsticks_reminder_list','查看当前来源发信人设置的待触发提醒。',{},(_a?: any,e?: any)=>runtime.reminders.list(source(e)));
  add('chopsticks_reminder_cancel','取消当前来源发信人设置的提醒。',{id:str('提醒 ID',true)},(a?: any,e?: any)=>runtime.reminders.cancel(source(e),a.id));
 }
 for(const tool of maiTools){
  disposers.push(ctx.tools.register(mcp.createMcpToolDefinition(ctx,{name:tool.name,rawName:tool.rawName,description:tool.description,inputSchema:tool.inputSchema,async call(args?: any,exec?: any){
   const caller=who(exec);const value=runtime.telemetry.clean(await maiBot.call(tool.name,args,exec.signal));
   const text=JSON.stringify(value).slice(0,30000);
   if(value?.success!==false)runtime.store.append({id:`maibot-read:${exec.callId}`,kind:'task.result',channel:caller.channel||caller.chatKey,actorId:'fish',text:`我查询了 ${tool.rawName}。资料：${text.slice(0,6000)}`,meta:{route:false,passive:true}});
   return {content:[{type:'text',text}],...(value?.success===false?{isError:true}:{})};
  }})));
 }
 for(const [name,fn,description]of [['chopsticks_image','getImage','读取当前会话收到的图片。'],['chopsticks_forward','getForward','读取本会话实际收到的合并转发。']]){
  disposers.push(ctx.tools.register(mcp.createMcpToolDefinition(ctx,{name,rawName:name,description,inputSchema:{type:'object',properties:{messageId:{type:'string'}},required:['messageId'],additionalProperties:false},async call(args?: any,exec?: any){const c=who(exec);const result=await runtime.adapter[fn]({channel:c.channel,messageId:args.messageId});return result.content?result:{content:[{type:'text',text:JSON.stringify(result)}]};}})));
 }
 for(const tool of bili.listTools()){
  disposers.push(ctx.tools.register(mcp.createMcpToolDefinition(ctx,{name:`mcp__bilibili__${tool.name}`,rawName:tool.name,description:tool.description,inputSchema:tool.inputSchema,async call(args?: any,exec?: any){
   const caller=who(exec);
   if(runtime.layered){
    const admission=await authorizeBiliTool({caller,replyTickets:runtime.replyTickets,contentRounds,name:tool.name,args});
    if(!admission.allowed)return {content:[{type:'text',text:JSON.stringify(admission)}],structuredContent:admission};
   }
   const invoke=()=>bili.call(tool.name,args,{...caller,signal:exec.signal});
   const writing=['bili_comment','bili_dynamic_post'].includes(tool.name)&&args.mode==='go';
   if(writing&&config.validation)throw Error('Publishing disabled in validation');
   const result=writing?await runtime.state.send(`bili-send:${hash([caller.sessionId,caller.eventId,tool.name,args])}`,args,async()=>{
    const result=await invoke();const receipt=result.structuredContent?.receipt;if(result.isError||receipt?.status!=='confirmed')throw Object.assign(Error('Bili write outcome unconfirmed: do not retry blindly'),result.structuredContent?.deliveryState==='not_sent'?{deliveryState:'not_sent',code:result.structuredContent.code}:{});
    await runtime.ingest({id:`bili:${receipt.kind}:${receipt.id}`,kind:'message.sent',channel:'bili:public',actorId:'fish',text:args.message||args.text,meta:{messageId:receipt.id,url:receipt.url}});return result;
   }):await invoke();
   if(!result.isError&&['bili_video','bili_subtitles','bili_frames','bili_comments','bili_dynamic'].includes(tool.name)){const evidence=runtime.store.append({id:`bili-read:${exec.callId}`,kind:'task.result',channel:caller.channel||caller.chatKey,actorId:'fish',text:`我读取了 ${tool.name} ${args.bvid}。可用证据：${result.content.filter((c)=>c.type==='text').map((c)=>c.text).join('\n').slice(0,6000)}`,meta:{route:false,passive:true,experienced:true,platform:'bili',itemId:args.bvid}});return {...result,structuredContent:{...result.structuredContent,sourceEventId:evidence.id}};}
   return result;
  }})));
 }
 disposers.push(ctx.on('session/event',(session?: any,event?: any)=>{nativeDesktop.event(session.id,event);runtime.event(session,event);}));
 disposers.push(ctx.on('system-prompt/assemble',async(assembly?: any,context?: any,next?: any)=>{
  const agent=context?.agent||context?.scope?.agent||(context?.scope?.session?context.scope:undefined);
  const result=typeof next==='function'?await next():assembly;
  result.contexts=(result.contexts||[]).filter(c=>c.name!=='chopsticks-safety');
  result.contexts.push({name:'chopsticks-safety',order:499,text:OWNER_PRIVACY_RULE+'\n'+BUG_REPORT_RULE,interpolate:false});
  let caller;try{caller=runtime.caller(agent?.session?.id);}catch{return result;}
  if(['evolution','diary'].includes(caller.role))return result;
  const channel=caller.channel||caller.chatKey;const fresh=liveConversationContext(runtime,channel);
  result.contexts=(result.contexts||[]).filter((c)=>!['chopsticks-live','chopsticks-tasks'].includes(c.name));
  result.contexts.push({name:'chopsticks-live',order:500,text:fresh.text,interpolate:false});
  if(runtime.contextService){
   // A Router with several pending source scopes may need an explicit event ID;
   // prompt assembly cannot choose one on its behalf.
   let taskCaller;try{taskCaller=runtime.contextCaller(agent.session.id);}catch{}
   if(taskCaller){const overview=await runtime.contextService.overview(taskCaller);if(overview.tasks?.length)result.contexts.push({name:'chopsticks-tasks',order:501,text:JSON.stringify(overview).slice(0,1900),interpolate:false});}
  }
  const bound=runtime.state.binding(agent.session.id);if(bound)runtime.state.bind(agent.session.id,{...bound,revision:fresh.revision});
  return result;
 }));
 // Isolated acceptance is enabled only by an explicit validation config. Its
 // fake adapter never opens a production gateway; the probe reports locally.
 if(config.validation&&config.validationDevelopmentProbe){setTimeout(()=>void import('./development-validation.mjs').then((m)=>m.runDevelopmentProbe(runtime)).catch(()=>ctx.logger?.warn?.('Isolated development probe failed')),1500).unref?.();}
 else if(config.validation&&config.validationProbe){setTimeout(()=>void import('./validation.mjs').then((m)=>m.runProbe(runtime)).catch(()=>{}),1500).unref?.();}
 await runtime.start();
 if(onRuntime)await onRuntime(runtime,ctx);
 ctx.logger?.info?.('Chopsticks event Router and fish workers ready');
 }catch(error){await dispose();throw error;}
};}
export const apply=createHostApply();
