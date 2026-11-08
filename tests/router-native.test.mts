import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouterNative} from '../src/host/router-native.mjs';
test('a rejected native disposal that already detached is terminal and visible as a warning',async()=>{
 let live,disposes=0;const failure=Promise.reject(Error('teardown failure'));failure.catch(()=>{});
 const ctx={agents:{create:async()=>{live={id:'router'};return {agent:live,dispose:()=>{disposes++;live=undefined;return failure;}};},get:()=>live},agentPresets:{mount:async()=>{}},workspaceRegistry:{archiveSession:async()=>{}}};
 const native=createRouterNative(ctx,{});await native.createRouterSession({sessionId:'router',cwd:'/tmp',signal:new AbortController().signal});
 assert.deepEqual(await native.releaseRouterSession('router'),{warning:'native_teardown_failed_after_detach'});
 await native.releaseRouterSession('router');assert.equal(disposes,1);
});
