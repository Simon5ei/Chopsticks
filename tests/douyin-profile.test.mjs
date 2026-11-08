import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,rm,symlink,readlink,unlink,readFile} from 'node:fs/promises';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {createUserPlatform,managedProfileIsIdle} from '../platforms/douyin/user-platform.mjs';

test('Linux detached browser owner blocks recovery independently of worker PGID and singleton lock', {skip:process.platform!=='linux'},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'douyin-orphan-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const browser=spawn(process.execPath,['-e',"process.send('ready');setInterval(()=>{},1000)",'--',`--user-data-dir=${dir}`],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{if(browser.exitCode===null&&browser.signalCode===null){const done=once(browser,'exit');browser.kill();await done;}});await once(browser,'message');
 const stat=(await readFile(`/proc/${browser.pid}/stat`,'utf8')).slice((await readFile(`/proc/${browser.pid}/stat`,'utf8')).lastIndexOf(')')+2).split(' ');
 assert.equal(Number(stat[2]),browser.pid); // Real separate process-group leader, as Playwright launches Chrome.
 const lock=join(dir,'SingletonLock'),lockValue=`${hostname()}-${browser.pid}`;await symlink(lockValue,lock);
 let starts=0;const children=[],requests=[];
 const p=createUserPlatform({launch:{command:'fake',args:[],env:{},profileDir:dir},killImpl:()=>{throw Object.assign(Error('worker absent'),{code:'ESRCH'});},spawnImpl:()=>{
  const c=new EventEmitter();c.pid=90000000+starts++;c.stdin=new PassThrough();c.stdout=new PassThrough();children.push(c);
  c.stdin.on('data',d=>{const req=JSON.parse(String(d));requests.push(req.method);if(starts>1)c.stdout.write(JSON.stringify({id:req.id,result:{state:'ready'}})+'\n');if(req.method==='close')setImmediate(()=>c.emit('exit',0,null));});return c;
 }});t.after(()=>p.close());
 const original=p.write({action:'publish',text:'pong',intentId:'one'});children[0].emit('exit',1,null);assert.equal((await original).state,'uncertain');
 assert.equal((await p.status()).state,'error');assert.equal(starts,1);assert.equal(await readlink(lock),lockValue);
 // Even if the lock is externally removed, the exact process cmdline still owns the profile.
 await unlink(lock);assert.equal((await p.status()).state,'error');assert.equal(starts,1);
 await symlink(lockValue,lock);const exited=once(browser,'exit');browser.kill();await exited;
 assert.equal((await p.status()).state,'ready');assert.deepEqual(requests,['write','status']);assert.equal(starts,2);
 assert.equal(await readlink(lock),lockValue); // Recovery leaves stale locks for native Chrome handling.
});

test('Linux profile probe fails closed for unknown lock owner and ignores unrelated profiles', {skip:process.platform!=='linux'},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'douyin-profile-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 assert.equal(managedProfileIsIdle(dir),true);
 await symlink('other-host-123456',join(dir,'SingletonLock'));assert.equal(managedProfileIsIdle(dir),false);await unlink(join(dir,'SingletonLock'));
 const other=spawn(process.execPath,['-e',"process.send('ready');setInterval(()=>{},1000)",'--',`--user-data-dir=${dir}-other`],{detached:true,stdio:['ignore','ignore','ignore','ipc']});
 t.after(async()=>{const done=once(other,'exit');other.kill();await done;});await once(other,'message');
 assert.equal(managedProfileIsIdle(dir),true);
});
