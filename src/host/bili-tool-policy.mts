export async function authorizeBiliTool({caller,replyTickets,contentRounds,name,args}: { caller?: any; replyTickets?: any; contentRounds?: any; name?: any; args?: any; [key: string]: any }){
 if(['bili_comment','bili_dynamic_post'].includes(name)){
  replyTickets.authorize(caller.contextTicket,{platform:'bili',operation:'write',targetId:name==='bili_dynamic_post'?'own-public':args.bvid||args.dynamicId});
 }
 if(caller.domain==='surf'&&caller.audience!=='dm'&&['bili_video','bili_subtitles','bili_frames','bili_comments','bili_dynamic'].includes(name))return contentRounds.admit({caller,platform:'bili',itemId:name==='bili_dynamic'?args.id:args.bvid});
 return {allowed:true};
}
