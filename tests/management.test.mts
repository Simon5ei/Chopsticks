import test from 'node:test';import assert from 'node:assert/strict';
import {registerManagement} from '../src/host/management.mjs';
test('management assets use valid owner-only DSH fetch paths and contain no remote scripts',async()=>{
 const routes=[];registerManagement({inject(_deps?: any,fn?: any){return fn({connection:{fetch:{register(route?: any){assert.match(route.path,/^\/api\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/);routes.push(route);return ()=>{};}}}});}});
 assert.deepEqual(routes.map((route)=>route.path).sort(),['/api/chopsticks','/api/chopsticks/relationships.js','/api/chopsticks/relationships.css','/api/chopsticks/layout.js','/api/chopsticks/mood','/api/chopsticks/mood.js','/api/chopsticks/mood.css','/api/chopsticks/pipeline','/api/chopsticks/pipeline.js','/api/chopsticks/pipeline.css'].sort());
 for(const route of routes){assert.deepEqual(route.methods,['GET']);assert.equal(route.requestBody,'buffered');const response=await route.fetch();assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy'),/default-src 'self'/);assert.equal(response.headers.get('Cache-Control'),'no-store');}
 const html=await (await routes[0].fetch()).text();assert.doesNotMatch(html,/<script[^>]*src="https?:/);assert.match(html,/\/api\/chopsticks\/relationships.js/);
});
