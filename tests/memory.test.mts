import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../src/core/events.mjs';
import {createHostState} from '../src/host/state.mjs';
import {createMemory} from '../src/host/memory.mjs';
import {migrateMemory} from '../src/deployment/migrate-memory.mjs';
function setup(t?: any, records: any[] = []) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-memory-test-')), fishHome=path.join(dir,'fish');
 const memoryDir=path.join(fishHome,'characters','fish','memory');fs.mkdirSync(memoryDir,{recursive:true});
 fs.writeFileSync(path.join(fishHome,'characters/current.json'),JSON.stringify({id:'fish'}));
 const cardFile=path.join(memoryDir,'memory-card.json'); fs.writeFileSync(cardFile,JSON.stringify({records}));
 const store=createEventStore({stateDir:path.join(dir,'runtime')}),state=createHostState(store),memory=createMemory({fishHome,state,store});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,fishHome,cardFile,store,state,memory};
}
test('group and public Bili memory share, private/unknown/sensitive/admin sources do not',(t)=>{
 const f=setup(t,[
  {id:'group',scope:'qq',conversationKey:'group:1',text:'rice group'},
  {id:'bili',scope:'bili',platform:'bili',kind:'comment',text:'rice public'},
  {id:'private',scope:'qq',conversationKey:'private:3',text:'rice private'},
  {id:'sensitive',scope:'qq',conversationKey:'group:1',sensitive:true,text:'rice sensitive'},
  {id:'flag-private',scope:'shared',groupId:'1',private:true,text:'rice secret'},
  {id:'unknown',scope:'mystery',conversationKey:'group:1',text:'rice unknown'},
  {id:'operator',scope:'shared',source:'operator',groupId:'1',text:'rice admin'},
  {id:'bili-dm',scope:'bili',platform:'bili',kind:'dm',text:'rice dm'},
  {id:'orphan',scope:'shared',text:'rice without source'}]);
 assert.deepEqual(f.memory.search({query:'rice',channel:'g:2'}).records.map((r)=>r.id).sort(),['bili','group']);
 assert.deepEqual(f.memory.search({query:'rice',channel:'p:3'}).records.map((r)=>r.id),['private']);
 assert.deepEqual(f.memory.search({query:'rice',channel:'p:4'}).records,[]);
});
test('read current role records live, return bounded source evidence and never change originals',(t)=>{
 const f=setup(t,[{id:'initial',scope:'qq',conversationKey:'group:1',text:'old'}]);
 const record={id:'live',scope:'qq',conversationKey:'group:1',source:'qq',sourceId:'123',title:'Rice',text:'new '.repeat(1000),botReply:'yes'};
 fs.writeFileSync(f.cardFile,JSON.stringify({records:[record]})); const before=fs.readFileSync(f.cardFile,'utf8');
 const result=f.memory.search({query:'new',channel:'g:2',limit:100});
 assert.equal(result.records[0].id,'live');assert.equal(result.records[0].sourceId,'123');assert.ok(result.records[0].text.length<=800);
 assert.equal(fs.readFileSync(f.cardFile,'utf8'),before);
});
test('remember preserves channel provenance and idempotency, detects changed same id',(t)=>{
 const f=setup(t); f.memory.remember({channel:'g:1',text:'shared rice',id:'one'});f.memory.remember({channel:'p:3',text:'private rice',id:'two'});
 f.memory.remember({channel:'g:1',text:'shared rice',id:'one'});
 assert.equal(f.memory.search({query:'rice',channel:'g:2'}).records.length,1);
 assert.equal(f.memory.search({query:'rice',channel:'p:3'}).records.length,1);
 assert.throws(()=>f.memory.remember({channel:'g:1',text:'changed',id:'one'}),/conflict/i);
 assert.throws(()=>f.memory.remember({channel:'operator:admin',text:'admin',id:'three'}),/channel/i);
});
test('source flag conflicts are conservative and unknown scope only visible in exact group',(t)=>{
 const f=setup(t,[{id:'conflict',scope:'qq',conversationKey:'private:3',groupId:'1',text:'rice conflict'},
 {id:'same',scope:'unknown',conversationKey:'group:1',text:'rice same'}]);
 assert.deepEqual(f.memory.search({query:'rice',channel:'g:1'}).records.map((r)=>r.id),['same']);
 assert.deepEqual(f.memory.search({query:'rice',channel:'g:2'}).records,[]);
});
test('migration is idempotent, retains source evidence and never routes history',(t)=>{
 const f=setup(t);const oldFile=path.join(f.dir,'old-social.json');
 const social={conversations:{'group:1':{recentMessages:[{messageId:'1',userId:'5',text:'rice',time:1700000000000},{messageId:'2',isSelf:true,text:'I ate',time:1700000000001},{isSelf:true,text:'unconfirmed self',time:1700000000002}],activeTopics:[{text:'rice topic'}],pendingThoughts:['rice thought'],memberImpressions:[{name:'someone',text:'rice friend'}]},'private:3':{recentMessages:[{messageId:'3',userId:'3',plain:'rice secret',time:1700000000003}],activeTopics:['private rice']}}};
 fs.writeFileSync(oldFile,JSON.stringify(social));const original=fs.readFileSync(oldFile,'utf8');
 const options={config:{fishHome:f.fishHome},oldSocialFile:oldFile,store:f.store,state:f.state};
 const first=migrateMemory(options),second=migrateMemory(options);
 assert.equal(first.eventsImported,3);assert.equal(first.messagesSkipped,1);assert.equal(second.eventsImported,0);
 const events=f.store.recent({channel:'g:1',groups:false});assert.equal(events.length,2);assert.equal(events[1].kind,'message.sent');
 assert.ok(events.every((e)=>e.meta.route===false&&e.meta.migrated===true));
 assert.equal(f.memory.search({query:'rice',channel:'g:2'}).records.length,3);
 assert.equal(f.memory.search({query:'rice',channel:'p:3'}).records.length,1);
 assert.equal(fs.readFileSync(oldFile,'utf8'),original);
});
test('memory evidence redacts credential-shaped source identifiers and text',(t)=>{
 const f=setup(t,[{id:'redact',scope:'qq',conversationKey:'group:1',sourceId:'token=secret-value',text:'rice token=another-value'}]);
 const result=JSON.stringify(f.memory.search({query:'rice',channel:'g:2'}));
 assert.ok(!result.includes('secret-value'));assert.ok(!result.includes('another-value'));
});

test('Bili DM memory retains private Bili provenance and never crosses peers or platforms',(t)=>{
 const f=setup(t,[
  {id:'role-dm',conversationKey:'bili:dm:7',scope:'bili',platform:'bili',kind:'dm',private:true,text:'rice relationship'},
  {id:'qq-private',conversationKey:'p:7',scope:'qq',text:'rice qq'},
  {id:'group',conversationKey:'g:1',scope:'qq',text:'rice group'}
 ]);
 const one=f.memory.remember({channel:'bili:dm:7',id:'one',text:'rice private Bili'});
 const two=f.memory.remember({channel:'bili:dm:8',id:'two',text:'rice another peer'});
 assert.equal(one.platform,'bili');assert.equal(one.scope,'bili');assert.equal(one.private,true);
 assert.equal(two.private,true);
 assert.deepEqual(f.memory.search({channel:'bili:dm:7',query:'rice'}).records.map((r)=>r.id),['role-dm','one']);
 assert.deepEqual(f.memory.search({channel:'bili:dm:8',query:'rice'}).records.map((r)=>r.id),['two']);
 assert.deepEqual(f.memory.search({channel:'p:7',query:'rice'}).records.map((r)=>r.id),['qq-private']);
 for(const channel of ['g:1','g:2','bili:public'])assert.deepEqual(f.memory.search({channel,query:'rice'}).records.map((r)=>r.id),['group'],channel);
 assert.equal(f.memory.remember({channel:'bili:dm:7',id:'one',text:'rice private Bili'}).createdAt,one.createdAt);
 assert.throws(()=>f.memory.remember({channel:'bili:dm:7',id:'one',text:'changed'}),/conflict/);
});
