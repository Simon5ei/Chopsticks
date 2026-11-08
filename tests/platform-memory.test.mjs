import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemory} from '../host/memory.mjs';
function state(){const rows=new Map();return{get:(k,id)=>rows.get(`${k}:${id}`),put:(k,id,v)=>rows.set(`${k}:${id}`,v),list:k=>[...rows].filter(([id])=>id.startsWith(k+':')).map(([id,v])=>({id,...v}))};}
test('platform-private memory shares authorized contacts without exposing another platform or public',()=>{
 const s=state(),m=createMemory({state:s,sharePlatformPrivate:true});
 m.remember({channel:'p:11',text:'A likes apples',id:'a'});m.remember({channel:'bili:dm:33',text:'Bili secret',id:'b'});
 assert.equal(m.search({channel:'p:22',query:'apples'}).records.length,1);
 assert.equal(m.search({channel:'g:1',query:'apples'}).records.length,0);
 assert.equal(m.search({channel:'p:22',query:'Bili secret'}).records.length,0);
});
test('public platform memories share but friend-space memories stay on the friend platform',()=>{
 const m=createMemory({state:state(),sharePlatformPrivate:true});
 m.remember({channel:'heybox:public',text:'public game thought',id:'h'});m.remember({channel:'qzone:friends',text:'friends thought',id:'q'});
 assert.equal(m.search({channel:'g:1',query:'public game'}).records.length,1);
 assert.equal(m.search({channel:'g:1',query:'friends thought'}).records.length,0);
 assert.equal(m.search({channel:'qzone:friends',query:'friends thought'}).records.length,1);
});
