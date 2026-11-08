import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationSummary} from '../host/conversation-summary.mjs';
test('QQ summary is exact-source and bounded; another peer or group cannot load it',()=>{
 const records=new Map([['p:1',{channel:'p:1',text:'private fact'}],['g:2',{channel:'g:2',text:'group fact'}],['p:3',{channel:'p:1',text:'incorrect mapping'}]]);
 const state={get:(kind,id)=>kind==='conversation-summary'?records.get(id):null};
 assert.match(conversationSummary(state,'p:1'),/private fact/);
 assert.equal(conversationSummary(state,'p:2'),'');assert.equal(conversationSummary(state,'p:3'),'');
 assert.doesNotMatch(conversationSummary(state,'g:2'),/private fact/);
 records.set('g:2',{channel:'g:2',text:'x'.repeat(12000)});assert.ok(conversationSummary(state,'g:2').length<6300);
});
