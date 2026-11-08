/** Compact factual context belongs to its original contact or group. */
export function conversationSummary(state?: any,channel?: any){
 if(!/^[gp]:\d+$/.test(channel||''))return '';
 const row=state.get('conversation-summary',channel);
 if(row?.channel!==channel||typeof row.text!=='string'||!row.text.trim())return '';
 return `会话摘要（${channel}）：\n${row.text.slice(0,6000)}`;
}

export function liveConversationContext(runtime?: any,channel?: any){
 const fresh=runtime.store.context({channel});
 return {revision:fresh.revision,text:[conversationSummary(runtime.state,channel),`当前可用经历：\n${fresh.text}`].filter(Boolean).join('\n')};
}
