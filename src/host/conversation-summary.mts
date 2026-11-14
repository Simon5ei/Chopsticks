import {createHostPrompts} from './prompts.mjs';

// Callers outside a running host (tests, tools) have no registry of their own.
let standalone: any;
const catalog=(runtime?: any)=>runtime?.prompts||(standalone??=createHostPrompts());
function summaryFragment(prompts: any,state?: any,channel?: any){
 if(!/^[gp]:\d+$/.test(channel||''))return null;
 const row=state.get('conversation-summary',channel);
 if(row?.channel!==channel||typeof row.text!=='string'||!row.text.trim())return null;
 return prompts.fragment('session.summary',{channel,summary:row.text.slice(0,6000)});
}

/** Compact factual context belongs to its original contact or group. */
export function conversationSummary(state?: any,channel?: any){
 return summaryFragment(catalog(),state,channel)?.text??'';
}

/** The system-prompt context for one channel; `fragment` keeps its fixed and runtime parts apart for recording. */
export function liveConversationContext(runtime?: any,channel?: any){
 const fresh=runtime.store.context({channel}),prompts=catalog(runtime);
 const fragment=prompts.fragment('session.live-context',{summary:summaryFragment(prompts,runtime.state,channel)??undefined,experience:String(fresh.text)});
 return {revision:fresh.revision,text:fragment.text,fragment};
}
