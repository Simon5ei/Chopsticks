import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
test('queued tool refresh tolerates native scope becoming inactive before disposer callback',()=>{
 let refresh,change,stop,inactive=false;const known=new Set(['chopsticks_decide']);
 const ctx={tools:{view:()=>({visible:known}),restrict:()=>{if(inactive)throw Object.assign(Error('inactive'),{code:'INACTIVE_EFFECT'});return ()=>{};},guard(){}},on:(_name,fn)=>change=fn,effect:fn=>stop=fn()};
 const source=fs.readFileSync(new URL('../host/guard.mjs',import.meta.url),'utf8').replaceAll('export ','');
 vm.runInNewContext(source+'\napply(ctx,{mode:"router"});',{ctx,queueMicrotask:fn=>refresh=fn});
 change();inactive=true;known.clear();assert.doesNotThrow(()=>refresh());assert.doesNotThrow(()=>stop());
});
