import {pathToFileURL} from 'node:url';
import {platformSocketPath} from './mcp.mjs';
import {requestPlatform} from './bridge.mjs';
import {sanitizeDiagnostics as sanitizePublisherDiagnostics,validDmDiagnostic} from '../platforms/douyin/dm-diagnostics.mjs';

export async function operatorCommand(argv?: any){
 if(argv[0]==='diagnostics'){
  const args=argv[2]==='dm_controls'?{action:'dm_controls',peerName:argv[3]}:{action:argv[2]};
  if(argv[1]!=='douyin'||!(argv.length===3&&argv[2]==='publish_controls'||argv.length===4&&validDmDiagnostic(args)))throw Error('Invalid command');
  return sanitizePublisherDiagnostics(await requestPlatform({socketPath:await platformSocketPath(),platform:'douyin',operation:'diagnostics',args,operator:true}));
 }
 const [operation,platform,action,...extra]=argv;if(extra.length||!['status','login'].includes(operation)||!platform||(operation==='status'&&action)||(operation==='login'&&!['start','poll'].includes(action)))throw Error('Invalid command');
 const result=await requestPlatform({socketPath:await platformSocketPath(),platform,operation,args:action?{action}:{},operator:true});
 const output: Record<string, any>={};for(const key of ['state','qrImagePath','expiresAt'])if(result?.[key]!==undefined)output[key]=result[key];return output;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{process.stdout.write(JSON.stringify(await operatorCommand(process.argv.slice(2)))+'\n');}catch{process.stderr.write('Operator command failed.\n');process.exitCode=1;}}
