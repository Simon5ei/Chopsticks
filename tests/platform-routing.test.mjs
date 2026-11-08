import test from 'node:test';
import assert from 'node:assert/strict';
let module;
try{module=await import('../core/platforms.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('private contacts on one platform have distinct persistent model session keys',()=>{
 assert.ok(module,'platform routing module missing');
 const route=channel=>module.platformRoute({channel});
 assert.equal(route('p:1').sessionKey,'chat.qq.dm.1');
 assert.notEqual(route('p:2').sessionKey,route('p:1').sessionKey);
 assert.equal(route('bili:dm:1').sessionKey,'chat.bili.dm.1');
 assert.notEqual(route('p:1').sessionKey,route('bili:dm:1').sessionKey);
 assert.equal(route('douyin:dm:2').sessionKey,'chat.douyin.dm.2');
 assert.equal(route('g:1').sessionKey,'chat.qq.groups.1');
 assert.notEqual(route('p:1').sessionKey,route('g:1').sessionKey);
});
test('one surfing platform keeps a session across every content item',()=>{
 assert.ok(module,'platform routing module missing');
 for(const platform of ['bili','qzone','heybox','douyin']){
  const channel=platform==='qzone'?'qzone:friends':`${platform}:public`;
  const a=module.platformRoute({channel,id:'item-a'}),b=module.platformRoute({channel,id:'item-b'});
  assert.equal(a.domain,'surf');assert.equal(a.sessionKey,`surf.${platform}`);assert.equal(a.sessionKey,b.sessionKey);
 }
 assert.equal(module.platformRoute({channel:'diary:private:qq'}).scope,'private:qq');
 assert.throws(()=>module.platformRoute({channel:'unknown:1'}),/channel/i);
 assert.throws(()=>module.platformRoute({channel:'qzone:public'}),/channel/i,'Qzone currently supports friends-only visibility');
});
test('platform-private recall can share contacts without sharing public or other platforms',()=>{
 assert.ok(module,'platform routing module missing');
 assert.equal(module.sameScope('p:1','p:2'),true);
 assert.equal(module.sameScope('p:1','g:1'),false);
 assert.equal(module.sameScope('p:1','bili:dm:1'),false);
 assert.equal(module.sameScope('qzone:friends','bili:public'),false);
 assert.equal(module.sameScope('g:1','heybox:public'),true);
 assert.deepEqual(module.scopeChannels('diary:private:bili',{sharePlatformPrivate:true}).args,['bili:dm:%']);
 assert.deepEqual(module.scopeChannels('diary:qzone:friends'),{sql:'channel = ?',args:['qzone:friends']});
});
