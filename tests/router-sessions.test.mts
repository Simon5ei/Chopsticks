import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRouterSessions} from '../src/host/router-sessions.mjs';
const id='chopsticks-router-11111111-1111-4111-8111-111111111111';
function setup(t?: any){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'router-life-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const rows=new Map(),live=new Map(),archived=[],released=[],logs=[];
 const state={list:()=>[...rows.values()],put:(_kind?: any,key?: any,value?: any)=>rows.set(key,value)};
 let archiveFails=false,releaseFails=false;
 const create=()=>createRouterSessions({state,stateDir:dir,getAgent:(key)=>live.get(key),archive:async (key?: any) =>{if(archiveFails)throw Error('storage unavailable');archived.push(key);},release:async (key?: any) =>{if(releaseFails)throw Error('release failed');released.push(key);live.delete(key);},record:(value)=>logs.push(value),retryMs:0});
 return {dir,rows,live,archived,released,logs,create,failArchive:(value)=>archiveFails=value,failRelease:(value)=>releaseFails=value};
}
test('active evaluations and running tails survive; idle completion archives then releases once',async (t?: any) =>{
 const f=setup(t),life=f.create();life.begin(id);f.live.set(id,{status:'running'});
 await life.sweep();assert.equal(f.archived.length,0);
 life.finish(id,'decided');await life.sweep();assert.equal(f.archived.length,0);
 f.live.set(id,{status:'idle',inbox:{nextTurn:[],nextStep:[]}});
 await Promise.all([life.sweep(),life.sweep()]);assert.deepEqual(f.archived,[id]);assert.deepEqual(f.released,[id]);assert.equal(f.rows.get(id).status,'archived');
 await life.sweep();assert.equal(f.archived.length,1);
});
test('archive and release failures retry without losing lifecycle or deciding again',async (t?: any) =>{
 const f=setup(t),life=f.create();life.begin(id);life.finish(id,'timeout');f.failArchive(true);await life.sweep();assert.equal(f.released.length,0);assert.notEqual(f.rows.get(id).status,'archived');
 f.failArchive(false);f.failRelease(true);await life.sweep();assert.notEqual(f.rows.get(id).status,'archived');
 f.failRelease(false);await life.sweep();assert.equal(f.rows.get(id).status,'archived');assert.ok(f.logs.some((x)=>x.level==='warn'));
});
test('restart recovers owned router workspaces and pending records only; skips busy legacy agents',async (t?: any) =>{
 const f=setup(t);fs.mkdirSync(path.join(f.dir,'workers',id),{recursive:true});fs.mkdirSync(path.join(f.dir,'workers','qq-chat'),{recursive:true});fs.mkdirSync(path.join(f.dir,'workers','chopsticks-router-not-a-uuid'),{recursive:true});
 f.live.set(id,{status:'running'});let life=f.create();life.recover();await life.sweep();assert.equal(f.archived.length,0);
 f.live.delete(id);life=f.create();life.recover();await life.sweep();assert.deepEqual(f.archived,[id]);assert.equal(f.rows.size,1);
});
test('partial initialization and queued tails remain recoverable',async (t?: any) =>{
 const f=setup(t),life=f.create();life.begin(id);life.finish(id,'error');f.live.set(id,{status:'idle',inbox:{nextTurn:[{}]}});await life.sweep();assert.equal(f.archived.length,0);
 f.live.delete(id);await life.sweep();assert.deepEqual(f.archived,[id]);
});
test('a creation that left no native session is terminal, without retrying forever',async (t?: any) =>{
 const f=setup(t),life=createRouterSessions({state:{list:()=>[],put:(_k?: any,id?: any,row?: any)=>f.rows.set(id,row)},stateDir:f.dir,getAgent:()=>null,archive:async()=>{throw Object.assign(new Error('missing'),{name:'WorkspaceUnknownSessionError'});}});
 life.begin(id);life.finish(id,'error');await life.sweep();assert.equal(f.rows.get(id).status,'absent');
});
