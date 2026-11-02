import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
test('offline Bili adoption changes preset while preserving every historical event byte',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chop-deploy-'));const sessionId='bili-whale-fixture';const file=path.join(dir,'sessions','cwd',sessionId,'session.v4.jsonl.zstd');fs.mkdirSync(path.dirname(file),{recursive:true});
 const events='{"type":"user/message","data":{"text":"原来的记忆\n继续"}}\n{"type":"tool/result","data":{"receipt":"1"}}\n';
 fs.writeFileSync(file,zstdCompressSync(Buffer.from(JSON.stringify({type:'session',id:sessionId,agentPreset:'standard'})+'\n'+events)));
 const out=execFileSync(process.execPath,[fileURLToPath(new URL('../deployment/adopt-session.mjs',import.meta.url)),dir,sessionId,'chopsticks-bili'],{encoding:'utf8'});
 const result=zstdDecompressSync(fs.readFileSync(file)).toString();const split=result.indexOf('\n');assert.equal(JSON.parse(result.slice(0,split)).agentPreset,'chopsticks-bili');assert.equal(result.slice(split+1),events);assert.equal(JSON.parse(out).historyPreserved,true);
 fs.rmSync(dir,{recursive:true,force:true});
});
