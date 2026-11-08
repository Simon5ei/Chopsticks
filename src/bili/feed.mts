// One read-only candidate cycle. The host owns timing, standing rules and decisions.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commandEnvironment, runCommand, normalizeBvid } from './mcp/service.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export function createFeedProposal(options: Record<string, any> = {}) {
  const runner=options.runner || ((script?: any,args?: any,opts?: any)=>runCommand(process.execPath,
    ['--import',pathToFileURL(path.join(here,'mcp/network-guard.mjs')).href,script,...args],opts));
  return async ({limit=6,source='all',signal}: { limit?: number; source?: string; signal?: any; [key: string]: any }={}) => {
    if (!Number.isInteger(limit) || limit<1 || limit>12 || !['all','search','popular','rank','following'].includes(source)) throw new Error('Invalid feed proposal options');
    const result=await runner(path.join(here,'commands/feed.mjs'),['--n',String(limit),'--pages','1','--source',source,'--no-remember','--json'],
      {env:commandEnvironment(options),signal,timeoutMs:90000,maxBuffer:256*1024});
    if (result.code !== 0) throw new Error('Bili feed proposal failed');
    let data;
    try { data=JSON.parse(result.stdout); } catch {throw new Error('Invalid Bili feed response');}
    if (!data.ok || !Array.isArray(data.items)) throw new Error('Invalid Bili feed response');
    const items=data.items.slice(0,limit).flatMap((item)=>{
      try {
        const bvid=normalizeBvid(item.bv);
        return [{bvid,title:String(item.title||'').slice(0,300),up:String(item.up||'').slice(0,100),url:`https://www.bilibili.com/video/${bvid}/`}];
      } catch {return [];}
    });
    return {source:'bili',kind:'feed-proposal',items};
  };
}
