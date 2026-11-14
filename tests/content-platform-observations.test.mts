import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createEventStore} from '../src/core/events.mjs';
import {createHostState} from '../src/host/state.mjs';
import {createLifeOwner} from '../src/life/owner.mjs';
import {createContentObservations} from '../src/host/content-observations.mjs';

test('platform owner separates real body, replies, friends data and video descriptions in its private recap',async(t)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'content-platform-'));
 const store=createEventStore({stateDir:dir}),state=createHostState(store);
 const now=()=>Date.parse('2026-11-09T15:31:00Z');
 const observations=createContentObservations({db:store.db,now,config:{platforms:{heybox:true,qzone:true,douyin:true}}});
 const rows={
  heybox:{id:'123',visibility:'public',kind:'post',text:'真实帖子正文',observationKind:'body'},
  qzone:{id:'qzone:123:456',visibility:'friends',kind:'post',text:'好友正文片段',observationKind:'body_excerpt'},
  douyin:{id:'456',visibility:'public',kind:'video',text:'这是视频简介',observationKind:'description'}
 };
 let writes=0;
 const bindings=new Map();
 const platforms=Object.fromEntries(Object.entries(rows).map(([key,row])=>[key,{
  capabilities:{detail:true,comments:true,comment:true},
  read:async({action})=>({items:action==='comments'?[{id:'reply',visibility:row.visibility,text:'一位读者的想法',kind:'comment'}]:[row]}),
  write:async()=>{writes++;throw Error('external write is forbidden');}
 }]));
 const owner=createLifeOwner({config:{stateDir:dir},state,store,now,contentObservations:observations,platforms,authorize:ticket=>bindings.get(ticket)});
 t.after(async()=>{await owner.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 for(const [platform,row] of Object.entries(rows)){
  const scope=platform==='qzone'?'qzone:friends':'public';
  const channel=scope==='public'?platform+':public':scope;
  const event=store.append({id:platform+'-event',kind:'timer',channel,actorId:'fish',text:'候选',meta:{itemId:row.id,sourceTargetId:row.id}});
  const binding={channel,scope,platform,eventId:event.id,requestId:platform+'-round',sourceTargetId:row.id,consumed:true,readOnly:true};
  bindings.set(platform,binding);assert.equal(observations.start(binding,event),true);
  const detail:any=await owner.handle({platform,operation:'read',args:{ticket:platform,action:'detail',id:row.id}});
  assert.equal(detail.observationKind,row.observationKind);
  await assert.rejects(owner.handle({platform,operation:'write',args:{ticket:platform,action:'comment',targetId:row.id,intentId:'test',text:'forbidden'}}));
  if(platform==='heybox')await owner.handle({platform,operation:'read',args:{ticket:platform,action:'comments',id:row.id}});
  if(platform==='douyin')assert.equal(detail.sourceEventId,undefined);
  observations.finish(binding.requestId);
 }
 assert.equal(writes,0);
 observations.archiveDue();
 const recap=observations.recap('public','2026-11-09');
 assert.equal(recap.counts.read,1);
 assert.equal(recap.counts.partial,1);
 assert.deepEqual(recap.items.find(i=>i.platform==='heybox').evidence.map(e=>e.kind),['body','comments']);
 assert.deepEqual(recap.items.find(i=>i.platform==='douyin').missing,['subtitles','frames']);
 assert.doesNotMatch(JSON.stringify(recap),/好友正文/);
 const friends=observations.recap('qzone:friends','2026-11-09');
 assert.match(JSON.stringify(friends),/好友正文/);
 assert.equal(store.db.prepare('SELECT count(*) AS count FROM content_recaps').get().count,2);
});


test('a Douyin video only adds a bounded frame returned for the exact public item',async(t)=>{
 const {createDouyinPlatform}=await import('../src/platforms/douyin/index.mjs');
 const id='1234567890';
 const frame={kind:'frames',itemId:id,seconds:2.5,data:Buffer.from([255,216,255,224,0,16,255,217]).toString('base64')};
 let sample={...frame,itemId:'7777777777'},asked=false;
 const adapter=createDouyinPlatform({config:{douyin:{}},stateDir:'unused',transport:{async read(args){
  asked=args.observeMedia===true;
  return {items:[{aweme_id:id,desc:'真实描述',aweme_type:0,status:{private_status:0}}],media:sample};
 }}});
 t.after(()=>adapter.close());
 const input={action:'detail',id,observeMedia:true};
 const foreign=await adapter.read(input);
 assert.equal(foreign.items[0].observationKind,'description');
 assert.equal(foreign.items[0].media,undefined);
 sample=frame;
 const own=await adapter.read(input);
 assert.equal(asked,true);
 assert.deepEqual(own.items[0].media,frame);
 const normal=await adapter.read({action:'detail',id});
 assert.equal(normal.items[0].media,undefined);
});

test('the rendered Douyin sample uses an exact item page and a matching visible media source',async()=>{
 const {sampleVisibleContent}=await import('../src/platforms/douyin/observation.mjs');
 const vm=await import('node:vm');
 const itemId='1234567890',url='https://media.example.invalid/v.mp4';
 const data=Buffer.from([255,216,255,224,0,16,255,217]).toString('base64');
 let draws=0,host='www.douyin.com',src=url;
 const page={async evaluate(fn,args){
  const canvas={width:0,height:0,getContext:()=>({drawImage(){draws++;}}),toDataURL:()=>`data:image/jpeg;base64,${data}`};
  return vm.runInNewContext('('+fn.toString()+')(args)',{
   args,location:{hostname:host,protocol:'https:',pathname:'/video/'+itemId},
   document:{querySelectorAll:()=>[{currentSrc:src,readyState:3,videoWidth:1920,videoHeight:1080,currentTime:2.5,getClientRects:()=>[1]}],
    images:[],createElement:()=>canvas}
  },{timeout:1000});
 }};
 const detail={aweme_id:itemId,video:{play_addr:{url_list:[url]}}};
 assert.deepEqual(await sampleVisibleContent(page,itemId,detail),{kind:'frames',itemId,data,seconds:2.5});
 host='example.invalid';assert.equal(await sampleVisibleContent(page,itemId,detail),undefined);
 host='www.douyin.com';src=url+'?wrong=1';assert.equal(await sampleVisibleContent(page,itemId,detail),undefined);
 assert.equal(draws,1);
});
