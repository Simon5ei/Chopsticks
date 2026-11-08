import test from 'node:test';
import assert from 'node:assert/strict';
let module;try{module=await import('../host/content-rounds.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('same-item tools stay in one round and another video is queued as the next turn without reading it',async()=>{
 assert.ok(module,'content rounds missing');const data=new Map(),events=[];
 const rounds=module.createContentRounds({state:{get:(k,id)=>data.get(`${k}:${id}`),put:(k,id,v)=>data.set(`${k}:${id}`,v)},store:{get:()=>({meta:{itemId:'BV1xx411c7mD'}})},onEvent:async e=>events.push(e)});
 const caller={domain:'surf',scope:'public',channel:'bili:public',eventId:'source',requestId:'turn-1',consumed:true};
 assert.equal((await rounds.admit({caller,platform:'bili',itemId:'BV1xx411c7mD'})).allowed,true);
 assert.equal((await rounds.admit({caller,platform:'bili',itemId:'BV1xx411c7mD'})).allowed,true,'subtitles and frames can refer to same video');
 const next=await rounds.admit({caller,platform:'bili',itemId:'BV1xx411c7mE'});assert.equal(next.allowed,false);assert.equal(next.queued,true);assert.equal(events.length,1);assert.equal(events[0].meta.itemId,'BV1xx411c7mE');
 await rounds.admit({caller,platform:'bili',itemId:'BV1xx411c7mE'});assert.equal(events.length,1);
});
test('an executor can select a searched next item while same-item repeats and daily continuation loops are bounded',async()=>{
 assert.ok(module);const data=new Map(),events=[],state={get:(k,id)=>data.get(`${k}:${id}`),put:(k,id,v)=>data.set(`${k}:${id}`,v)};
 const rounds=module.createContentRounds({state,store:{get:()=>({meta:{itemId:'101'}})},onEvent:async e=>events.push(e),maxQueued:1});
 const caller={platform:'heybox',domain:'surf',scope:'public',channel:'heybox:public',eventId:'e',requestId:'r',consumed:true};
 assert.equal((await rounds.next({caller,itemId:'101'})).queued,false);
 assert.equal((await rounds.next({caller,itemId:'102'})).queued,true);
 assert.equal((await rounds.next({caller,itemId:'103'})).reason,'daily_continuation_limit');assert.equal(events.length,1);
});
test('parallel next-item choices cannot overspend the same platform continuation budget',async()=>{
 const data=new Map(),events=[],state={get:(k,id)=>data.get(`${k}:${id}`),put:(k,id,v)=>data.set(`${k}:${id}`,v)};
 const rounds=module.createContentRounds({state,store:{get:()=>({meta:{itemId:'1'}})},onEvent:async e=>{await Promise.resolve();events.push(e);},maxQueued:1});
 const caller={platform:'heybox',domain:'surf',scope:'public',channel:'heybox:public',eventId:'e',requestId:'r',consumed:true};
 const results=await Promise.all(['2','3'].map(itemId=>rounds.next({caller,itemId})));assert.equal(results.filter(r=>r.queued).length,1);assert.equal(events.length,1);
});
