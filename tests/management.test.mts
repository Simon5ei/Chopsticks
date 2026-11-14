import test from 'node:test';import assert from 'node:assert/strict';
import {registerManagement} from '../src/host/management.mjs';
test('management assets use valid owner-only DSH fetch paths and contain no remote scripts',async()=>{
 const routes=[];registerManagement({inject(_deps?: any,fn?: any){return fn({connection:{fetch:{register(route?: any){assert.match(route.path,/^\/api\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/);routes.push(route);return ()=>{};}}}});}});
 assert.deepEqual(routes.map((route)=>route.path).sort(),['/api/chopsticks','/api/chopsticks/relationships.js','/api/chopsticks/relationships.css','/api/chopsticks/layout.js','/api/chopsticks/mood','/api/chopsticks/mood.js','/api/chopsticks/mood.css','/api/chopsticks/pipeline','/api/chopsticks/pipeline.js','/api/chopsticks/pipeline.css'].sort());
 for(const route of routes){assert.deepEqual(route.methods,['GET']);assert.equal(route.requestBody,'buffered');const response=await route.fetch();assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy'),/default-src 'self'/);assert.equal(response.headers.get('Cache-Control'),'no-store');}
 const html=await (await routes[0].fetch()).text();assert.doesNotMatch(html,/<script[^>]*src="https?:/);assert.match(html,/\/api\/chopsticks\/relationships.js/);
});

test('content recap route validates scope queries and uses the owner connection without caching',async()=>{
 const routes=[];
 const ctx={inject(_deps,fn){return fn({connection:{fetch:{register(route){routes.push(route);return ()=>{};}}}});}};
 const calls=[];
 registerManagement(ctx,{recap(scope,day){
  calls.push([scope,day]);
  if(!['public','qzone:friends'].includes(scope))throw Error('invalid');
  return {scope,day,items:[]};
 }});
 const route=routes.find(r=>r.path==='/api/chopsticks/content-recap');
 const req=query=>new Request('http://localhost/api/chopsticks/content-recap'+query);
 const good=await route.fetch(req('?scope=qzone%3Afriends&date=2026-11-09'));
 assert.equal(good.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(await good.json(),{scope:'qzone:friends',day:'2026-11-09',items:[]});
 assert.equal((await route.fetch(req('?scope=public&scope=qzone%3Afriends'))).status,400);
 assert.equal((await route.fetch(req('?scope=private%3Aqq'))).status,400);
 assert.deepEqual(calls,[['qzone:friends','2026-11-09'],['private:qq',undefined]]);
});
