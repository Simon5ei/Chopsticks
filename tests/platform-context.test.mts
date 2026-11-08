import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../src/core/events.mjs';
const setup=(t)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'life-context-'));const store=createEventStore({stateDir:dir,sharePlatformPrivate:true});t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return store;};
test('explicit platform-private authorization recalls all contacts but not other platforms or public',(t)=>{
 const store=setup(t);
 for(const [id,channel,text]of [['a','p:11','QQ private A'],['b','p:22','QQ private B'],['other','bili:dm:33','Bili private'],['public','g:1','public chat']])store.append({id,channel,kind:'message.received',actorId:id,text});
 const context=store.context({channel:'p:11'}).text;
 assert.match(context,/QQ private A/);assert.match(context,/QQ private B/);assert.doesNotMatch(context,/Bili private|public chat/);
 assert.equal(store.recent({channel:'p:11',groups:false}).length,1,'unread/source queries still target one delivery conversation');
 assert.doesNotMatch(store.context({channel:'g:1'}).text,/QQ private/);
});
test('friends-only space stays scoped while actually public new platforms share experiences',(t)=>{
 const store=setup(t);
 store.append({id:'friend',channel:'qzone:friends',kind:'task.result',actorId:'friend',text:'friend-only content',meta:{experienced:true}});
 store.append({id:'box',channel:'heybox:public',kind:'task.result',actorId:'fish',text:'public game post',meta:{experienced:true}});
 store.append({id:'video',channel:'douyin:public',kind:'task.result',actorId:'fish',text:'public short video',meta:{experienced:true}});
 assert.doesNotMatch(store.context({channel:'g:1'}).text,/friend-only/);
 assert.match(store.context({channel:'bili:public'}).text,/public game post/);
 assert.match(store.context({channel:'qzone:friends'}).text,/friend-only/);
 assert.doesNotMatch(store.context({channel:'qzone:friends'}).text,/public game post/);
});
