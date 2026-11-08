import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEventStore} from '../src/core/events.mjs';
import {createHostState} from '../src/host/state.mjs';
import {liveConversationContext} from '../src/host/conversation-summary.mjs';

function fixture(t?: any,sharePlatformPrivate: boolean=false){
 const dir=mkdtempSync(join(tmpdir(),'event-privacy-')),store=createEventStore({stateDir:dir,sharePlatformPrivate}),state=createHostState(store);
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const add=(id?: any,channel?: any,kind: string='task.result',meta: Record<string, any>={ticketId:id})=>store.append({id,channel,kind,text:'evidence '+id,actorId:'fish-worker',meta});
 return {store,state,add};
}
test('shared recent, automatic context and live prompt exclude development and unknown results',(t)=>{
 const {store,state,add}=fixture(t);state.put('task-source','dev',{mode:'development'});state.put('task-source','research',{mode:'research'});
 add('dev','g:1');add('unknown','g:1');add('research','g:1');add('self','g:1','message.sent',{messageId:'confirmed',ticketId:'dev'});
 assert.deepEqual(store.recent({channel:'g:2'}).map((e)=>e.id),['research','self']);
 assert.deepEqual(store.context({channel:'g:2'}).events.map((e)=>e.id),['research','self']);
 assert.doesNotMatch(liveConversationContext({store,state},'g:2').text,/evidence dev|evidence unknown/);
 assert.deepEqual(store.recent({channel:'g:1'}).map((e)=>e.id),['dev','unknown','research','self']);
 assert.deepEqual(store.recent({channel:'g:2',query:'dev'}).map((e)=>e.id),[]);
});
test('public research may cross platforms; private sharing preserves ordinary messages but not tasks',(t)=>{
 const {store,state,add}=fixture(t,true);state.put('task-source','research',{mode:'research'});
 add('research','bili:public');add('private-task','p:1');state.put('task-source','private-task',{mode:'research'});add('private-message','p:1','message.received',{});
 assert.deepEqual(store.recent({channel:'g:2'}).map((e)=>e.id),['research']);
 assert.deepEqual(store.recent({channel:'p:2'}).map((e)=>e.id),['private-message']);
 assert.deepEqual(store.recent({channel:'p:1'}).map((e)=>e.id),['private-task','private-message']);
});
test('missing host state or malformed mode never grants cross-source task visibility',(t)=>{
 const {store,add}=fixture(t);add('missing','g:1');add('bad','g:1');
 store.db.prepare("INSERT INTO host_kv VALUES('task-source','bad',?)").run('{invalid');
 assert.deepEqual(store.recent({channel:'g:2'}),[]);
 store.db.exec('DROP TABLE host_kv');assert.deepEqual(store.recent({channel:'g:2'}),[]);
 assert.equal(store.recent({channel:'g:1'}).length,2);
});
