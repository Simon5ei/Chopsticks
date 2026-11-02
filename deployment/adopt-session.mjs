// Offline, after stopping DSH and taking a complete backup. Preserve all events.
import fs from 'node:fs';
import path from 'node:path';
import {constants,zstdCompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodeZstdArchive} from './zstd.mjs';
const [home,sessionId,preset]=process.argv.slice(2);
if(!home||!sessionId||preset!=='chopsticks-bili')throw Error('Expected DSH_HOME SESSION_ID chopsticks-bili');
const root=path.join(home,'sessions');const found=[];
for(const folder of fs.readdirSync(root)){const file=path.join(root,folder,sessionId,'session.v4.jsonl.zstd');if(fs.existsSync(file))found.push(file);}
if(found.length!==1)throw Error('Expected exactly one adopted Bili session');
const file=found[0],original=decodeZstdArchive(fs.readFileSync(file));const split=original.indexOf(10);if(split<0)throw Error('Invalid session');
const header=JSON.parse(original.subarray(0,split));if(header.type!=='session'||header.id!==sessionId)throw Error('Session header mismatch');
const events=original.subarray(split+1);const digest=b=>createHash('sha256').update(b).digest('hex');const before=digest(events);
header.agentPreset=preset;
// DSH reads the first frame independently and requires exactly one header line.
// A valid whole-file decompression alone does not establish native readability.
const options={params:{[constants.ZSTD_c_checksumFlag]:1}};
const encodedHeader=zstdCompressSync(Buffer.from(JSON.stringify(header)+'\n'),options);
const output=Buffer.concat([encodedHeader,...events.length?[zstdCompressSync(events,options)]:[]]);
const temp=file+'.chopsticks-new';fs.writeFileSync(temp,output,{mode:0o600});
const verify=decodeZstdArchive(fs.readFileSync(temp));if(digest(verify.subarray(verify.indexOf(10)+1))!==before)throw Error('History verification failed');
fs.renameSync(temp,file);console.log(JSON.stringify({preset,historyPreserved:true,eventBytes:events.length,eventsSha256:before}));
