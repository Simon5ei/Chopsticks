import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function load(){ let module; vm.runInNewContext(readFileSync(new URL('../console/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load(value){module=value.factory(()=>({}));}}}}); return module; }
test('native controller unwraps RPC envelope and passes bounded filters',async()=>{
 const {Controller}=load(); let args;
 const c=new Controller({connection:{rpc:{call:async(...a)=>{args=a;return {result:{ok:true,value:{items:[{seq:3}],nextBeforeSeq:3}}};}}}});
 const page=await c.query('events',{query:'  hello  ',sessionId:'s',beforeSeq:9,limit:999});
 assert.equal(page.items[0].seq,3); assert.equal(args[0],'/api'); assert.equal(args[1],'chopsticks-console');
 assert.equal(args[2].payload.limit,100); assert.equal(args[2].payload.query,'hello'); assert.equal(args[2].payload.beforeSeq,9);
});
test('controller reports backend and transport failures without fabricating data',async()=>{
 const {Controller}=load(); const c=new Controller({connection:{rpc:{call:async()=>({ok:false,error:{message:'Unavailable'}})}}});
 await assert.rejects(c.query('traces'),/Unavailable/);
});
test('pagination merges by sequence and retains descending chronology',()=>{
 const {mergeItems}=load(); const items=mergeItems([{seq:7},{seq:6}],[{seq:6},{seq:5}]);
 assert.equal(items.length,3);assert.equal(items.map(x=>x.seq).join(','),'7,6,5');
});
test('overview interprets actual ready and QQ health without treating stopped or absent data as connected',()=>{
 const {overviewState}=load();
 assert.equal(overviewState(null,{busy:true}).status,'正在读取');
 assert.equal(overviewState(null,{error:'offline'}).status,'无法读取');
 assert.equal(overviewState({health:{ready:false,qq:{connected:true,receiveHealthy:true}}}).status,'已停止');
 assert.equal(overviewState({health:{ready:true,qq:{connected:false}}}).status,'QQ 已断开');
 assert.equal(overviewState({health:{ready:true,qq:{connected:true,receiveHealthy:false}}}).status,'QQ 接收异常');
 assert.equal(overviewState({health:{ready:true,qq:{connected:true,receiveHealthy:null}}}).status,'接收状态待确认');
 assert.equal(overviewState({health:{ready:true,qq:{connected:true,receiveHealthy:true}},model:{model:'deepseek-reasoner'}}).status,'运行正常');
 assert.equal(overviewState({model:{model:'deepseek-reasoner'}}).model,'deepseek-reasoner');
 assert.equal(overviewState({model:{modelId:'deepseek-chat'}}).model,'deepseek-chat');
});
test('timeline translates actual native and routing kinds to Chinese',()=>{
 const {kindLabel}=load();
 for(const kind of ['tool.call','tool.result','turn.start','turn.end','assistant.text','llm.retry','llm.retry-started','message.received','message.sent','router.assess','router.evaluate','router.decision','router.dispatch','dispatch','task.prompt','task.result']) {
   assert.notEqual(kindLabel(kind),kind);
 }
 assert.equal(kindLabel('future.kind'),'future.kind');
});
test('overview translates persisted router counts and runtime session roles',()=>{
 const {countLabel,roleLabel}=load();
 assert.equal(['assessing','decided','dispatching','observed','dispatched','failed','uncertain'].map(countLabel).join('、'),'评估中、已决策、执行中、已观察、已执行、失败、结果待确认');
 assert.equal(['qq','bili','router','worker'].map(roleLabel).join('、'),'QQ 会话、B站会话、协调器、任务执行器');
 assert.equal(roleLabel('future-role'),'future-role');
});
