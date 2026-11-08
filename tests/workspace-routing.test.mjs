import test from 'node:test';
import assert from 'node:assert/strict';
import {platformRoute} from '../core/platforms.mjs';
test('IM workspaces isolate each contact/group; content DM belongs to content Router',()=>{
 const qq=platformRoute('p:1'),other=platformRoute('p:2'),group=platformRoute('g:1');
 assert.notEqual(qq.sessionKey,other.sessionKey);
 assert.notEqual(qq.sessionKey,group.sessionKey);
 assert.equal(qq.workspace,'qq');assert.equal(qq.domain,'chat');
 assert.equal(platformRoute('wechat:group:123').workspace,'wechat');
 for(const p of ['bili','heybox','douyin']){
  const a=platformRoute(`${p}:dm:1`),b=platformRoute(`${p}:dm:2`),surf=platformRoute(`${p}:public`);
  assert.equal(a.domain,'surf');assert.equal(a.activity,'conversation');
  assert.notEqual(a.sessionKey,b.sessionKey);assert.notEqual(a.sessionKey,surf.sessionKey);
  assert.equal(a.workspace,p);assert.equal(surf.workspace,p);assert.equal(surf.activity,'browse');
  assert.equal(surf.sessionKey,platformRoute({channel:`${p}:public`,id:'next'}).sessionKey);
 }
});
