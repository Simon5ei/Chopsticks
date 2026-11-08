import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import yaml from 'js-yaml';
import {apply as applyGuard} from '../src/host/guard.mjs';

function permissions(mode?: any,names?: any){
 let restriction,guard;
 const ctx={tools:{view:()=>({visible:new Set<any>(names)}),restrict:(filter)=>{restriction=filter;return ()=>{};},guard:(fn)=>guard=fn},on(){},effect:(fn)=>fn()};
 applyGuard(ctx,{mode});
 return {visible:(name)=>restriction.allow.includes(name),executable:(name)=>guard({name})===undefined};
}

test('Bili reply capabilities are visible and executable only in their matching model scope',()=>{
 const names=['chopsticks_read','chopsticks_mark_read','chopsticks_recall','chopsticks_remember','chopsticks_rest','chopsticks_task_status','chopsticks_bili_dm_reply','chopsticks_bili_reply','chopsticks_send','mcp__bilibili__bili_comment','mcp__bilibili__bili_dynamic_post','mcp__bilibili__bili_video','chopsticks_develop','chopsticks_exec','chopsticks_task_start','chopsticks_task_follow','chopsticks_task_stop','chopsticks_task_report','chopsticks_image','chopsticks_forward','chopsticks_style_check','chopsticks_decide'];
 const dmAllowed=new Set<any>(['chopsticks_read','chopsticks_mark_read','chopsticks_recall','chopsticks_remember','chopsticks_rest','chopsticks_task_status','chopsticks_bili_dm_reply','mcp__bilibili__bili_video','mcp__bilibili__bili_subtitles']);
 for(const mode of ['qq','router','bili','bili-dm','worker','development','invalid-mode']){
  const access=permissions(mode,names);
  for(const name of ['chopsticks_bili_reply','chopsticks_bili_dm_reply']){
   const expected=name==='chopsticks_bili_reply'?mode==='bili':mode==='bili-dm';
   assert.equal(access.visible(name),expected,`${mode}: visibility ${name}`);
   assert.equal(access.executable(name),expected,`${mode}: execution ${name}`);
  }
  if(mode==='bili-dm')for(const name of names){
   assert.equal(access.visible(name),dmAllowed.has(name),`DM visibility ${name}`);
   assert.equal(access.executable(name),dmAllowed.has(name),`DM execution ${name}`);
  }
 }
});

test('native Bili public and DM presets select distinct reply permissions',()=>{
 const presets=yaml.load(fs.readFileSync(new URL('../presets/runtime.patch.yml',import.meta.url),'utf8'))[0].insert;
 const names=['chopsticks_bili_reply','chopsticks_bili_dm_reply','chopsticks_send','mcp__bilibili__bili_comment'];
 for(const [id,allowed]of [['chopsticks-bili','chopsticks_bili_reply'],['chopsticks-bili-dm','chopsticks_bili_dm_reply']]){
  const preset=presets.find((p)=>p.config?.id===id);assert.ok(preset,`${id} is registered`);
  const mode=preset.config.plugins.find((p)=>p.name==='chopsticks/guard').config.mode;
  const access=permissions(mode,names);
  assert.equal(access.executable(allowed),true,id);
  assert.equal(access.executable(allowed==='chopsticks_bili_reply'?'chopsticks_bili_dm_reply':'chopsticks_bili_reply'),false,id);
  assert.equal(access.executable('chopsticks_send'),false,id);
 }
});

test('read plugins remain scoped and reminder tools are QQ-only',()=>{
 const names=['mcp__maibot_date__query_date','mcp__maibot_wiki__moegirl_lookup','chopsticks_reminder_set','chopsticks_reminder_list','chopsticks_reminder_cancel','chopsticks_exec'];
 for(const mode of ['router','qq','bili','worker','development']){
  let allowed,guard;const ctx={tools:{view:()=>({visible:new Set<any>(names)}),restrict:(spec)=>{allowed=spec.allow;return ()=>{};},guard:(fn)=>guard=fn},on(){},effect:(fn)=>fn()};
  const source=fs.readFileSync(new URL('../src/host/guard.mjs',import.meta.url),'utf8').replaceAll('export ','');vm.runInNewContext(source+'\napply(ctx,{mode});',{ctx,mode,queueMicrotask});
  assert.equal(allowed.includes(names[0]),mode!=='router');assert.equal(allowed.includes(names[1]),mode!=='router');
  for(const name of names.slice(2,5)){assert.equal(allowed.includes(name),mode==='qq');assert.equal(guard({name})===undefined,mode==='qq');}
  assert.equal(allowed.includes('chopsticks_exec'),mode==='development');
 }
});
test('queued tool refresh tolerates native scope becoming inactive before disposer callback',()=>{
 let refresh,change,stop,inactive=false;const known=new Set<any>(['chopsticks_decide']);
 const ctx={tools:{view:()=>({visible:known}),restrict:()=>{if(inactive)throw Object.assign(Error('inactive'),{code:'INACTIVE_EFFECT'});return ()=>{};},guard(){}},on:(_name?: any,fn?: any)=>change=fn,effect:(fn)=>stop=fn()};
 const source=fs.readFileSync(new URL('../src/host/guard.mjs',import.meta.url),'utf8').replaceAll('export ','');
 vm.runInNewContext(source+'\napply(ctx,{mode:"router"});',{ctx,queueMicrotask:(fn)=>refresh=fn});
 change();inactive=true;known.clear();assert.doesNotThrow(()=>refresh());assert.doesNotThrow(()=>stop());
});

test('style diagnostics are visible and executable only to the QQ executor',()=>{
 for(const mode of ['qq','router','bili','worker','development','invalid-mode']){
  let restriction,guard;
  const ctx={tools:{view:()=>({visible:new Set<any>(['chopsticks_decide','chopsticks_send','chopsticks_style_check'])}),restrict:(filter)=>{restriction=filter;return ()=>{};},guard:(fn)=>guard=fn},on(){},effect:(fn)=>fn()};
  const source=fs.readFileSync(new URL('../src/host/guard.mjs',import.meta.url),'utf8').replaceAll('export ','');
  vm.runInNewContext(source+'\napply(ctx,{mode});',{ctx,mode,queueMicrotask});
  assert.equal(restriction.allow.includes('chopsticks_style_check'),mode==='qq',mode);
  assert.equal(guard({name:'chopsticks_style_check'})===undefined,mode==='qq',mode);
 }
});

test('anime command is unavailable to all model scopes',()=>{
 for(const mode of ['qq','router','bili','worker','development','invalid-mode']){
  let restriction,guard;
  const ctx={tools:{view:()=>({visible:new Set<any>(['chopsticks_anime_source'])}),restrict:(filter)=>{restriction=filter;return ()=>{};},guard:(fn)=>guard=fn},on(){},effect:(fn)=>fn()};
  const source=fs.readFileSync(new URL('../src/host/guard.mjs',import.meta.url),'utf8').replaceAll('export ','');
  vm.runInNewContext(source+'\napply(ctx,{mode});',{ctx,mode,queueMicrotask});
  assert.equal(restriction.allow.includes('chopsticks_anime_source'),false,mode);
  assert.equal(guard({name:'chopsticks_anime_source'})===undefined,false,mode);
 }
});
