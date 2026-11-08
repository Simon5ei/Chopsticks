import test from 'node:test';
import assert from 'node:assert/strict';
import * as diagnostics from '../platforms/douyin/dm-diagnostics.mjs';
import {validWorkerRequest} from '../platforms/douyin/user-platform.mjs';
import {createDouyinPlatform} from '../platforms/douyin/index.mjs';

function fixture(peers=1){
 const calls=[];
 const make=(kind,count)=>({count:async()=>count,isVisible:async()=>true,first(){return this;},and(){return this;},filter(){return this;},waitFor:async o=>assert.ok(o.timeout<=5000),click:async()=>calls.push(kind),evaluateAll:async()=>[{tag:'DIV',class:'editor-kit-container',role:'textbox',e2e:'im-editor',ancestors:[{tag:'DIV',class:'message-dialog'}]}]});
 const page={goto:async url=>calls.push(url),locator:s=>make(s.includes('im-entry')?'entry':s.includes('conversationConversation')?'legacy':'editor',s.includes('conversationConversation')?0:1),getByText:(name,o)=>{assert.equal(name,'Fixture peer');assert.equal(o.exact,true);return make('peer',peers);}};
 return {calls,page};
}
test('DM diagnostic inspects only existing web inbox controls and never fills or submits',async()=>{
 const f=fixture();const result=await diagnostics.dmDiagnostics(f.page,{peerName:'Fixture peer'});
 assert.equal(result.state,'observed');assert.equal(result.kind,'dm_controls');assert.equal(result.legacyRows,0);assert.equal(result.peers,1);assert.equal(result.editors[0].class,'editor-kit-container');
 assert.deepEqual(f.calls,['https://www.douyin.com/','entry']);
 assert.equal(result.peerNodes.length,1);
});
test('DM diagnostic refuses ambiguous or absent names before opening a conversation',async()=>{
 for(const n of [0,2]){const f=fixture(n);const r=await diagnostics.dmDiagnostics(f.page,{peerName:'Fixture peer'});assert.equal(r.peers,n);assert.ok(!f.calls.includes('peer'));}
});
test('DM diagnostic strict arguments and sanitized output exclude text credentials and arbitrary navigation',()=>{
 assert.equal(validWorkerRequest({id:1,method:'diagnostics',args:{action:'dm_controls',peerName:'Fixture peer'}}),true);
 for(const args of [{action:'dm_controls',peerName:''},{action:'dm_controls',peerName:'x',url:'https://evil.test'},{action:'dm_controls',peerName:'x'.repeat(81)}])assert.equal(validWorkerRequest({id:1,method:'diagnostics',args}),false);
 const r=diagnostics.sanitizeDiagnostics({kind:'dm_controls',state:'observed',peers:1,editors:[{tag:'DIV',class:'editor-kit',text:'private',cookie:'secret',ancestors:Array(20).fill({tag:'DIV',class:'parent',text:'private'})}],cookie:'secret'});
 assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(JSON.stringify(r).includes('secret'),false);assert.equal(r.editors[0].ancestors.length,5);
});
test('DM diagnostics forwards narrow arguments through existing serialized adapter',async()=>{
 let received;const p=createDouyinPlatform({stateDir:'unused',idleMs:0,transport:{diagnostics:async args=>{received=args;return {kind:'dm_controls',state:'observed',peers:1};}}});
 const r=await p.diagnostics({action:'dm_controls',peerName:'Fixture peer'});assert.equal(received.action,'dm_controls');assert.equal(received.peerName,'Fixture peer');assert.equal(r.kind,'dm_controls');await p.close();
});
test('targeted DM diagnostic compares verified profile name and clicks only a unique observed conversation row',async()=>{
 const f=fixture();const base=f.page.locator;
 f.page.waitForResponse=async()=>({url:()=> 'https://www.douyin.com/aweme/v1/web/user/profile/other/?fixture=1',json:async()=>{throw Error('Unbounded profile parse');}});
 f.page.evaluate=async()=>({status_code:0,user:{uid:'222222222',sec_uid:'MS4wLjABAAAAfixture',nickname:'Profile name'}});
 f.page.getByText=(name,options)=>{assert.equal(options.exact,true);return {filter(){return this;},count:async()=>name==='Profile name'?0:1,first(){return this;},waitFor:async()=>{},evaluateAll:async()=>[],click:async()=>{throw Error('Global text must not be clicked');}};};
 f.page.locator=s=>s==='[data-e2e="conversation-item"]'?{filter(){return this;},count:async()=>1,click:async()=>f.calls.push('verified-row')}:base(s);
 const r=await diagnostics.dmDiagnostics(f.page,{peerName:'Fixture peer',targetId:'222222222',secUid:'MS4wLjABAAAAfixture'});
 assert.equal(r.profileVerified,true);assert.equal(r.profileNameMatches,false);assert.equal(r.profilePeers,0);assert.ok(f.calls.includes('verified-row'));
 assert.equal(validWorkerRequest({id:1,method:'diagnostics',args:{action:'dm_controls',peerName:'Fixture peer',targetId:'222222222',secUid:'MS4wLjABAAAAfixture'}}),true);
});
test('profile diagnostic stops streaming before parsing an oversized body and cancels its reader',async()=>{
 const saved=globalThis.fetch;let cancelled=false,reads=0;
 globalThis.fetch=async()=>({ok:true,body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array(65537)};},cancel:async()=>{cancelled=true;}})}});
 try{await assert.rejects(()=>diagnostics.fetchDiagnosticProfile('https://www.douyin.com/aweme/v1/web/user/profile/other/'));assert.equal(reads,1);assert.equal(cancelled,true);}finally{globalThis.fetch=saved;}
});
test('an unavailable IM entry reports bounded layout evidence without any click',async()=>{
 const f=fixture();f.page.locator=()=>({first(){return this;},waitFor:async()=>{throw Object.assign(Error('timeout'),{name:'TimeoutError'});}});
 f.page.evaluate=async()=>({viewportWidth:1280,windowWidth:1256,screenWidth:1920,entryPresent:true,entryWidth:0,entryHeight:0,entryDisplay:'none',entryVisibility:'hidden',documentState:'complete',secret:'private'});
 const r=await diagnostics.dmDiagnostics(f.page,{peerName:'Fixture peer'});assert.equal(r.kind,'dm_controls');assert.equal(r.state,'unavailable');assert.equal(r.layout.entryDisplay,'none');assert.equal(r.layout.viewportWidth,1280);assert.ok(!JSON.stringify(r).includes('private'));assert.deepEqual(f.calls,['https://www.douyin.com/']);
});
