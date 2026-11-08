import test from 'node:test';
import assert from 'node:assert/strict';
let module;try{module=await import('../host/desktop-lease.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('desktop workflow belongs to one consumed native request and releases on its turn end',()=>{
 assert.ok(module,'desktop workflow lease missing');let now=0;const lease=module.createDesktopLease({now:()=>now,ttlMs:100});
 const a={sessionId:'qq',requestId:'a',consumed:true},b={sessionId:'bili',requestId:'b',consumed:true};
 assert.equal(lease.claim(a),true);assert.equal(lease.claim(b),false);assert.equal(lease.claim(a),true);
 lease.release({sessionId:'qq',requestId:'wrong'});assert.equal(lease.claim(b),false);
 lease.release(a);assert.equal(lease.claim(b),true);
 now=101;assert.equal(lease.claim(a),true);assert.equal(lease.claim({...a,consumed:false}),false);
});
