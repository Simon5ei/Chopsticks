import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const numeric=(value,platform)=>typeof value==='string'&&(platform==='heybox'?/^\d{1,32}$/:/^\d{6,30}$/).test(value);
// Only the private operator socket may create this binding. This is an explicit
// administrator command, never a fabricated incoming platform message/ticket.
export function operatorDmBinding({platform,args,state,now}){
 const {accountId,targetId,secUid,conversationId,text,intentId}=args;
 const keys=['accountId','targetId','text','intentId',...(platform==='douyin'?['secUid','conversationId']:[])];
 if(!['douyin','heybox'].includes(platform)||Object.keys(args).some(k=>!keys.includes(k))||!numeric(accountId,platform)||!numeric(targetId,platform)||accountId===targetId||typeof text!=='string'||!text.trim()||text.length>1000||typeof intentId!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(intentId))throw Error('Invalid operator DM');
 if(platform==='douyin'&&(typeof secUid!=='string'||!/^MS4w[A-Za-z0-9_-]{8,200}$/.test(secUid)||typeof conversationId!=='string'||![`0:1:${accountId}:${targetId}`,`0:1:${targetId}:${accountId}`].includes(conversationId)))throw Error('Invalid operator DM');
 const payload={platform,accountId,targetId,secUid,conversationId,text},digest=hash(payload),operatorCommandId=`operator:dm:${hash([platform,intentId])}`;
 const prior=state.get('operator-dm-command',operatorCommandId);
 if(prior&&prior.digest!==digest)throw Error('Operator command payload changed');
 if(!prior)state.put('operator-dm-command',operatorCommandId,{digest,at:now(),platform,targetId});
 // Equal effects retain one durable send even if a caller changes its label.
 return {platform,accountId,...platform==='douyin'?{secUid,conversationId}:{sourceActor:targetId},scope:`private:${platform}`,channel:`${platform}:dm:${targetId}`,sourceTargetId:targetId,requestId:`operator:dm-effect:${digest}`,operatorCommandId};
}
