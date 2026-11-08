import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {apply as applyGuard} from '../src/host/guard.mjs';

// Independent MCP catalog fixture: exercise the installed guard and its tool-change
// subscription, rather than importing its allowlist as the test expectation.
const desktopNames=['doctor','list_apps','list_windows','focused_window','get_app_state','screenshot','click','drag','scroll','press_key','type_text','perform_action','set_value','activate_window','move_window','resize_window'].map((name)=>`mcp__cul__${name}`);
const unsafeNames=['mcp__cul__run_shell','mcp__cul__setup_gnome','mcp__cul__setup_extension','mcp__cul__unknown_future_tool'];

function session(mode?: any,names: any[]=[...desktopNames,...unsafeNames,'chopsticks_decide']){
 const events=new EventEmitter(),catalog=new Map(),restrictions=new Set<any>();
 let guard,stop;
 for(const name of names)catalog.set(name,()=>({tool:name}));
 const ctx={
  tools:{
   view:()=>({visible:new Set<any>(catalog.keys())}),
   restrict:({allow}: { allow?: any; [key: string]: any })=>{const rule=new Set<any>(allow);restrictions.add(rule);return ()=>restrictions.delete(rule);},
   guard:(fn)=>{guard=fn;},
  },
  on:(name?: any,fn?: any)=>events.on(name,fn),
  effect:(fn)=>{stop=fn();},
 };
 applyGuard(ctx,mode===undefined?{}:{mode});
 return {
  visible:()=>[...catalog.keys()].filter((name)=>[...restrictions].every((rule: any) =>rule.has(name))),
  execute:(name)=>{const denied=guard({name});if(denied!==undefined)throw Error(denied);return catalog.get(name)();},
  update:(names)=>{catalog.clear();for(const name of names)catalog.set(name,()=>({tool:name}));events.emit('tools/change');},
  stop:()=>stop(),
 };
}

test('QQ and Bili public executors can discover and execute GNOME desktop tools',()=>{
 for(const mode of ['qq','bili',undefined]){
  const fish=session(mode);
  for(const name of desktopNames){
   assert.ok(fish.visible().includes(name),`${mode??'default QQ'} must expose ${name}`);
   assert.deepEqual(fish.execute(name),{tool:name});
  }
  fish.stop();
 }
});

test('Router stays decide-only and workers, Bili DM and unknown modes cannot use desktop tools',()=>{
 for(const mode of ['router','worker','development','bili-dm','invalid-mode']){
  const fish=session(mode);
  for(const name of desktopNames){
   assert.equal(fish.visible().includes(name),false,`${mode} must hide ${name}`);
   assert.throws(()=>fish.execute(name),/不具备此工具权限/,`${mode} must deny ${name}`);
  }
  if(mode==='router'){
   assert.deepEqual(fish.visible(),['chopsticks_decide']);
   assert.deepEqual(fish.execute('chopsticks_decide'),{tool:'chopsticks_decide'});
  }
  fish.stop();
 }
});

test('desktop access does not permit shell, setup or future tools in any model scope',()=>{
 for(const mode of ['qq','bili','router','worker','development','bili-dm','invalid-mode',undefined]){
  const fish=session(mode);
  for(const name of unsafeNames){
   assert.equal(fish.visible().includes(name),false,`${mode} must hide ${name}`);
   assert.throws(()=>fish.execute(name),/不具备此工具权限/,`${mode} must deny ${name}`);
  }
  fish.stop();
 }
});

test('MCP catalog changes expose newly registered desktop tools only in public executors',async()=>{
 for(const mode of ['qq','bili','router','worker','development','bili-dm','invalid-mode']){
  const fish=session(mode,['chopsticks_decide']);
  assert.equal(fish.visible().includes('mcp__cul__click'),false);
  fish.update(['chopsticks_decide','mcp__cul__screenshot']);
  fish.update(['chopsticks_decide',...desktopNames,...unsafeNames]);
  await new Promise<any | void>((resolve)=>queueMicrotask((resolve as any)));
  for(const name of desktopNames){
   assert.equal(fish.visible().includes(name),mode==='qq'||mode==='bili',`${mode} refreshed ${name}`);
  }
  assert.equal(fish.visible().includes('mcp__cul__run_shell'),false);
  if(mode==='qq'||mode==='bili')assert.deepEqual(fish.execute('mcp__cul__click'),{tool:'mcp__cul__click'});
  fish.update(['chopsticks_decide','mcp__cul__screenshot']);
  await new Promise<any | void>((resolve)=>queueMicrotask((resolve as any)));
  assert.equal(fish.visible().includes('mcp__cul__click'),false,`${mode} removed tool`);
  assert.equal(fish.visible().includes('mcp__cul__screenshot'),mode==='qq'||mode==='bili');
  fish.stop();
 }
});
