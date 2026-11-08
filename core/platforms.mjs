/** Native conversations follow the administrator's platform workspace layout. */
export function platformRoute(event){
 const channel=typeof event==='string'?event:event?.channel;
 if(typeof channel!=='string')throw Error('Invalid platform channel');
 let platform,audience,domain='chat',scope,sessionKey;
 if(/^p:\d+$/.test(channel)){platform='qq';audience='dm';scope='private:qq';}
 else if(/^g:\d+$/.test(channel)){platform='qq';audience='groups';scope='public';}
 else if(/^(bili|douyin|heybox):dm:\d+$/.test(channel)||/^wechat:dm:[\w-]+$/.test(channel)){platform=channel.split(':')[0];audience='dm';scope=`private:${platform}`;if(platform!=='wechat')domain='surf';}
 else if(/^wechat:group:[\w-]+$/.test(channel)){platform='wechat';audience='groups';scope='public';}
 else if(/^(bili|heybox|douyin):public$/.test(channel)){platform=channel.split(':')[0];audience='public';domain='surf';scope='public';}
 else if(channel==='qzone:friends'){platform='qzone';audience='friends';domain='surf';scope=channel;}
 else if(/^diary:(?:public|qzone:friends|private:(?:qq|bili|douyin|heybox|wechat))$/.test(channel)){
  platform='diary';scope=channel.slice(6);audience='private';domain='surf';sessionKey='evolution.diary';
 }else if(/^evolution:(?:watchdog|reflection|social)$/.test(channel)){platform='evolution';audience='private';domain='surf';scope='internal:runtime';sessionKey=`evolution.${channel.split(':')[1]}`;
 }else if(/^operator:[\w.-]+$/.test(channel)){platform='operator';audience='private';scope=channel;}
 else throw Error('Invalid platform channel');
 const activity=['public','friends'].includes(audience)?'browse':'conversation';
 sessionKey??=activity==='browse'?`surf.${platform}`:`chat.${platform}.${audience}.${channel.split(':').at(-1)}`;
 return {platform,audience,domain,scope,sessionKey,channel,workspace:platform==='diary'?'evolution':platform,activity};
}
export const sameScope=(a,b)=>platformRoute(a).scope===platformRoute(b).scope;
export const publicChannel=channel=>{try{return platformRoute(channel).scope==='public';}catch{return false;}};
export const platformPrivate=channel=>{try{return platformRoute(channel).scope.startsWith('private:');}catch{return false;}};
export function scopeChannels(channel,{sharePlatformPrivate=false}={}){
 const route=platformRoute(channel);
 if(route.scope==='public')return {sql:"(channel LIKE 'g:%' OR channel IN ('bili:public','heybox:public','douyin:public'))",args:[]};
 if(sharePlatformPrivate&&route.scope==='private:qq')return {sql:"channel LIKE 'p:%'",args:[]};
 if(sharePlatformPrivate&&route.scope.startsWith('private:'))return {sql:'channel LIKE ?',args:[`${route.scope.slice(8)}:dm:%`]};
 if(route.scope==='qzone:friends')return {sql:'channel = ?',args:['qzone:friends']};
 return {sql:'channel = ?',args:[channel]};
}
