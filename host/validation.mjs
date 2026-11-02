import fs from 'node:fs';
import path from 'node:path';
export function validationAdapter({onEvent,onStatus}){
 let count=0;const boot=Date.now();
 return {async start(){onStatus({connected:true,transport:'isolated-fixture'});},close(){},status(){return {validation:true};},async send({channel,text}){const event={id:`validation:sent:${boot}:${++count}`,kind:'message.sent',channel,actorId:'fixture-fish',text,meta:{messageId:`fixture-${boot}-${count}`,confirmed:true}};await onEvent(event);return event;},getImage(){throw Error('Validation has no media');},getForward(){throw Error('Validation has no forwards');}};
}
export async function runProbe(runtime){
 const suffix=Date.now();
 const channelA=`g:${suffix}1`,channelB=`g:${suffix}2`;
 await runtime.ingest({id:`probe:A:${suffix}`,kind:'message.sent',channel:channelA,actorId:'fish',text:'我刚在A群说：今天午饭吃了紫薯炒饭。',meta:{messageId:`A-${suffix}`}});
 runtime.store.append({id:`probe:private:${suffix}`,kind:'message.received',channel:'p:303',actorId:'private',text:'私聊秘密是榴莲小保险柜。',meta:{route:false,passive:true}});
 await runtime.ingest({id:`probe:B:${suffix}`,kind:'message.received',channel:channelB,actorId:'tester',text:'@大肥鱼 你刚才在A群说今天午饭吃了什么？',meta:{messageId:`B-${suffix}`,addressed:true,admin:false}});
 const deadline=Date.now()+150000;
 const check=setInterval(()=>{
  const outgoing=runtime.store.recent({channel:channelB,groups:false,limit:20}).filter(e=>e.kind==='message.sent');
  if(outgoing.length||Date.now()>deadline){clearInterval(check);const text=outgoing.map(e=>e.text).join('\n');fs.writeFileSync(path.join(runtime.config.stateDir,'acceptance.json'),JSON.stringify({synthetic:true,noPublicSend:true,crossGroup:text.includes('紫薯炒饭'),privateExcluded:!text.includes('榴莲小保险柜'),outgoing:outgoing.length,router:runtime.router.status()},null,2));
   if(text.includes('紫薯炒饭'))void taskProbe(runtime,channelB,suffix).catch(()=>{});
  }
 },1000);check.unref?.();
}
async function taskProbe(runtime,channel,suffix){
 const sessionId=runtime.mappings[channel];
 const task=await runtime.coordinator.submit(runtime.caller(sessionId),{requestId:`probe-task:${suffix}`,prompt:'用共享经历回忆大肥鱼今天午饭吃了什么，不需要网络。通过 chopsticks_task_report 报告 ready，summary 简短写出事实。'});
 const deadline=Date.now()+120000;const check=setInterval(async()=>{
  const status=await runtime.coordinator.status(runtime.caller(sessionId),task.id);
  const recorded=runtime.store.recent({channel,groups:false,limit:20}).some(e=>e.kind==='task.result'&&e.actorId==='fish-worker');
  if(recorded||Date.now()>deadline){clearInterval(check);fs.writeFileSync(path.join(runtime.config.stateDir,'task-acceptance.json'),JSON.stringify({synthetic:true,noPublicSend:true,taskResultRecorded:recorded,status},null,2));}
 },1000);check.unref?.();
}
