import test from 'node:test';
import assert from 'node:assert/strict';
import {createReplyTickets} from '../src/host/reply-tickets.mjs';
const {authorizeBiliTool}=await import('../src/host/bili-tool-policy.mjs');
function fixture(){const data=new Map();const state={get:(k?: any,id?: any)=>data.get(`${k}:${id}`),put:(k?: any,id?: any,v?: any)=>data.set(`${k}:${id}`,v),list:(k)=>[...data].filter(([key])=>key.startsWith(k+':')).map(([key,v])=>({...v,id:key.slice(k.length+1)}))};const tickets=createReplyTickets({state});const caller: any={sessionId:'s',requestId:'r',platform:'bili',channel:'bili:public',eventId:'e',actorId:'fish',audience:'public',scope:'public',domain:'surf',consumed:true};caller.contextTicket=tickets.issue({...caller,sourceTargetId:'BV1xx411c7mD',allowedOwnTarget:'own-public'});state.put('binding','s',caller);return{state,tickets,caller};}
test('all legacy Bili writes enforce the same consumed current-target and revocation ticket policy',async()=>{assert.equal(typeof authorizeBiliTool,'function');const f=fixture();const input={caller:f.caller,replyTickets:f.tickets,contentRounds:{}};
 await authorizeBiliTool({...input,name:'bili_comment',args:{bvid:'BV1xx411c7mD',mode:'go'}});
 await assert.rejects(authorizeBiliTool({...input,name:'bili_comment',args:{bvid:'BV1xx411c7mE',mode:'go'}}),/target/i);
 await authorizeBiliTool({...input,name:'bili_dynamic_post',args:{mode:'go'}});
 f.state.put('binding','s',{...f.caller,consumed:false});await assert.rejects(authorizeBiliTool({...input,name:'bili_comment',args:{bvid:'BV1xx411c7mD',mode:'go'}}),/ticket/i);
 f.state.put('binding','s',f.caller);f.tickets.revokeForRequest('r');await assert.rejects(authorizeBiliTool({...input,name:'bili_dynamic_post',args:{mode:'go'}}),/ticket/i);
});
test('legacy comments and dynamic reads also pass one-content-per-turn admission',async()=>{assert.equal(typeof authorizeBiliTool,'function');const f=fixture(),seen=[];const contentRounds={admit:async (args?: any) =>(seen.push(args),{allowed:false,queued:true})};for(const [name,args,id] of [['bili_comments',{bvid:'BV1xx411c7mE'},'BV1xx411c7mE'],['bili_dynamic',{id:'123'},'123']]){const result=await authorizeBiliTool({caller:f.caller,replyTickets:f.tickets,contentRounds,name,args});assert.equal(result.allowed,false);assert.equal(seen.at(-1).itemId,id);}});

test('automatic browsing ticket admits reads but refuses all writes including own targets',()=>{
 const f=fixture();
 const ticket=f.tickets.issue({...f.caller,readOnly:true,sourceTargetId:'BV1xx411c7mD',allowedOwnTarget:'own-public'});
 assert.equal(f.tickets.authorize(ticket,{platform:'bili',operation:'read'}).readOnly,true);
 for(const targetId of ['BV1xx411c7mD','own-public']){
  assert.throws(()=>f.tickets.authorize(ticket,{platform:'bili',operation:'write',targetId}),/read.only/i);
 }
});
