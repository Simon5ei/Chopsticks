export const name='chopsticks-tool-guard';
export const inject=['tools'];
 const readBili=[...['bili_video','bili_search','bili_subtitles','bili_comments','bili_dynamic','bili_history','bili_frames'].map(n=>`mcp__bilibili__${n}`),'mcp__web-search-safe__web_search','mcp__web-search-safe__web_fetch'];
export function apply(ctx,config={}){
 const mode=config.mode||'qq';const allowed=new Set(mode==='router'?['chopsticks_decide']:['worker','development'].includes(mode)?[...readBili,'chopsticks_recall','chopsticks_task_report',...mode==='development'?['chopsticks_exec']:[]]:['chopsticks_read','chopsticks_mark_read','chopsticks_recall','chopsticks_remember','chopsticks_rest','chopsticks_task_start','chopsticks_task_follow','chopsticks_task_status','chopsticks_task_stop',...readBili,...mode==='bili'?['mcp__bilibili__bili_comment','mcp__bilibili__bili_dynamic_post']:['chopsticks_send','chopsticks_image','chopsticks_forward','chopsticks_develop']]);
 let dispose,signature,closed=false,pending=false;
 const refresh=()=>{if(closed)return;const known=ctx.tools.view(undefined).visible;const allow=[...allowed].filter(n=>known.has(n)),next=allow.join('|');if(next===signature)return;signature=next;dispose?.();dispose=ctx.tools.restrict({allow});};
 refresh();ctx.on('tools/change',()=>{if(pending||closed)return;pending=true;queueMicrotask(()=>{pending=false;refresh();});});
 ctx.tools.guard(exec=>allowed.has(exec.name)?undefined:'当前执行会话不具备此工具权限');
 ctx.effect(()=>()=>{closed=true;dispose?.();});
}
