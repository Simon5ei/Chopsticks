// Own native Router handles; persistent ones are restored and never auto-archived.
export function createRouterNative(ctx?: any,model?: any){
 const handles=new Map();
 return {
  async prepareWorkspace({cwd,title}: { cwd?: any; title?: any; [key: string]: any }){const workspace=await ctx.workspaceRegistry.create(cwd,title);await workspace.setTitle(title);return workspace.id;},
  async createRouterSession({sessionId,cwd,signal,preset='chopsticks-router',persistent=false}: { sessionId?: any; cwd?: any; signal?: any; preset?: string; persistent?: boolean; [key: string]: any }){
   if(persistent){
    if(ctx.agents.get(sessionId))return;
    try{await ctx.sessionController.inspect(sessionId);const restored=await ctx.sessionController.resolveAgent(sessionId);if(restored?.error)throw Error('Native Router activation failed');return;}
    catch(e){if(!['session/not-found','SESSION_QUERY_SESSION_NOT_FOUND'].includes(e?.code)&&e?.name!=='ApiSessionNotFound'&&e?.constructor?.name!=='ApiSessionNotFound')throw e;}
   }
   const workspace=persistent?await ctx.workspaceRegistry.create(cwd,'Router'):undefined;
   const handle=await ctx.agents.create({sessionId,meta:{cwd,agentPreset:preset},agentOptions:model,signal,
    setup:async (agentCtx?: any) =>{await ctx.agentPresets.mount(agentCtx,preset);}});
   handles.set(sessionId,handle);
   if(workspace){await workspace.setTitle('Router');await workspace.attachSession(sessionId);}
   if(persistent)await ctx.sessionController.rename?.({sessionId,title:preset==='chopsticks-im-router'?'IM 平台 Router':preset==='chopsticks-content-router'?'内容平台 Router':'总 Router'});
  },
  archiveRouterSession:(id)=>ctx.workspaceRegistry.archiveSession(id),
  async releaseRouterSession(id?: any){
   const handle=handles.get(id);if(!handle)return;
   try{await handle.dispose();handles.delete(id);}
   catch(error){
    // DSH memoizes disposal's promise. It may detach successfully and then
    // report a teardown error; retrying that settled promise cannot recover.
    if(ctx.agents.get(id)===handle.agent)throw error;
    handles.delete(id);return {warning:'native_teardown_failed_after_detach'};
   }
  },
 };
}
