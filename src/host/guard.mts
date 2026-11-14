export const name='chopsticks-tool-guard';
export const inject=['tools'];
 const readBili=[...['bili_video','bili_search','bili_subtitles','bili_comments','bili_dynamic','bili_history','bili_frames'].map((n)=>`mcp__bilibili__${n}`),'mcp__web-search-safe__web_search','mcp__web-search-safe__web_fetch','mcp__maibot_date__query_date','mcp__maibot_date__query_holiday','mcp__maibot_wiki__moegirl_lookup'];
 const desktop=['doctor','list_apps','list_windows','focused_window','get_app_state','screenshot','click','drag','scroll','press_key','type_text','perform_action','set_value','activate_window','move_window','resize_window'].map((n)=>`mcp__cul__${n}`);
export function apply(ctx?: any,config: Record<string, any>={}){
 const mode=config.mode||'qq';const allowed=new Set<any>(mode==='router'?['chopsticks_decide']:mode==='bili-dm'?['chopsticks_read','chopsticks_mark_read','chopsticks_recall','chopsticks_remember','chopsticks_rest','chopsticks_task_status','chopsticks_bili_dm_reply','chopsticks_no_reply']:['worker','development'].includes(mode)?[...readBili,'chopsticks_recall','chopsticks_task_report',...mode==='development'?['chopsticks_exec']:[]]:['chopsticks_read','chopsticks_mark_read','chopsticks_recall','chopsticks_remember','chopsticks_rest','chopsticks_task_start','chopsticks_task_follow','chopsticks_task_status','chopsticks_task_stop',...readBili,...mode==='bili'?['mcp__bilibili__bili_comment','mcp__bilibili__bili_dynamic_post','chopsticks_bili_reply']:['chopsticks_send',...mode==='qq'?['chopsticks_style_check']:[],'chopsticks_image','chopsticks_forward','chopsticks_develop','chopsticks_reminder_set','chopsticks_reminder_list','chopsticks_reminder_cancel']]);
 if(['qzone','heybox','douyin','diary'].includes(mode)){allowed.clear();for(const n of ['chopsticks_read','chopsticks_mark_read','chopsticks_recall','chopsticks_remember','chopsticks_rest'])allowed.add(n);}
 if(!['router','worker','development','qq','bili','bili-dm','qzone','heybox','douyin','diary'].includes(mode))allowed.clear();
 if(['qq','bili','bili-dm','qzone','heybox','douyin'].includes(mode))allowed.add('chopsticks_diary_write');
 if(mode==='evolution'){allowed.clear();for(const n of ['chopsticks_evolution_read','chopsticks_evolution_report'])allowed.add(n);}
 if(mode==='diary'){allowed.clear();for(const n of ['chopsticks_diary_write','chopsticks_diary_read','chopsticks_diary_search','chopsticks_diary_skip'])allowed.add(n);}
 if(['router','worker','development','qq','bili','bili-dm','qzone','heybox','douyin'].includes(mode))for(const tool of ['chopsticks_context_search','chopsticks_context_read','chopsticks_tasks'])allowed.add(tool);
 const platform=mode==='bili'||mode==='bili-dm'?'bilibili':['qq','qzone','heybox','douyin'].includes(mode)?mode:null;
 if(platform)for(const action of ['status','read','write'])allowed.add(`mcp__${platform}__${platform}_${action}`);
 if(mode==='bili-dm')for(const tool of ['bili_video','bili_subtitles'])allowed.add(`mcp__bilibili__${tool}`);
 if(['bili','qzone','heybox','douyin'].includes(mode))for(const tool of ['chopsticks_surf_next','chopsticks_content_reflect'])allowed.add(tool);
 if(['qq','bili','qzone','heybox','douyin'].includes(mode))for(const tool of desktop)allowed.add(tool);
 let dispose,signature,closed=false,pending=false;
 const refresh=()=>{if(closed)return;try{const known=ctx.tools.view(undefined).visible;const allow=[...allowed].filter((n)=>known.has(n)),next=allow.join('|');if(next===signature)return;signature=next;dispose?.();dispose=ctx.tools.restrict({allow});}catch(error){if(error?.code!=='INACTIVE_EFFECT')throw error;closed=true;}};
 refresh();ctx.on('tools/change',()=>{if(pending||closed)return;pending=true;queueMicrotask(()=>{pending=false;refresh();});});
 ctx.tools.guard((exec)=>allowed.has(exec.name)?undefined:'当前执行会话不具备此工具权限');
 ctx.effect(()=>()=>{closed=true;dispose?.();});
}
