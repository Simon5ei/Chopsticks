import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn as spawnReal} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createCommandExecutor} from '../src/host/commands.mjs';
function fixture(extra: Record<string, any>={}) {
 const records=new Map(); const state={get:(k?: any,id?: any)=>records.get(id),put:(k?: any,id?: any,v?: any)=>records.set(id,structuredClone(v)),list:()=>[...records].map(([id,v])=>({id,...v}))};
 let spawns=0, child, options;
 const spawn=(shell?: any,args?: any,opts?: any)=>{spawns++; options=opts;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=123;child.kill=()=>{queueMicrotask(()=>child.emit('close',null,'SIGKILL'));};return child;};
 const runner=createCommandExecutor({state,workspace:process.cwd(),authorize:()=>({ticketId:'ticket'}),spawn,killGroup:(c)=>c.kill(),...extra});
 return {runner,state,records,get child(){return child;},get spawns(){return spawns;},get options(){return options;}};
}
const input={sessionId:'session',callId:'call',command:'echo hi'};
test('denied authorization never spawns',async()=>{const f=fixture({authorize:()=>{throw Error('denied');}});await assert.rejects(f.runner.execute(input),/denied/);assert.equal(f.spawns,0);});
test('journals before spawn and caches receipts; changed payload rejected',async()=>{const f=fixture();const p=f.runner.execute(input);await new Promise<any | void>((r)=>setImmediate(r));assert.equal([...f.records.values()][0].status,'running');f.child.stdout.write('hello');f.child.stderr.write('oops');f.child.emit('close',7,null);const result=await p;assert.equal(result.stdout,'hello');assert.equal(result.exitCode,7);assert.deepEqual(await f.runner.execute(input),result);assert.equal(f.spawns,1);await assert.rejects(f.runner.execute({...input,command:'other'}),/payload changed/);assert.equal(f.options.env.OPENAI_API_KEY,undefined);});
test('running journal recovers uncertain without replay',async()=>{const f=fixture();const p=f.runner.execute(input);await new Promise<any | void>((r)=>setImmediate(r));const g=fixture({state:f.state});await assert.rejects(g.runner.execute(input),/uncertain/);assert.equal(g.spawns,0);f.child.emit('close',0,null);await p;});
test('output bounded and sanitized before persistence',async()=>{const f=fixture({clean:(s)=>s.replaceAll('SECRET','[redacted]')});const p=f.runner.execute(input);await new Promise<any | void>((r)=>setImmediate(r));f.child.stdout.write('SECRET'+'x'.repeat(50000));f.child.emit('close',0,null);const result=await p;assert.ok(Buffer.byteLength(result.stdout)<=32768);assert.ok(result.stdoutTruncated);assert.ok(!JSON.stringify([...f.records.values()]).includes('SECRET'));});
test('abort and close terminate children and preserve side effect warning',async()=>{const f=fixture();const a=new AbortController();const p=f.runner.execute({...input,signal:a.signal});await new Promise<any | void>((r)=>setImmediate(r));a.abort();const result=await p;assert.equal(result.status,'cancelled');assert.match(result.warning,/side effects/i);await f.runner.close();await assert.rejects(f.runner.execute({...input,callId:'new'}),/closed/);});
test('validates timeout and handles spawn error without retry',async()=>{const f=fixture({spawn:()=>{throw Error('spawn failed SECRET');},clean:(s)=>s.replaceAll('SECRET','redacted')});await assert.rejects(f.runner.execute({...input,timeoutMs:999}),/timeout/);const r=await f.runner.execute(input);assert.equal(r.status,'failed');assert.ok(!JSON.stringify(r).includes('SECRET'));assert.deepEqual(await f.runner.execute(input),r);});
test('concurrent same call cannot spawn twice',async()=>{const f=fixture();const a=f.runner.execute(input);const b=f.runner.execute(input);const rejected=assert.rejects(b,/uncertain/);await new Promise<any | void>((r)=>setImmediate(r));assert.equal(f.spawns,1);f.child.emit('close',0,null);await a;await rejected;});
test('timeout kills group and records ambiguous side effects',async()=>{const f=fixture();const p=f.runner.execute({...input,timeoutMs:1000});const result=await p;assert.equal(result.status,'timed_out');assert.match(result.warning,/side effects/);});
test('real Linux shell executes and exit receipt is cached',{skip:process.platform==='win32'},async()=>{const f=fixture({spawn:undefined,killGroup:undefined});const r=await f.runner.execute({...input,command:'printf hello; printf error >&2; exit 3'});assert.equal(r.stdout,'hello');assert.equal(r.stderr,'error');assert.equal(r.exitCode,3);assert.deepEqual(await f.runner.execute({...input,command:'printf hello; printf error >&2; exit 3'}),r);await f.runner.close();});
test('close while authorization is pending prevents spawn',async()=>{let release;const gate=new Promise<any | void>((r)=>release=r);const f=fixture({authorize:async()=>{await gate;return {ticketId:'ticket'};}});const p=f.runner.execute(input);await f.runner.close();release();await assert.rejects(p,/closed/);assert.equal(f.spawns,0);});
test('audit observer closing executor prevents spawn',async()=>{let runner;const f=fixture({onRecord:(r)=>{if(r.status==='running')runner.close();}});runner=f.runner;await assert.rejects(runner.execute(input),/closed/);assert.equal(f.spawns,0);});
test('audit identity persists and is retained on cached receipts',async()=>{const audit=[];const f=fixture({authorize:()=>({ticketId:'ticket',eventId:'source',channel:'qq:group:1'}),onRecord:(r)=>audit.push(r)});const p=f.runner.execute(input);await new Promise<any | void>((r)=>setImmediate(r));assert.equal(audit[0].sessionId,'session');assert.equal(audit[0].eventId,'source');assert.equal(audit[0].channel,'qq:group:1');f.child.emit('close',0,null);const receipt=await p;assert.equal(receipt.sessionId,'session');assert.equal(receipt.eventId,'source');assert.equal(receipt.channel,'qq:group:1');assert.deepEqual(await f.runner.execute(input),receipt);assert.equal([...f.records.values()][0].sessionId,'session');});
test('real Linux cancellation kills the shell process group and background child',{skip:process.platform!=='linux',timeout:10000},async (t?: any) =>{
 const controller=new AbortController();let childPid,observed='';
 const f=fixture({killGroup:undefined,spawn:(...args)=>{
  const shell=(spawnReal as any)(...args);
  (shell as any).stdout.on('data',(chunk)=>{observed+=chunk.toString();const match=/^(\d+)\n/.exec(observed);if(match&&!childPid){childPid=Number(match[1]);setImmediate(()=>controller.abort());}});
  return shell;
 }});
 t.after(()=>{f.runner.close();if(childPid){try{process.kill(childPid,'SIGKILL');}catch{}}});
 const result=await f.runner.execute({...input,command:'sleep 30 & printf "%s\n" "$!"; wait',signal:controller.signal,timeoutMs:5000});
 assert.equal(result.status,'cancelled');assert.match(result.warning,/side effects/i);
 assert.ok(Number.isSafeInteger(childPid)&&childPid>0,'background child announced a real PID before abort');
 assert.equal(result.stdout.trim(),String(childPid));
 const running=()=>{try{const stat=readFileSync(`/proc/${childPid}/stat`,'utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[0]!=='Z';}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 for(let i=0;i<50&&running();i++)await delay(20);
 assert.equal(running(),false,'background child must be missing or zombie, never a live orphan');
});

test('public channels strip adult image-board links but keep the rest of the message',async()=>{
 const {stripHighRiskLinks,highRiskHostsIn}=await import('../src/host/link-policy.mjs');
 const text='找到了：https://e-hentai.org/g/123 和 https://danbooru.donmai.us/posts/1 ，出处是这部。';
 const out=stripHighRiskLinks(text);
 assert.equal(out.includes('e-hentai.org'),false);assert.equal(out.includes('danbooru'),false);
 assert.match(out,/找到了：/);assert.match(out,/出处是这部。/);
 assert.equal(highRiskHostsIn(text).length,2);
 assert.equal(stripHighRiskLinks('https://www.pixiv.net/artworks/123'),'https://www.pixiv.net/artworks/123');
});
