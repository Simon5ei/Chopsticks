import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../host/guard.mjs';
function allowed(mode){let guard;const tools={view:()=>({visible:new Map()}),restrict:()=>()=>{},guard:f=>guard=f};apply({tools,on(){},effect(){}},{mode});return name=>guard({name})===undefined;}
test('platform executors have only their own MCP and diary never has outbound tools',()=>{
 for(const mode of ['qzone','heybox','douyin']){
  const can=allowed(mode);assert.equal(can(`mcp__${mode}__${mode}_read`),true);assert.equal(can(`mcp__${mode}__${mode}_write`),true);assert.equal(can('chopsticks_diary_write'),true);
  assert.equal(can('chopsticks_send'),false);assert.equal(can('mcp__qq__qq_write'),false);assert.equal(can('chopsticks_develop'),false);
 }
 const diary=allowed('diary');assert.equal(diary('chopsticks_diary_write'),true);assert.equal(diary('mcp__qzone__qzone_write'),false);assert.equal(diary('chopsticks_send'),false);
 assert.equal(allowed('qq')('mcp__qq__qq_write'),true);assert.equal(allowed('bili-dm')('mcp__bilibili__bilibili_read'),true);
 assert.equal(allowed('unknown')('chopsticks_send'),false);
});

test('platform presets may record scoped diary entries but cannot read mixed internal diary outputs',()=>{for(const mode of ['qq','bili','bili-dm','qzone','heybox','douyin']){const can=allowed(mode);assert.equal(can('chopsticks_diary_write'),true);assert.equal(can('chopsticks_diary_read'),false);assert.equal(can('chopsticks_diary_search'),false);assert.equal(can('chopsticks_diary_skip'),false);}assert.equal(allowed('diary')('chopsticks_diary_read'),true);assert.equal(allowed('diary')('chopsticks_diary_skip'),true);});
