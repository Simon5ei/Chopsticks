import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../tasks/store.mjs';

const boot='08045b39-1234-4567-89ab-0123456789ab',oldBoot='18045b39-1234-4567-89ab-0123456789ab';
const stat=(pid,ticks='999')=>`${pid} (worker name with ) parentheses) S ${Array(18).fill('0').join(' ')} ${ticks} 0\n`;
const fault=code=>Object.assign(new Error('fixture OS failure'),{code});
function fixture(t,owner){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task-store-owner-'));
 const opened=[];t.after(()=>{for(const store of opened)store.close();fs.rmSync(dir,{recursive:true,force:true});});
 const seed=createStore(dir);
 seed.put('ticket','retained',{id:'retained',history:['unchanged']});
 seed.effects.queue({id:'unknown-send',kind:'deliver',payload:'retain'});seed.effects.set('unknown-send','inflight');
 if(owner!==undefined)seed.put('lease','coordinator',owner);
 seed.close();
 const options={platform:'linux',kill(){},readFile:file=>file==='/proc/sys/kernel/random/boot_id'?boot+'\n':stat(Number(/^\/proc\/(\d+)\/stat$/.exec(file)?.[1]))};
 const open=extra=>{const store=createStore(dir,{...options,...extra});opened.push(store);return store;};
 const read=()=>{const db=new DatabaseSync(path.join(dir,'superagent.sqlite'),{readOnly:true});try{return {owner:JSON.parse(db.prepare("SELECT value FROM records WHERE kind='lease' AND id='coordinator'").get().value),effect:db.prepare("SELECT state FROM effects WHERE id='unknown-send'").get().state};}finally{db.close();}};
 return {dir,options,open,read};
}
const owner=(extra={})=>({pid:process.pid,leaseId:'old-fixture',bootId:boot,startTicks:'999',...extra});

test('Linux lease records boot and exact start ticks even when stat comm contains spaces and parentheses',t=>{
 const f=fixture(t),ticks='18446744073709551615';
 const store=f.open({readFile:file=>file.endsWith('boot_id')?boot+'\n':stat(process.pid,ticks)});
 const lease=store.get('lease','coordinator');assert.equal(lease.bootId,boot);assert.equal(lease.startTicks,ticks);assert.equal(lease.pid,process.pid);
 assert.throws(()=>createStore(f.dir,{...f.options,readFile:file=>file.endsWith('boot_id')?boot:stat(process.pid,ticks)}),/active owner/);
});

for(const [label,prior] of [['previous boot',owner({bootId:oldBoot})],['same boot reused PID',owner({startTicks:'100'})]]){
 test(`${label} recovers despite a live reused PID while retaining task history and uncertain effects`,t=>{
  const f=fixture(t,prior);let store;assert.doesNotThrow(()=>{store=f.open();});
  assert.notEqual(store.get('lease','coordinator').leaseId,'old-fixture');assert.equal(store.get('lease','coordinator').startTicks,'999');
  assert.deepEqual(store.get('ticket','retained'),{id:'retained',history:['unchanged']});
  assert.deepEqual(store.effects.get('unknown-send'),{id:'unknown-send',kind:'deliver',payload:'retain',state:'uncertain'});
 });
}

test('a matching live Linux owner is rejected without touching its lease or effects',t=>{
 const f=fixture(t,owner()),before=f.read();assert.throws(()=>f.open(),/active owner/);assert.deepEqual(f.read(),before);
});

test('current Linux identity must be readable and valid before acquiring any lease',t=>{
 for(const readFile of [()=>{throw fault('EACCES');},file=>file.endsWith('boot_id')?'not-a-boot-id':stat(process.pid),file=>file.endsWith('boot_id')?boot:'truncated stat',file=>file.endsWith('boot_id')?boot:stat(process.pid+1),file=>file.endsWith('boot_id')?boot:stat(process.pid,'not-ticks')]){
  const f=fixture(t),before=f.read();assert.throws(()=>f.open({readFile}),/identity unavailable/);assert.deepEqual(f.read(),before);
 }
});

test('unreadable or malformed live-owner identity never permits stealing the journal',t=>{
 for(const cause of ['EACCES','ENOENT','malformed']){
  const pid=process.pid+1000000,f=fixture(t,owner({pid})),before=f.read();
  assert.throws(()=>f.open({readFile:file=>{if(file===`/proc/${pid}/stat`){if(cause==='malformed')return 'truncated stat';throw fault(cause);}return f.options.readFile(file);}}),/active owner/);
  assert.deepEqual(f.read(),before);
 }
});

test('legacy owner stays conservative when live or inaccessible but recovers on explicit ESRCH',t=>{
 for(const code of [null,'EPERM','ESRCH']){
  const f=fixture(t,{pid:process.pid,leaseId:'old-fixture'}),kill=()=>{if(code)throw fault(code);};
  if(code==='ESRCH')assert.doesNotThrow(()=>f.open({kill}));
  else{const before=f.read();assert.throws(()=>f.open({kill}),/active owner/);assert.deepEqual(f.read(),before);}
 }
});

test('same-boot owner disappearance is reclaimed only when the PID probe confirms ESRCH',t=>{
 const f=fixture(t,owner());assert.doesNotThrow(()=>f.open({kill:()=>{throw fault('ESRCH');}}));
});

test('permission errors do not turn a changed or partial identity into permission to steal',t=>{
 for(const prior of [owner({startTicks:'100'}),{pid:process.pid,leaseId:'old-fixture',bootId:boot}]){
  const f=fixture(t,prior),before=f.read();assert.throws(()=>f.open({kill:()=>{throw fault('EPERM');}}),/active owner/);assert.deepEqual(f.read(),before);
 }
});

test('Windows retains PID-only ownership without reading Linux identity files',t=>{
 const f=fixture(t),options={platform:'win32',readFile(){assert.fail('Windows must not read proc identity');}};
 const first=f.open(options);assert.equal(first.get('lease','coordinator').bootId,undefined);
 assert.throws(()=>createStore(f.dir,{...f.options,...options}),/active owner/);
});

for(const [label,prior] of [
 ['malformed boot UUID',owner({bootId:'invalid'})],
 ['missing start ticks',{pid:process.pid,leaseId:'old-fixture',bootId:oldBoot}],
 ['missing boot ID',{pid:process.pid,leaseId:'old-fixture',startTicks:'100'}],
 ['numeric start ticks',owner({startTicks:999})],
 ['malformed start ticks',owner({startTicks:'not-ticks'})],
 ['empty object',{}],
 ['missing PID',{leaseId:'old-fixture'}],
 ['zero PID',{pid:0,leaseId:'old-fixture'}],
 ['string PID',{pid:String(process.pid),leaseId:'old-fixture'}],
 ['missing lease ID',{pid:process.pid}],
 ['empty lease ID',{pid:process.pid,leaseId:''}],
 ['null record',null],
 ['boolean record',false],
 ['array record',[]],
 ['mixed released identity',owner({pid:null})],
 ['unexpected schema fields',{pid:process.pid,leaseId:'old-fixture',unknown:true}],
])test(`damaged lease (${label}) fails closed even if the PID probe would return ESRCH`,t=>{
 const f=fixture(t,prior),before=f.read();assert.throws(()=>f.open({kill:()=>{throw fault('ESRCH');}}),/active owner/);assert.deepEqual(f.read(),before);
});

test('an explicit valid released marker can reopen the journal',t=>{
 const f=fixture(t,{pid:null,leaseId:'previous-closed'});assert.doesNotThrow(()=>f.open());
});
