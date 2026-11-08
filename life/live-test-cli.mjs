import {pathToFileURL} from 'node:url';
import {requestPlatform} from './bridge.mjs';
import {platformSocketPath} from './mcp.mjs';

export function parseLiveTestArgs(argv) {
 const [platform,...rest]=argv;
 if(!['qzone','douyin','heybox','bilibili'].includes(platform))throw Error('Invalid live test platform');
 let revision,mode='prepare',explicitMode=false;
 for(let i=0;i<rest.length;i++) {
  if(rest[i]==='--revision' && revision===undefined){revision=rest[++i];continue;}
  if(['--execute','--verify'].includes(rest[i]) && !explicitMode){mode=rest[i].slice(2);explicitMode=true;continue;}
  throw Error('Invalid live test arguments');
 }
 if(typeof revision!=='string' || !/^[a-f0-9]{64}$/.test(revision))throw Error('A 64-character source revision is required');
 return {platform,revision,mode};
}
export async function liveTestCommand(argv) {
 const {platform,revision,mode}=parseLiveTestArgs(argv);
 return requestPlatform({socketPath:await platformSocketPath(),platform,operation:'live_test',args:{revision,mode},operator:true});
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {process.stdout.write(JSON.stringify(await liveTestCommand(process.argv.slice(2)))+'\n');}
 catch {process.stderr.write('Live test command failed.\n');process.exitCode=1;}
}
