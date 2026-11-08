import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import dns from 'node:dns';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createMaiBotBridge} from '../src/maibot/bridge.mjs';
import {normalizeMaiBotConfig,maiBotToolNames} from '../src/maibot/policy.mjs';

const temporary=(t)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-maibot-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
function protocolFixture(t?: any){const dir=temporary(t),runnerPath=path.join(dir,'child.mjs');fs.writeFileSync(runnerPath,`import readline from 'node:readline';
for await(const line of readline.createInterface({input:process.stdin})){const m=JSON.parse(line);if(m.method==='init')process.stdout.write(JSON.stringify({id:m.id,result:{tools:[{name:'mcp__maibot_date__query_date',plugin:'date',rawName:'query_date',description:'date',inputSchema:{type:'object',properties:{at:{type:'string'}}}}]}})+'\\n');
else if(m.method==='call'){if(m.args.at==='hang')continue;if(m.args.at==='crash')process.exit(4);process.stdout.write(JSON.stringify({id:m.id,result:{success:true,content:m.args.at,leaked:process.env.FIXTURE_API_KEY||null}})+'\\n');}else if(m.method==='close')process.exit(0);}`);return {python:process.execPath,runnerPath,dataDir:path.join(dir,'data'),plugins:[{kind:'date',root:dir}]};}

test('MaiBot opt-in rejects unknown kinds, invalid roots and duplicate tool namespaces',(t)=>{
 assert.equal(normalizeMaiBotConfig().enabled,false);
 assert.throws(()=>normalizeMaiBotConfig({enabled:true,plugins:[{kind:'shell',root:temporary(t)}]}),/unsupported/i);
 assert.throws(()=>normalizeMaiBotConfig({enabled:true,plugins:[{kind:'date',root:'relative'}]}),/absolute/i);
 const root=temporary(t);assert.throws(()=>normalizeMaiBotConfig({enabled:true,plugins:[{kind:'date',root},{kind:'date',root}]}),/duplicate/i);
 assert.deepEqual(maiBotToolNames({enabled:true,plugins:[{kind:'date',root}]}),['mcp__maibot_date__query_date','mcp__maibot_date__query_holiday']);
});

test('real child transport correlates concurrent calls, scrubs inherited secrets and rejects calls after close',async (t?: any) =>{
 const config=protocolFixture(t);process.env.FIXTURE_API_KEY='must-not-reach-child';t.after(()=>delete process.env.FIXTURE_API_KEY);
 const bridge=createMaiBotBridge(config);t.after(()=>bridge.close());const tools=await bridge.start();assert.equal(tools[0].name,'mcp__maibot_date__query_date');
 const values=await Promise.all(['one','two'].map((at)=>bridge.call('mcp__maibot_date__query_date',{at})));
 assert.deepEqual(values.map((r: any) =>r.content),['one','two']);assert.equal(values[0].leaked,null);
 await assert.rejects(bridge.call('mcp__maibot_date__not_allowed',{}),/unknown/i);
 await bridge.close();await assert.rejects(bridge.call('mcp__maibot_date__query_date',{}),/closed/i);
});

test('cancel and child crash settle all pending reads without a restart or retry',async (t?: any) =>{
 const bridge=createMaiBotBridge({...protocolFixture(t),timeoutMs:2000});t.after(()=>bridge.close());await bridge.start();
 const control=new AbortController(),cancelled=bridge.call('mcp__maibot_date__query_date',{at:'hang'},control.signal);control.abort();await assert.rejects(cancelled,/abort|cancel/i);
 const waiting=bridge.call('mcp__maibot_date__query_date',{at:'hang'}),crashing=bridge.call('mcp__maibot_date__query_date',{at:'crash'});
 await assert.rejects(waiting,/exit|closed|unavailable/i);await assert.rejects(crashing,/exit|closed|unavailable/i);
});

const realPython=process.env.CHOPSTICKS_MAIBOT_PYTHON,sourceRoot=process.env.CHOPSTICKS_MAIBOT_SOURCES;
test('checked-out date plugin supplies real Gregorian/lunar and holiday tools through the installed SDK',{skip:!realPython||!sourceRoot},async (t?: any) =>{
 const bridge=createMaiBotBridge({python:realPython,dataDir:temporary(t),plugins:[{kind:'date',root:path.join(sourceRoot,'xiexiaojia780--date_context_plugin')}]});t.after(()=>bridge.close());
 const tools=await bridge.start();assert.deepEqual(tools.map((t)=>t.rawName).sort(),['query_date','query_holiday']);
 const date=await bridge.call('mcp__maibot_date__query_date',{at:'2026-11-03'});assert.match(JSON.stringify(date),/2026/);assert.match(JSON.stringify(date),/星期二/);
 const holiday=await bridge.call('mcp__maibot_date__query_holiday',{name:'春节',year:2026});assert.match(JSON.stringify(holiday),/春节/);
 assert.equal(tools.some((t)=>/inject|date_text/.test(t.rawName)),false);
});

test('checked-out Moegirl plugin loads with its original config and handles invalid input without network',{skip:!realPython||!sourceRoot},async (t?: any) =>{
 const bridge=createMaiBotBridge({python:realPython,dataDir:temporary(t),plugins:[{kind:'wiki',root:path.join(sourceRoot,'YukiSakiko--moegirl_wiki_plugin')}]});t.after(()=>bridge.close());
 const tools=await bridge.start();assert.equal(tools[0].rawName,'moegirl_lookup');
 const result: any=await bridge.call('mcp__maibot_wiki__moegirl_lookup',{query:''});assert.equal(result.success,false);assert.equal(result.error,'empty_query');
});

test('original Moegirl lookup uses the host bounded public HTTP transport and returns real source parsing results',{skip:!realPython||!sourceRoot},async (t?: any) =>{
 const requests=[];t.mock.method(dns.promises,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
 t.mock.method(https,'request',(options?: any,callback?: any)=>{const req: any=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{requests.push(options);const page={pageid:1,title:'初音未来',fullurl:'https://zh.moegirl.org.cn/初音未来',extract:'Fixture 音声合成角色',categories:[{title:'Category:音乐角色'}]};const res: any=Readable.from([Buffer.from(JSON.stringify({query:{pages:{'1':page}}}))]);res.statusCode=200;res.headers={};res.complete=true;callback(res);});return req;});
 const bridge=createMaiBotBridge({python:realPython,dataDir:temporary(t),plugins:[{kind:'wiki',root:path.join(sourceRoot,'YukiSakiko--moegirl_wiki_plugin'),config:{network:{timeout_seconds:1}}}]});t.after(()=>bridge.close());
 const result: any=await bridge.call('mcp__maibot_wiki__moegirl_lookup',{query:'请问初音未来是谁？'});assert.equal(result.success,true);assert.match(result.content,/Fixture 音声合成角色/);assert.match(result.content,/https:\/\/zh.moegirl.org.cn\/初音未来/);assert.ok(requests.length>=2);
 assert.ok(requests.every((r)=>r.hostname==='93.184.216.34'&&r.headers.host==='zh.moegirl.org.cn'&&r.servername==='zh.moegirl.org.cn'&&!r.headers.authorization&&!r.headers.Cookie));
 assert.equal(new URL('https://zh.moegirl.org.cn'+requests[0].path).searchParams.get('gsrsearch'),'初音未来');
});

for(const problem of ['http','api'])test(`wiki ${problem} failure preserves opensearch fallback when date loads after wiki`,{skip:!realPython||!sourceRoot},async (t?: any) =>{
 const actions=[];t.mock.method(dns.promises,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
 t.mock.method(https,'request',(options?: any,callback?: any)=>{const req: any=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(((()=>{const q=new URL('https://zh.moegirl.org.cn'+options.path).searchParams;actions.push(q.has('generator')?'generator':q.get('action'));let payload: any=q.get('action')==='opensearch'?['初音未来',['初音未来'],['Fixture fallback'],['https://zh.moegirl.org.cn/初音未来']]:{query:{pages:{'1':{pageid:1,title:'初音未来',fullurl:'https://zh.moegirl.org.cn/初音未来',extract:'Fixture fallback summary'}}}};if(q.has('generator'))payload={error:{code:'unavailable',info:'fixture'}};const res: any=Readable.from([Buffer.from(JSON.stringify(payload))]);res.statusCode=q.has('generator')&&problem==='http'?500:200;res.headers={};res.complete=true;callback(res);}) as any));return req;});
 const bridge=createMaiBotBridge({python:realPython,dataDir:temporary(t),plugins:[{kind:'wiki',root:path.join(sourceRoot,'YukiSakiko--moegirl_wiki_plugin')},{kind:'date',root:path.join(sourceRoot,'xiexiaojia780--date_context_plugin')}]});t.after(()=>bridge.close());
 const result: any=await bridge.call('mcp__maibot_wiki__moegirl_lookup',{query:'初音未来'});assert.equal(result.success,true);assert.match(result.content,/Fixture fallback/);assert.deepEqual(actions.slice(0,2),['generator','opensearch']);
 const date=await bridge.call('mcp__maibot_date__query_date',{at:'2026-11-03'});assert.match(JSON.stringify(date),/星期二/);
});

for(const operation of ['abort','close'])test(`wiki ${operation} destroys the active host HTTP request`,{skip:!realPython||!sourceRoot},async (t?: any) =>{
 let entered,destroyed=0;const started=new Promise<any | void>((r)=>entered=r);const reqs=[];t.mock.method(dns.promises,'lookup',async()=>[{address:'93.184.216.34',family:4}]);
 t.mock.method(https,'request',()=>{const req: any=new EventEmitter();req.destroy=()=>{destroyed++;req.emit('error',Error('cancelled fixture request'));};req.end=()=>entered();reqs.push(req);return req;});
 const bridge=createMaiBotBridge({python:realPython,dataDir:temporary(t),plugins:[{kind:'wiki',root:path.join(sourceRoot,'YukiSakiko--moegirl_wiki_plugin')}]});t.after(async()=>{await bridge.close();for(const r of reqs)r.destroy();});
 const control=new AbortController(),pending=bridge.call('mcp__maibot_wiki__moegirl_lookup',{query:'初音未来'},control.signal);pending.catch(()=>{});await started;
 if(operation==='abort')control.abort();else await bridge.close();await assert.rejects(pending,/cancel|closed/i);assert.ok(destroyed>=1);
});

test('cancellation interrupts a real Python await and does not block the next read',{skip:!realPython||!sourceRoot},async (t?: any) =>{
 const dir=temporary(t);fs.writeFileSync(path.join(dir,'_manifest.json'),JSON.stringify({id:'github.xiexiaojia780.date-context-plugin'}));
 fs.writeFileSync(path.join(dir,'plugin.py'),`import asyncio\nfrom pathlib import Path\nfrom maibot_sdk import MaiBotPlugin,Tool,PluginConfigBase,Field\nclass Switch(PluginConfigBase):\n enabled: bool=False\nclass Meta(PluginConfigBase):\n config_version: str='1.0.0'\nclass Config(PluginConfigBase):\n plugin: Meta=Field(default_factory=Meta)\n reply_injection: Switch=Field(default_factory=Switch)\n planner_injection: Switch=Field(default_factory=Switch)\nclass Plugin(MaiBotPlugin):\n config_model=Config\n async def on_load(self): pass\n async def on_unload(self): pass\n async def on_config_update(self,*args): pass\n @Tool('query_date')\n async def query_date(self,at=''):\n  if at=='hang':\n   Path(__file__).with_name('started').write_text('started')\n   await asyncio.sleep(2)\n  return {'content':at}\n @Tool('query_holiday')\n async def holiday(self): return {'content':'quick'}\ndef create_plugin(): return Plugin()\n`);
 const bridge=createMaiBotBridge({python:realPython,dataDir:path.join(dir,'data'),plugins:[{kind:'date',root:dir}]});t.after(()=>bridge.close());await bridge.start();
 const control=new AbortController(),pending=bridge.call('mcp__maibot_date__query_date',{at:'hang'},control.signal);pending.catch(()=>{});
 for(let n=0;n<300&&!fs.existsSync(path.join(dir,'started'));n++)await delay(5);assert.ok(fs.existsSync(path.join(dir,'started')));
 control.abort();await assert.rejects(pending,/cancel/i);
 let timer;const result: any=await Promise.race([bridge.call('mcp__maibot_date__query_holiday',{}),new Promise<any | void>((_?: any,reject?: any)=>timer=setTimeout(()=>reject(Error('Cancelled Python read blocked the next call')),1000))]).finally(()=>clearTimeout(timer));
 assert.equal(result.content,'quick');
});
