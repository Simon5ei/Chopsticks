import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouterNative} from '../src/host/router-native.mjs';
test('persistent Router restores the same native agent and mounts its domain preset only once',async()=>{
 const live=new Map(),created=[],mounts=[],workspaces=[];
 const ctx={agents:{get:(id)=>live.get(id),create:async (args?: any) =>{created.push(args);await args.setup({});const agent={session:{id:args.sessionId}};live.set(args.sessionId,agent);return{agent,dispose:async()=>live.delete(args.sessionId)}}},
  sessionController:{inspect:async()=>{throw Object.assign(Error('missing'),{code:'session/not-found'})},resolveAgent:async()=>{}},
  agentPresets:{mount:async(_ctx?: any,id?: any)=>mounts.push(id)},workspaceRegistry:{create:async(cwd?: any,title?: any)=>{workspaces.push({cwd,title});return{id:'ws',setTitle:async()=>{},attachSession:async()=>{}}},archiveSession:async()=>{throw Error('persistent Router must not be archived')}}};
 const native=createRouterNative(ctx,{}),args={sessionId:'chopsticks-router-fish-chat',cwd:'/fish/workspaces/router',preset:'chopsticks-im-router',persistent:true,signal:new AbortController().signal};
 await native.createRouterSession(args);await native.createRouterSession(args);
 assert.equal(created.length,1);assert.deepEqual(mounts,['chopsticks-im-router']);
 assert.equal(created[0].meta.agentPreset,'chopsticks-im-router');
});
