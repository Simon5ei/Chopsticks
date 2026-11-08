import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// External platform callbacks are deliberately replaced; npm test never posts.
const mod: any = await import('../src/life/live-test.mjs');
const revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64);
const operator = {operator:true};
async function fixture(t?: any, overrides: Record<string, any> = {}, platform: string = 'qzone') {
 assert.equal(typeof mod.createLiveTestRunner, 'function', 'live test runner must exist');
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pong-ledger-'));
 t.after(() => fs.rm(root, {recursive:true,force:true}));
 let posts = 0;
 const adapter = {
  prepare:async () => ({ready:true,accountId:'self-1'}),
  publish:async () => {posts++; return {id:'post-1',accountId:'self-1'};},
  verify:async () => ({verified:true,id:'post-1',accountId:'self-1',text:'pong',target:platform === 'qzone' ? 'own-friends' : 'own-public'}),
  ...overrides
 };
 const create = (rev: any = revision) => mod.createLiveTestRunner({root,revision:rev,platforms:{[platform]:adapter}});
 const runner = create();
 const run = (mode?: any, rev: any = revision, ctx: any = operator) => runner.run({platform,revision:rev,mode},ctx);
 return {root,runner,run,create,adapter,posts:()=>posts,platform};
}

test('operator gate and fixed request schema reject caller payload, paths and revision mismatch', async (t?: any) => {
 const f = await fixture(t);
 await assert.rejects(() => f.run('prepare',revision,{}), /operator/i);
 for (const extra of [{text:'arbitrary'},{target:'other'},{root:'elsewhere'},{operator:true}]) {
  await assert.rejects(() => f.runner.run({platform:'qzone',revision,mode:'prepare',...extra},operator), /invalid/i);
 }
 await assert.rejects(() => f.run('prepare',nextRevision), /revision/i);
 assert.equal(f.posts(),0);
});

test('prepare is read only and execute requires an explicit successful prior prepare', async (t?: any) => {
 const f = await fixture(t);
 assert.equal((await f.run('execute')).state,'preparation_required');
 assert.equal((await f.run('prepare')).state,'prepared');
 assert.equal(f.posts(),0);
 assert.equal((await f.run('execute')).state,'verified');
 assert.equal(f.posts(),1);
 assert.equal((await f.run('execute')).state,'already_recorded');
 assert.equal(f.posts(),1);
});

test('failed preparation never reserves or posts', async (t?: any) => {
 const f = await fixture(t,{prepare:async () => ({ready:false,accountId:'self-1'})});
 assert.equal((await f.run('prepare')).state,'not_ready');
 assert.equal((await f.run('execute')).state,'preparation_required');
 assert.equal(f.posts(),0);
});

test('a failed readiness refresh invalidates an earlier preparation', async (t?: any) => {
 const f = await fixture(t);await f.run('prepare');
 f.adapter.prepare = (async () => ({ready:false}) as any);
 assert.equal((await f.run('prepare')).state,'not_ready');
 assert.equal((await f.run('execute')).state,'preparation_required');assert.equal(f.posts(),0);
});

test('durable intent exists before POST and receipt is committed before readback', async (t?: any) => {
 const f = await fixture(t);
 let checked = false;
 f.adapter.publish = async (input?: any) => {
  const intent = JSON.parse(await fs.readFile(path.join(f.root,'qzone',revision,'intent.json'),'utf8'));
  assert.equal(intent.text,'pong');assert.equal(intent.accountId,'self-1');
  assert.equal(input.text,'pong');assert.equal(input.target,'own-friends');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'qzone','active.json'),'utf8')).revision,revision);
  return {id:'post-1',accountId:'self-1',cookie:'DO-NOT-STORE'};
 };
 f.adapter.verify = async () => {
  const receipt = JSON.parse(await fs.readFile(path.join(f.root,'qzone',revision,'receipt.json'),'utf8'));
  assert.equal(receipt.id,'post-1');assert.equal(receipt.cookie,undefined);checked = true;
  return {verified:true,id:'post-1',accountId:'self-1',text:'pong',target:'own-friends'};
 };
 await f.run('prepare');assert.equal((await f.run('execute')).state,'verified');assert.ok(checked);
});

test('ambiguous publish blocks same and future revisions after process-style reconstruction', async (t?: any) => {
 const f = await fixture(t,{publish:async () => {throw Error('secret cookie and network timeout');}});
 await f.run('prepare');assert.equal((await f.run('execute')).state,'unknown');
 const same = f.create();assert.equal((await same.run({platform:'qzone',revision,mode:'execute'},operator)).state,'already_recorded');
 const next = f.create(nextRevision);
 assert.equal((await next.run({platform:'qzone',revision:nextRevision,mode:'prepare'},operator)).state,'blocked_unknown');
 assert.equal((await next.run({platform:'qzone',revision:nextRevision,mode:'execute'},operator)).state,'blocked_unknown');
 assert.doesNotMatch(await fs.readFile(path.join(f.root,'qzone',revision,'result.json'),'utf8'),/secret|cookie|timeout/);
});

test('an exclusive reservation surviving a crash blocks execution even without an intent', async (t?: any) => {
 const f = await fixture(t);await f.run('prepare');
 await fs.writeFile(path.join(f.root,'qzone','active.json'),JSON.stringify({revision}));
 assert.equal((await f.run('execute')).state,'already_recorded');
 assert.equal(f.posts(),0);
});

test('a killed process after POST starts cannot cause a duplicate after restart', async (t?: any) => {
 const f = await fixture(t);await f.run('prepare');
 const moduleUrl = new URL('../src/life/live-test.mjs',import.meta.url).href;
 const script = `import {createLiveTestRunner} from ${JSON.stringify(moduleUrl)};
  const runner = createLiveTestRunner({root:${JSON.stringify(f.root)},revision:${JSON.stringify(revision)},platforms:{qzone:{
   prepare:async()=>({ready:true,accountId:'self-1'}),
   publish:async()=>{process.stdout.write('POST_ATTEMPT\\n');await new Promise(()=>{});},
   verify:async()=>({verified:false})
  }}});
  const hold=setInterval(()=>{},1000);
  await runner.run({platform:'qzone',revision:${JSON.stringify(revision)},mode:'execute'},{operator:true});clearInterval(hold);`;
 const child = spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 await new Promise<any | void>((resolve?: any,reject?: any)=>{
  const timer=setTimeout(()=>{child.kill();reject(Error('Crash test child did not reach publish'));},10000);
  child.stdout.once('data',()=>{clearTimeout(timer);child.once('exit',resolve);child.kill();});
  child.once('error',(error)=>{clearTimeout(timer);reject(error);});
 });
 assert.equal((await f.run('execute')).state,'already_recorded');
 assert.equal((await f.create(nextRevision).run({platform:'qzone',revision:nextRevision,mode:'execute'},operator)).state,'blocked_unknown');
 assert.equal(f.posts(),0);
});

test('concurrent runner instances permit only one POST', async (t?: any) => {
 const f = await fixture(t);await f.run('prepare');
 const runners = [f.runner,f.create(),f.create()];
 const results = await Promise.all(runners.map((r) => r.run({platform:'qzone',revision,mode:'execute'},operator)));
 assert.equal(results.filter((r) => r.state === 'verified').length,1);
 assert.equal(f.posts(),1);
});

test('verify recovers a crash after verified evidence was committed but before reservation release', async (t?: any) => {
 const f = await fixture(t);await f.run('prepare');await f.run('execute');
 await fs.writeFile(path.join(f.root,'qzone','active.json'),JSON.stringify({revision}));
 assert.equal((await f.run('verify')).state,'verified');
 assert.equal((await f.create(nextRevision).run({platform:'qzone',revision:nextRevision,mode:'prepare'},operator)).state,'prepared');
});

test('verify-only recovers an unknown outcome using strict self-account text and object evidence', async (t?: any) => {
 const f = await fixture(t,{
  publish:async () => {throw Error('lost acknowledgement');},
  verify:async ({intent}: { intent?: any; [key: string]: any }) => ({verified:true,id:'post-1',accountId:'self-1',text:'pong',target:'own-friends',intentId:intent.intentId,correlated:true})
 });
 await f.run('prepare');await f.run('execute');
 assert.equal((await f.run('verify')).state,'verified');
 assert.equal((await f.run('execute')).state,'already_recorded');
 const next = f.create(nextRevision);
 assert.equal((await next.run({platform:'qzone',revision:nextRevision,mode:'prepare'},operator)).state,'prepared');
});

test('unknown recovery refuses an old pong without trusted unique intent correlation', async (t?: any) => {
 const f = await fixture(t,{publish:async () => {throw Error('lost acknowledgement');}});
 await f.run('prepare');await f.run('execute');
 assert.equal((await f.run('verify')).state,'unknown');
 assert.equal((await f.create(nextRevision).run({platform:'qzone',revision:nextRevision,mode:'prepare'},operator)).state,'blocked_unknown');
});

test('PNG modification after prepare prevents a publish', async (t?: any) => {
 const f = await fixture(t,{},'douyin');await f.run('prepare');
 await fs.writeFile(path.join(f.root,'douyin',revision,'pong.png'),'not-the-fixed-image');
 await assert.rejects(() => f.run('execute'), /PNG/i);
 assert.equal(f.posts(),0);
});

test('readback mismatches never complete or free the active reservation', async (t?: any) => {
 for (const mismatch of [{id:'wrong-id'},{accountId:'wrong-account'},{text:'pong extra'},{target:'someone-else'},{verified:false}]) {
  const f = await fixture(t,{verify:async () => ({verified:true,id:'post-1',accountId:'self-1',text:'pong',target:'own-friends',...mismatch})});
  await f.run('prepare');assert.equal((await f.run('execute')).state,'confirmed_readback_pending');
  assert.equal((await f.run('verify')).state,'confirmed_readback_pending');
  assert.equal(f.posts(),1);
  assert.equal((await f.create(nextRevision).run({platform:'qzone',revision:nextRevision,mode:'prepare'},operator)).state,'blocked_unknown');
 }
});

test('wrong-account receipt remains unknown and is never treated as confirmed', async (t?: any) => {
 const f = await fixture(t,{publish:async () => ({id:'post-1',accountId:'wrong-account'})});
 await f.run('prepare');assert.equal((await f.run('execute')).state,'unknown');
 await assert.rejects(() => fs.readFile(path.join(f.root,'qzone',revision,'receipt.json')), {code:'ENOENT'});
});

test('a callback explicitly marking its receipt unconfirmed cannot complete the test', async (t?: any) => {
 const f = await fixture(t,{publish:async () => ({id:'post-1',accountId:'self-1',confirmed:false})});
 await f.run('prepare');assert.equal((await f.run('execute')).state,'unknown');
 await assert.rejects(() => fs.readFile(path.join(f.root,'qzone',revision,'receipt.json')), {code:'ENOENT'});
});

test('specific proven pre-submit refusal retains intent and resolution while permitting a new revision',async (t?: any) =>{
 const f=await fixture(t,{publish:async()=>({confirmed:false,deliveryState:'not_sent',submitted:false,code:'CONTROL_NOT_UNIQUE',phase:'publish_upload_control'})},'douyin');
 await f.run('prepare');assert.equal((await f.run('execute')).state,'not_sent');
 const resolution=JSON.parse(await fs.readFile(path.join(f.root,'douyin',revision,'resolution.json'),'utf8'));assert.equal(resolution.state,'not_sent');
 assert.equal((await f.run('execute')).state,'already_recorded');
 assert.equal((await f.create(nextRevision).run({platform:'douyin',revision:nextRevision,mode:'prepare'},operator)).state,'prepared');
});

test('generic not_sent assertions and any accepted ID cannot unlock an uncertain attempt',async (t?: any) =>{
 for(const extra of [{phase:'after_submit'},{submitted:true},{receiptId:'accepted-id'}]){
  const f=await fixture(t,{publish:async()=>({confirmed:false,deliveryState:'not_sent',submitted:false,code:'CONTROL_NOT_UNIQUE',phase:'publish_upload_control',...extra})},'douyin');
  await f.run('prepare');assert.equal((await f.run('execute')).state,'unknown');assert.equal((await f.create(nextRevision).run({platform:'douyin',revision:nextRevision,mode:'prepare'},operator)).state,'blocked_unknown');
 }
});

test('Douyin prepare provides a private PNG, fixed text and self-public target', async (t?: any) => {
 const f = await fixture(t,{},'douyin');
 f.adapter.prepare = async (input?: any) => {
  assert.equal(input.text,'pong');assert.equal(input.target,'own-public');
  assert.ok(input.imagePath.startsWith(f.root + path.sep));assert.equal(path.extname(input.imagePath),'.png');
  assert.deepEqual((await fs.readFile(input.imagePath)).subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
  return {ready:true,accountId:'self-1'};
 };
 assert.equal((await f.run('prepare')).state,'prepared');assert.equal(f.posts(),0);
});

test('CLI defaults to prepare, requires revision and rejects arbitrary content', async () => {
 const cli: any = await import('../src/life/live-test-cli.mjs');
 assert.equal(typeof cli.parseLiveTestArgs,'function');
 assert.deepEqual(cli.parseLiveTestArgs(['qzone','--revision',revision]),{platform:'qzone',revision,mode:'prepare'});
 assert.equal(cli.parseLiveTestArgs(['douyin','--revision',revision,'--execute']).mode,'execute');
 assert.equal(cli.parseLiveTestArgs(['bilibili','--verify','--revision',revision]).mode,'verify');
 for(const argv of [['qzone'],['qq','--revision',revision],['qzone','--revision','abc'],['qzone','--revision',revision,'--text','pong'],['qzone','--revision',revision,'--execute','--verify']])assert.throws(() => cli.parseLiveTestArgs(argv));
});
