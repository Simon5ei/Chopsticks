import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLifeOwner} from '../life/owner.mjs';
import {createEventStore} from '../core/events.mjs';
import {createHostState} from '../host/state.mjs';
test('publish forwards title and admitted media with trusted source context; private config paths never upload',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'publish-input-')),store=createEventStore({stateDir:dir}),state=createHostState(store),calls=[];
 fs.mkdirSync(path.join(dir,'media'));const media=path.join(dir,'media','card.png');fs.writeFileSync(media,Buffer.from('89504e470d0a1a0a','hex'));fs.writeFileSync(path.join(dir,'config.json'),'{}');
 const owner=createLifeOwner({config:{stateDir:dir},store,state,authorize:()=>({platform:'douyin',scope:'public',channel:'douyin:public',eventId:'e',requestId:'r',sourceTargetId:'123',allowedOwnTarget:'own-public'}),platforms:{douyin:{capabilities:{publish:true},write:async a=>{calls.push(a);return{confirmed:true,targetId:'own-public',platformId:'post-1'}}}}});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const request={platform:'douyin',operation:'write',args:{ticket:'t',action:'publish',intentId:'i',targetId:'own-public',text:'today',title:'今日',media:[{path:media}],format:'image'}};
 await owner.handle(request);assert.equal(calls[0].context.title,'今日');assert.equal(calls[0].context.media[0].path,media);
 await assert.rejects(owner.handle({...request,args:{...request.args,text:'bad',media:[{path:path.join(dir,'config.json')}]}}));assert.equal(calls.length,1);
});
