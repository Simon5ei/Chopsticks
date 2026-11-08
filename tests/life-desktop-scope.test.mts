import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../src/host/guard.mjs';
test('new platform executors can use desktop as an available tool without giving it to Routers or diary',()=>{
 for(const mode of ['qzone','heybox','douyin']){let guard;apply({tools:{view:()=>({visible:new Map()}),restrict:()=>()=>{},guard:(fn)=>guard=fn},on(){},effect(){}},{mode});assert.equal(guard({name:'mcp__cul__screenshot'}),undefined);assert.notEqual(guard({name:'mcp__cul__run_shell'}),undefined);}
});
