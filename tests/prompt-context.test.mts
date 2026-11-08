import test from 'node:test';
import assert from 'node:assert/strict';
import {createDshExecutor} from '../src/tasks/dsh-executor.mjs';

test('development delivery retains request and IDs without social persona or contradictory read-only wrapper',async()=>{
 const received=[];
 const executor=createDshExecutor({controller:{prompt:async (r?: any) =>{received.push(r);return {accepted:true};}},workerRoot:'unused',readPersona:()=> 'SOCIAL_PERSONA_SHOULD_NOT_REACH_DEVELOPER',resolveWorker:()=>({mode:'development',originalRequest:'create project cactus'})});
 await executor.prompt({sessionId:'worker',deliveryId:'delivery-1',text:'ticketId=ticket-1\ndeliveryId=delivery-1\ncreate project cactus'});
 const text=received[0].content[0].text;
 assert.match(text,/create project cactus/);assert.match(text,/ticket-1/);assert.match(text,/delivery-1/);
 assert.doesNotMatch(text,/SOCIAL_PERSONA|Read-only delegated|唯一执行授权范围|不得扩展任务/);
 assert.match(text,/\/root\/workspace\/dsh/);
});

test('research delivery preserves input and result correlation without social persona',async()=>{
 const received=[];
 const executor=createDshExecutor({controller:{prompt:async (r?: any) =>{received.push(r);return {accepted:true};}},workerRoot:'unused',readPersona:()=> 'SOCIAL_PERSONA_SHOULD_NOT_REACH_RESEARCH'});
 await executor.prompt({sessionId:'worker',deliveryId:'delivery-2',text:'ticketId=ticket-2\nRead this source'});
 assert.equal(received[0].requestId,'delivery-2');assert.match(received[0].content[0].text,/ticket-2/);
 assert.doesNotMatch(received[0].content[0].text,/SOCIAL_PERSONA/);
});
