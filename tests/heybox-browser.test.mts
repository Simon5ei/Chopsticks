import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireHeyboxWebsiteSession} from '../src/platforms/heybox/website-session.mjs';
test('candidate authentication uses real identity endpoint and returns no credentials',async()=>{
 const {verifyHeyboxCredentials}=await import('../src/adapters/heybox.mjs');
 assert.equal(typeof verifyHeyboxCredentials,'function');
 const original=globalThis.fetch;globalThis.fetch=async(url?: any)=>{assert.equal(url.pathname,'/account/restore_login');return new Response(JSON.stringify({status:'ok',result:{profile:{heybox_id:'42'}}}));};
 try{assert.deepEqual(await verifyHeyboxCredentials({cookies:{heybox_id:'42',pkey:'secret',x_xhh_tokenid:'website'}}),{state:'ready',accountId:'42'});}finally{globalThis.fetch=original;}
});
test('website enrichment retains credentials and accepts only browser-produced session token',async()=>{
 const stateDir=await mkdtemp(join(tmpdir(),'heybox-web-'));await writeFile(join(stateDir,'auth.json'),JSON.stringify({cookies:{heybox_id:'42',pkey:'secret'},deviceId:'d'}));let closed=false,installed,profile;
 const page={goto:async (url?: any) =>assert.equal(url,'https://www.xiaoheihe.cn/'),waitForFunction:async()=>{},url:()=> 'https://www.xiaoheihe.cn/'};
 const chromium={launchPersistentContext:async(dir?: any)=>{profile=dir;return {addCookies:async (cookies?: any) =>installed=cookies,pages:()=>[page],cookies:async()=>[{name:'x_xhh_tokenid',value:'browser-generated'},{name:'user_heybox_id',value:'42'}],close:async()=>{closed=true;}};}};
 const r=await acquireHeyboxWebsiteSession({stateDir,executablePath:'/browser',chromium,verify:async()=>({state:'ready',accountId:'42'})});assert.equal(r.state,'success');assert.equal(closed,true);assert.equal(profile,join(stateDir,'website-profile'));assert.equal(installed.find((x)=>x.name==='pkey').value,'secret');assert.equal(installed.find((x)=>x.name==='user_pkey')?.value,'secret');assert.equal(JSON.parse(await readFile(join(stateDir,'auth.json'),'utf8')).cookies.x_xhh_tokenid,'browser-generated');assert.doesNotMatch(JSON.stringify(r),/secret|browser-generated/);
});
test('website enrichment refuses swapped identity and never overwrites auth',async()=>{
 const stateDir=await mkdtemp(join(tmpdir(),'heybox-web-'));const source=JSON.stringify({cookies:{heybox_id:'42',pkey:'secret'}});await writeFile(join(stateDir,'auth.json'),source);
 const page={goto:async()=>{},waitForFunction:async()=>{},url:()=> 'https://www.xiaoheihe.cn/'};
 const chromium={launchPersistentContext:async()=>({addCookies:async()=>{},pages:()=>[page],cookies:async()=>[{name:'x_xhh_tokenid',value:'website'},{name:'user_heybox_id',value:'99'}],close:async()=>{}})};
 assert.equal((await acquireHeyboxWebsiteSession({stateDir,executablePath:'/browser',chromium,verify:async()=>({state:'ready',accountId:'99'})})).state,'refused');assert.equal(await readFile(join(stateDir,'auth.json'),'utf8'),source);
});
