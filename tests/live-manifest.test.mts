import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {buildLiveSourceManifest} from '../src/life/live-platforms.mjs';

async function fixture(t: any) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'chop-manifest-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const dir of ['life','console','web','maibot','vendor'])await fs.mkdir(path.join(root,dir));
 for(const [file,text]of Object.entries({'package.json':'{}','life/mcp.mjs':'export {};','console/client.js':'window.a=1;','web/server.mjs':'export {};','maibot/runner.py':'pass','vendor/rules.cjs':'module.exports={};'}))await fs.writeFile(path.join(root,file),text);
 return root;
}
test('live revision covers browser, web, Python and vendor execution assets',async t=>{
 const root=await fixture(t),before=await buildLiveSourceManifest(root);
 for(const file of ['console/client.js','web/server.mjs','maibot/runner.py','vendor/rules.cjs'])assert.ok(before.files.some(row=>row.path===file),file);
 await fs.writeFile(path.join(root,'console/client.js'),'window.a=2;');
 assert.notEqual((await buildLiveSourceManifest(root)).revision,before.revision);
});
test('live revision rejects oversized input before reading its contents',async t=>{
 const root=await fixture(t),file=await fs.open(path.join(root,'life/oversized.mjs'),'w');
 await file.truncate(2*1024*1024+1);await file.close();
 await assert.rejects(buildLiveSourceManifest(root),/budget|bound|large/i);
});
