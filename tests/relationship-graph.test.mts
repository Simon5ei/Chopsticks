import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelationshipGraph,socialSource} from '../src/host/relationship-graph.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createHostState} from '../src/host/state.mjs';
const event=(id?: any,channel?: any,actorId: string='42')=>({id,channel,actorId,kind:'message.received',at:'2026-11-06T00:00:00Z',text:'hello',meta:{senderName:'小鲸友'}});
const fixture=()=>{const records=new Map(),events=new Map();const state={get:(k?: any,id?: any)=>records.get(k+':'+id),put:(k?: any,id?: any,v?: any)=>records.set(k+':'+id,structuredClone(v))};const graph=createRelationshipGraph({state,store:{get:(id)=>events.get(id)},now:()=>100});return {graph,events,state};};
const report=(id?: any,source?: any,from: string='42',to: string='fish')=>({id,kind:'social',scope:source.channel.startsWith('g:')?'public':'private:'+source.channel.split(':')[0].replace('p','qq'),sourceEventIds:[source.id],createdAt:100,facts:[],relationships:[{from,to,relation:'常聊天',certainty:'observed',sourceEventIds:[source.id]}]});
test('social sources include QQ and content DMs, excluding comments, feeds, plans and future IM',()=>{
 for(const c of ['p:1','g:2','bili:dm:3','douyin:dm:4','heybox:dm:5'])assert.equal(socialSource(event('e',c)),true,c);
 for(const c of ['bili:public','heybox:public','douyin:public','qzone:friends','wechat:dm:1','operator:x'])assert.equal(socialSource(event('e',c)),false,c);
 assert.equal(socialSource({...event('e','g:1'),kind:'task.result',meta:{experienced:true}}),false);
});
test('reversed relationships merge into one undirected edge and report replay is idempotent',()=>{
 const f=fixture(),e=event('e','g:1');f.events.set(e.id,e);
 f.graph.accept(report('r1',e));f.graph.accept(report('r2',e,'fish','42'));f.graph.accept(report('r2',e,'fish','42'));
 const g=f.graph.get();assert.equal(g.nodes.length,2);assert.equal(g.edges.length,1);assert.equal(g.revision,2);
 assert.deepEqual(new Set<any>([g.edges[0].source,g.edges[0].target]),new Set<any>(['qq:42','fish']));assert.equal(g.nodes.find((n)=>n.id==='qq:42').label,'小鲸友');
});
test('same numeric actor on another platform remains distinct and excluded old reports cannot contaminate graph',()=>{
 const f=fixture();for(const c of ['g:1','bili:dm:42','bili:public','qzone:friends']){const e=event(c,c);f.events.set(c,e);f.graph.accept(report('r'+c,e));}
 const g=f.graph.get();assert.deepEqual(g.nodes.map((n)=>n.id).sort(),['bili:42','fish','qq:42']);assert.equal(g.edges.length,2);
});
test('unknown actors and mixed allowed/disallowed evidence cannot create relationship edges',()=>{
 const f=fixture(),e=event('e','p:42'),bad=event('bad','bili:public');f.events.set('e',e);f.events.set('bad',bad);
 f.graph.accept(report('forged',e,'99'));const r=report('mixed',e);r.relationships[0].sourceEventIds.push('bad');f.graph.accept(r);
 assert.equal(f.graph.get().edges.length,0);
});

test('bounded backfill advances past 200 unrelated reports and resumes idempotently',()=>{
 const db=new DatabaseSync(':memory:'),e=event('e','g:1'),store={db,get:(id)=>id==='e'?e:undefined},state=createHostState(store);
 try{state.put('evolution-report','early',report('early',e));for(let i=0;i<205;i++)state.put('evolution-report','noise'+i,{kind:'reflection'});state.put('evolution-report','late',report('late',e));
 const graph=createRelationshipGraph({state,store});graph.sync();assert.equal(graph.get().revision,1);graph.sync();assert.equal(graph.get().revision,2);graph.sync();assert.equal(graph.get().revision,2);assert.equal(graph.get().edges.length,1);
 }finally{db.close();}
});

test('confirmed outbound QQ identity and fish share a single node',()=>{
 const f=fixture(),sent={...event('sent','g:1','99'),kind:'message.sent'},received=event('received','g:1','42');f.events.set('sent',sent);f.events.set('received',received);
 const r=report('self-alias',received,'99','42');r.sourceEventIds=['sent','received'];r.relationships[0].sourceEventIds=['sent','received'];f.graph.accept(r);
 assert.deepEqual(f.graph.get().nodes.map((n)=>n.id).sort(),['fish','qq:42']);assert.equal(f.graph.get().edges.length,1);
});

test('old projection receipts do not prevent rebuilding the corrected graph',()=>{
 const f=fixture(),e=event('e','g:1');f.events.set(e.id,e);f.state.put('relationship-graph','current',{version:1,revision:10,nodes:[{id:'stale'}],edges:[]});f.state.put('relationship-applied','r',{revision:10});
 f.graph.accept(report('r',e));assert.equal(f.graph.get().version,2);assert.equal(f.graph.get().revision,1);assert.deepEqual(f.graph.get().nodes.map((n)=>n.id).sort(),['fish','qq:42']);f.graph.accept(report('r',e));assert.equal(f.graph.get().revision,1);
});
