import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const module: any = await import('../src/life/live-platforms.mjs');

async function setup(t?: any,{platform='heybox',read,write,status,biliService,biliReadback}: { platform?: string; read?: any; write?: any; status?: any; biliService?: any; biliReadback?: any; [key: string]: any }={}) {
 assert.equal(typeof module.createLivePlatformTests,'function');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'live-platform-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const sourceRoot=path.join(root,'source'),stateDir=path.join(root,'state'),fishHome=path.join(root,'fish');
 await fs.mkdir(path.join(sourceRoot,'life'),{recursive:true});await fs.writeFile(path.join(sourceRoot,'life','owner.mjs'),'export const owner=true;');await fs.writeFile(path.join(sourceRoot,'package.json'),'{}');
 await fs.mkdir(path.join(stateDir,'life'),{recursive:true});await fs.mkdir(fishHome);await fs.writeFile(path.join(fishHome,'bili.config.json'),JSON.stringify({self:{mid:'123456'}}));
 const manifest=await module.buildLiveSourceManifest(sourceRoot);await fs.writeFile(path.join(stateDir,'life','source-revision.json'),JSON.stringify(manifest));
 let writes=0;const health=[];const adapter={capabilities:{feed:true,detail:true,publish:true},status:status|| (async()=>({state:'ready',accountId:'123456'})),read:read|| (async({action,id}: { action?: any; id?: any; [key: string]: any })=>({items:[{id:action==='detail'?id:'111',actorId:'123456',text:'pong',visibility:platform==='qzone'?'friends':'public'}],warnings:[]})),write:async (a?: any) =>{writes++;return write?write(a):{confirmed:true,platformId:'222',targetId:platform==='qzone'?'222':'own-public',accountId:'123456',visibility:platform==='qzone'?'friends':'public'};}};
 const config={stateDir,fishHome};
 const runner=module.createLivePlatformTests({config,owners:{[platform]:adapter},state:{put:(...args)=>health.push(args)},sourceRoot,biliService,biliReadback});
 const run=(mode?: any,context: Record<string, any>={operator:true})=>runner.run({platform,revision:manifest.revision,mode},context);
 return {root,stateDir,sourceRoot,manifest,runner,run,adapter,config,health,writes:()=>writes};
}

test('source manifest matches full fixed runtime inventory and rejects modified files before execute',async (t?: any) =>{
 const f=await setup(t);assert.equal((await f.run('prepare')).state,'prepared');
 await fs.writeFile(path.join(f.sourceRoot,'life','owner.mjs'),'changed source');
 await assert.rejects(()=>f.run('execute'),/source/i);assert.equal(f.writes(),0);
});

test('source manifest rejects an added runtime script even when all earlier hashes match',async (t?: any) =>{
 const f=await setup(t);await fs.writeFile(path.join(f.sourceRoot,'life','added.mjs'),'export const changed=true;');
 await assert.rejects(()=>f.run('prepare'),/source/i);assert.equal(f.writes(),0);
});

test('Douyin uses the fixed PNG staged under the configured desktop state directory', {skip:process.platform!=='win32'}, async (t?: any) =>{
 const f=await setup(t,{platform:'douyin',write:async (input?: any) =>{
  assert.equal(input.context.format,'image');const file=input.context.media[0].path;
  assert.equal(path.dirname(file),path.join(f.root,'desktop','media'));assert.equal(path.basename(file),`live-pong-${f.manifest.revision}.png`);
  assert.deepEqual((await fs.readFile(file)).subarray(0,8),Buffer.from('89504e470d0a1a0a','hex'));
  return {confirmed:true,platformId:'222',targetId:'own-public',accountId:'123456',visibility:'public'};
 }});
 await fs.mkdir(path.join(f.root,'desktop'));(f.config as any).douyin={desktopUser:'fixture',userStateDir:path.join(f.root,'desktop')};
 assert.equal((await f.run('prepare')).state,'prepared');assert.equal((await f.run('execute')).state,'verified');
});

test('actor authorization and extra request fields cannot reach a live publish',async (t?: any) =>{
 const f=await setup(t);await assert.rejects(()=>f.run('prepare',{}),/operator/i);
 await assert.rejects(()=>f.runner.run({platform:'heybox',revision:f.manifest.revision,mode:'prepare',text:'custom'},{operator:true}));assert.equal(f.writes(),0);
});

test('prepare performs read-only operation preflight and failed detail blocks execute',async (t?: any) =>{
 const f=await setup(t,{read:async({action}: { action?: any; [key: string]: any })=>action==='detail'?{items:[],warnings:['verification_required']}:{items:[{id:'111',text:'old',visibility:'public'}],warnings:[]}});
 assert.equal((await f.run('prepare')).state,'not_ready');assert.equal((await f.run('execute')).state,'preparation_required');assert.equal(f.writes(),0);
 assert.ok(f.health.some((x)=>x[1]==='life-operation:heybox:detail' && x[2].state==='verification_required'));
});

test('live publish uses singleton adapter and exact receipt readback, never ordinary ticket route',async (t?: any) =>{
 const f=await setup(t,{write:async (input?: any) =>{assert.equal(input.text,'pong');assert.equal(input.targetId,'own-public');assert.equal(input.context.accountId,'123456');return {confirmed:true,platformId:'222',targetId:'own-public',accountId:'123456',visibility:'public'};}});
 await f.run('prepare');const out=await f.run('execute');assert.equal(out.state,'verified');assert.equal(out.url,'https://www.xiaoheihe.cn/app/bbs/link/222');assert.equal(f.writes(),1);
 assert.equal((await f.run('execute')).state,'already_recorded');assert.equal(f.writes(),1);
});

test('wrong returned author or text does not verify a real receipt',async (t?: any) =>{
 const f=await setup(t,{read:async({action,id}: { action?: any; id?: any; [key: string]: any })=>({items:[{id:action==='detail'?id:'111',text:id==='222'?'other':'pong',actorId:'123456',visibility:'public'}],warnings:[]})});
 await f.run('prepare');assert.equal((await f.run('execute')).state,'confirmed_readback_pending');assert.equal(f.writes(),1);
});

test('Qzone scope label alone cannot certify friends-only post visibility',async (t?: any) =>{
 const f=await setup(t,{platform:'qzone'});await f.run('prepare');
 assert.equal((await f.run('execute')).state,'confirmed_readback_pending');assert.equal(f.writes(),1);
});

test('Qzone live verification uses separate own-post proof rather than normalized detail identity',async (t?: any) =>{
 const f=await setup(t,{platform:'qzone'});let verifications=0;
 (f.adapter as any).verifyOwnPost=async (input?: any) =>{assert.equal(input.id,'222');assert.equal(input.accountId,'123456');verifications++;return {verified:true,id:'222',accountId:'123456',text:'pong',target:'own-friends',visibility:'friends',visibilityEvidence:'qzone_raw_ugc_right_4'};};
 await f.run('prepare');assert.equal((await f.run('execute')).state,'verified');assert.equal(verifications,1);
 const record=JSON.parse(await fs.readFile(path.join(f.stateDir,'life','live-test','qzone',f.manifest.revision,'verified.json'),'utf8'));assert.equal(record.visibilityEvidence,'qzone_raw_ugc_right_4');
});

test('accepted receipt ID survives unconfirmed adapter readback and verify never republishes',async (t?: any) =>{
 const f=await setup(t,{write:async()=>({confirmed:false,state:'unknown',receiptId:'222',accountId:'123456',code:'readback_verification_required'})});
 await f.run('prepare');assert.equal((await f.run('execute')).state,'unknown');
 assert.equal((await f.run('verify')).state,'verified');assert.equal(f.writes(),1);
});

test('Bili uses actual service dry/go with operator context and exact readback helper',async (t?: any) =>{
 const modes=[];const f=await setup(t,{platform:'bilibili',biliService:{call:async(name?: any,args?: any,ctx?: any)=>{assert.equal(name,'bili_dynamic_post');assert.equal(ctx.role,'operator');assert.equal(ctx.canWrite,true);assert.equal(args.text,'pong');modes.push(args.mode);return args.mode==='dry'?{}:{structuredContent:{receipt:{status:'confirmed',kind:'dynamic',id:'222',url:'https://t.bilibili.com/222'}}};}},biliReadback:async (args?: any) =>{assert.equal(args.receipt.id,'222');assert.equal(args.expectedText,'pong');return {status:'verified',id:'222',url:'https://t.bilibili.com/222'};}});
 assert.equal((await f.run('prepare')).state,'prepared');assert.equal(f.health.filter((x)=>x[1]==='life-operation:bilibili:publish').at(-1)[2].state,'unknown');assert.equal((await f.run('execute')).url,'https://t.bilibili.com/222');assert.deepEqual(modes,['dry','go']);
});
