// Only this adapter owns disposable Router handles; QQ agents remain owned by DSH.
export function createRouterNative(ctx,model){
 const handles=new Map();
 return {
  async createRouterSession({sessionId,cwd,signal}){
   const handle=await ctx.agents.create({sessionId,meta:{cwd,agentPreset:'chopsticks-router'},agentOptions:model,signal,
    setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,'chopsticks-router');}});
   handles.set(sessionId,handle);
  },
  archiveRouterSession:id=>ctx.workspaceRegistry.archiveSession(id),
  async releaseRouterSession(id){
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
