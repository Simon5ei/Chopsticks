// Offline, after stopping DSH and taking a complete backup. Preserve all events.
import fs from 'node:fs';
import path from 'node:path';
import {zstdCompressSync,zstdDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const [home,sessionId,preset]=process.argv.slice(2);
if(!home||!sessionId||preset!=='chopsticks-bili')throw Error('Expected DSH_HOME SESSION_ID chopsticks-bili');
const root=path.join(home,'sessions');const found=[];
for(const folder of fs.readdirSync(root)){const file=path.join(root,folder,sessionId,'session.v4.jsonl.zstd');if(fs.existsSync(file))found.push(file);}
if(found.length!==1)throw Error('Expected exactly one adopted Bili session');
const file=found[0],original=zstdDecompressSync(fs.readFileSync(file));const split=original.indexOf(10);if(split<0)throw Error('Invalid session');
const header=JSON.parse(original.subarray(0,split));if(header.type!=='session'||header.id!==sessionId)throw Error('Session header mismatch');
const events=original.subarray(split+1);const digest=b=>createHash('sha256').update(b).digest('hex');const before=digest(events);
header.agentPreset=preset;const output=Buffer.concat([Buffer.from(JSON.stringify(header)+'\n'),events]);
const temp=file+'.chopsticks-new';fs.writeFileSync(temp,zstdCompressSync(output),{mode:0o600});
const verify=zstdDecompressSync(fs.readFileSync(temp));if(digest(verify.subarray(verify.indexOf(10)+1))!==before)throw Error('History verification failed');
fs.renameSync(temp,file);console.log(JSON.stringify({preset,historyPreserved:true,eventBytes:events.length,eventsSha256:before}));
