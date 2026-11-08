import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../host/guard.mjs';
test('private Bili conversations can inspect shared videos without public writes, shell or desktop',()=>{
 const reads=['mcp__bilibili__bili_video','mcp__bilibili__bili_subtitles'];
 const denied=['mcp__bilibili__bili_comment','mcp__bilibili__bili_dynamic_post','mcp__cul__click','mcp__cul__run_shell','chopsticks_send','chopsticks_develop','chopsticks_exec'];
 let visible,guard;
 apply({tools:{view:()=>({visible:new Set([...reads,...denied])}),restrict:({allow})=>{visible=allow;return()=>{};},guard:fn=>{guard=fn;}},on(){},effect:fn=>fn()},{mode:'bili-dm'});
 for(const name of reads){assert.ok(visible.includes(name),name);assert.equal(guard({name}),undefined,name);}
 for(const name of denied){assert.ok(!visible.includes(name),name);assert.notEqual(guard({name}),undefined,name);}
});
