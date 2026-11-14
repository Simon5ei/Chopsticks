import test from 'node:test';import assert from 'node:assert/strict';
let privacy;try{privacy=await import('../src/host/'+'owner-privacy.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('owner aliases and account details cannot be sent to outsiders but fish self-introduction stays usable',()=>{
 assert.ok(privacy,'owner privacy gate must exist');
 const config={qq:{ownerId:'11223344'},privacy:{ownerAliases:['测试饲主'],ownerDetails:['某地隐私地址']}};
 for(const text of ['测试饲主家养的，住在群里的小鲸鱼','主人叫测试饲主','我的主人 QQ 11223344','住在某地隐私地址']){
  assert.throws(()=>privacy.assertOwnerPrivacy(text,{config,channel:'heybox:public'}),/OWNER_PRIVACY/);
  assert.throws(()=>privacy.assertOwnerPrivacy(text,{config,channel:'p:another'}),/OWNER_PRIVACY/);
 }
 assert.doesNotThrow(()=>privacy.assertOwnerPrivacy('住在群里的小鲸鱼，叫大肥鱼就行',{config,channel:'heybox:public'}));
 assert.doesNotThrow(()=>privacy.assertOwnerPrivacy('测试饲主',{config,channel:'p:11223344'}));
});
