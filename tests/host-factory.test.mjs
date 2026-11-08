import test from 'node:test';
import assert from 'node:assert/strict';
import * as host from '../host/index.mjs';
test('an isolated native host can inject fake platforms without changing production defaults or starting transports',async()=>{
 assert.equal(typeof host.createHostApply,'function','native host injection seam missing');
 let probed=0;const fake=host.createHostApply({lifePlatforms:{qq:{}},onRuntime:()=>probed++});
 assert.equal(typeof host.apply,'function');assert.notEqual(fake,host.apply);assert.equal(probed,0);
 const saved=process.env.CHOPSTICKS_CONFIG;delete process.env.CHOPSTICKS_CONFIG;
 try{await assert.rejects(fake({}),/external config/);assert.equal(probed,0);}finally{if(saved!==undefined)process.env.CHOPSTICKS_CONFIG=saved;}
});
