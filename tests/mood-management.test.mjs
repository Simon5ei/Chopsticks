import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {registerManagement} from '../host/management.mjs';
import {registerConsole} from '../host/console.mjs';

function capture(register){const routes=[];register({inject(_deps,fn){return fn({connection:{fetch:{register(route){routes.push(route);return ()=>{};}}}});}});return routes;}
const snapshot={enabled:true,mode:'express',simulated:true,upstream:{version:'0.1.7',commit:'0123456789abcdef'},scope:'public',state:{emotion:{key:'joy',label:'<img src=x onerror=alert(1)>',intensity:.4},valence:.3,arousal:.2,mood:{valence:.1,arousal:.05}},history:[{at:1794038400123,sourceEventIds:['public-<script>'],emotion:{key:'joy',label:'开心',intensity:.4},valence:.3,arousal:.2,sources:[{id:'public-<script>',channel:'qq:group:7',at:1794038300123}]}],updatedAt:1794038400123,revision:3};
function rpc(payload){return new Request('http://localhost/api/chopsticks-console',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'mood-test',method:'chopsticks-console',payload:{endpoint:'mood',payload}})});}

test('mood assets are served through management with navigation and local resources',async()=>{
 const routes=capture(registerManagement),page=routes.find(r=>r.path==='/api/chopsticks/mood');assert.ok(page,'mood page is registered');
 const html=await (await page.fetch()).text();assert.match(html,/href="\/api\/chopsticks"/);assert.match(html,/src="\/api\/chopsticks\/mood.js"/);assert.match(html,/href="\/api\/chopsticks\/mood.css"/);
 assert.match(await (await routes.find(r=>r.path==='/api/chopsticks').fetch()).text(),/href="\/api\/chopsticks\/mood"/);
 for(const path of ['/api/chopsticks/mood','/api/chopsticks/mood.js','/api/chopsticks/mood.css']){const r=routes.find(r=>r.path===path);assert.deepEqual(r.methods,['GET']);const response=await r.fetch();assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);assert.equal(response.headers.get('Cache-Control'),'no-store');}
});

test('mood RPC forwards reads and only the three supported mode changes',async()=>{
 const calls=[],route=capture(ctx=>registerConsole(ctx,{async queryConsole(endpoint,payload){calls.push({endpoint,payload});return {...snapshot,mode:payload.mode??'express'};}}))[0];
 for(const payload of [{},{action:'mode',mode:'paused'},{action:'mode',mode:'observe'},{action:'mode',mode:'express'}]){const result=(await (await route.fetch(rpc(payload))).json()).result;assert.equal(result.ok,true);assert.equal(result.value.mode,payload.mode??'express');}
 assert.deepEqual(calls,[{endpoint:'mood',payload:{}},{endpoint:'mood',payload:{action:'mode',mode:'paused'}},{endpoint:'mood',payload:{action:'mode',mode:'observe'}},{endpoint:'mood',payload:{action:'mode',mode:'express'}}]);
 for(const payload of [{mode:'paused'},{action:'mode',mode:'anything'},{action:'mode',mode:'paused',path:'identity'},{action:'write',mode:'express'}])assert.equal((await (await route.fetch(rpc(payload))).json()).result.ok,false);
 assert.equal(calls.length,4,'invalid operations never reach runtime');
});

class Element{
 constructor(){this.children=[];this.textContent='';this.disabled=false;this.attributes={};this.className='';}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;this.textContent='';}setAttribute(name,value){this.attributes[name]=String(value);}addEventListener(name,fn){this['on'+name]=fn;}
 set innerHTML(_value){throw Error('Unsafe HTML rendering');}
 get allText(){return this.textContent+this.children.map(n=>n.allText??n).join(' ');}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function browser(fetcher){
 const html=fs.readFileSync(new URL('../console/management/mood.html',import.meta.url),'utf8'),elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()])),intervals=[],document={hidden:false,getElementById:id=>{assert.ok(elements.has(id),`missing #${id}`);return elements.get(id);},createElement:()=>new Element(),addEventListener(name,fn){this['on'+name]=fn;}};
 vm.runInNewContext(fs.readFileSync(new URL('../console/management/mood.js',import.meta.url),'utf8'),{document,fetch:fetcher,crypto:{randomUUID:()=> 'browser-rpc'},AbortSignal,Response,TextDecoder,Date,setInterval:(fn,ms)=>intervals.push({fn,ms}),console},{timeout:1000});await settle();await settle();return {elements,document,intervals};
}
const success=value=>Response.json({type:'server-response',rpcId:'browser-rpc',result:{ok:true,value}});

test('browser renders simulated state and exact public source data as text, including empty state',async()=>{
 const ui=await browser(async()=>success(snapshot));assert.equal(ui.elements.get('emotion').textContent,snapshot.state.emotion.label);assert.match(ui.elements.get('simulation').textContent,/模拟/);assert.match(ui.elements.get('history').allText,/public-<script>/);assert.match(ui.elements.get('history').allText,/2026-11-07T08:00:00.123Z/);assert.match(ui.elements.get('history').allText,/qq:group:7/);assert.match(ui.elements.get('updated').textContent,/2026-11-07T08:00:00.123Z/);
 const empty=await browser(async()=>success({...snapshot,state:null,history:[],updatedAt:null}));assert.match(empty.elements.get('emotion').textContent,/尚无/);assert.match(empty.elements.get('history').allText,/暂无/);assert.doesNotMatch(empty.elements.get('valence').textContent,/NaN|0\.00/);
 const initial=await browser(async()=>success({...snapshot,state:{...snapshot.state,initial:true},history:[],revision:0}));assert.match(initial.elements.get('emotion').textContent,/尚无/);assert.equal(initial.elements.get('valence').textContent,'—');
});

test('browser serializes requests, confirms returned mode, preserves state on failure and skips hidden refresh',async()=>{
 const calls=[];let resolvePending;const ui=await browser(async(_url,options)=>{calls.push(JSON.parse(options.body));return success(snapshot);});
 assert.equal(ui.intervals[0].ms,30000);ui.document.hidden=true;ui.intervals[0].fn();await settle();assert.equal(calls.length,1);ui.document.hidden=false;
 // A delayed mode response must keep the displayed mode and prevent another request.
 const originalMode=ui.elements.get('mode').textContent;
 // The fetch closure changes its behavior after initial read.
 const ui2=await browser(async(_url,options)=>{const call=JSON.parse(options.body);calls.push(call);if(call.payload.payload.action)return new Promise(resolve=>{resolvePending=resolve;});return success(snapshot);});
 const before=calls.length;ui2.elements.get('mode-observe').onclick();ui2.elements.get('mode-paused').onclick();ui2.elements.get('refresh').onclick();await settle();assert.equal(calls.length,before+1);assert.equal(ui2.elements.get('mode').textContent,originalMode);assert.equal(ui2.elements.get('mode-observe').disabled,true);
 resolvePending(success({...snapshot,mode:'observe'}));await settle();await settle();assert.match(ui2.elements.get('mode').textContent,/观察/);assert.deepEqual(calls.at(-1).payload,{endpoint:'mood',payload:{action:'mode',mode:'observe'}});
 ui2.elements.get('mode-express').onclick();await settle();resolvePending(Response.json({result:{ok:false,error:{message:'unavailable'}}}));await settle();await settle();assert.match(ui2.elements.get('mode').textContent,/观察/);assert.match(ui2.elements.get('status').textContent,/失败/);assert.equal(ui2.elements.get('mode-express').disabled,false);
});
