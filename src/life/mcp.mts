import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {observationMedia} from './observation-media.mjs';
import {requestPlatform} from './bridge.mjs';
import {platformFailure} from './platform-failure.mjs';

const platforms=new Set<any>(['qq','bilibili','qzone','heybox','douyin']);
export async function platformSocketPath(){const file=process.env.CHOPSTICKS_CONFIG;if(!file)throw Error('Missing configuration');const config=JSON.parse(await fs.readFile(file,'utf8'));if(config.life?.socketPath)return config.life.socketPath;if(!config.stateDir)throw Error('Missing state directory');return path.join(config.stateDir,'life','platform.sock');}
const schemas={
 status:z.object({}).strict(),
 read:z.object({ticket:z.string().min(1),action:z.enum(['feed','detail','comments','search','inbox','notifications']),limit:z.number().int().positive().optional(),cursor:z.string().optional(),id:z.string().optional(),url:z.string().optional(),query:z.string().optional()}).strict(),
 write:z.object({ticket:z.string().min(1),action:z.enum(['like','comment','reply','publish','dm']),targetId:z.string().optional(),parentId:z.string().optional(),text:z.string().optional(),intentId:z.string().optional(),title:z.string().max(100).optional(),format:z.enum(['image','article']).optional(),media:z.array(z.object({path:z.string()}).strict()).min(1).max(35).optional(),coverPath:z.string().optional()}).strict()
};
export function createPlatformMcp({platform,socketPath}: { platform?: any; socketPath?: any; [key: string]: any }){
 if(!platforms.has(platform))throw Error('Invalid platform');
 const server=new Server({name:`chopsticks-${platform}`,version:'0.1.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:Object.entries(schemas).map(([operation,schema])=>({name:`${platform}_${operation}`,description:`Platform ${operation}`,inputSchema:z.toJSONSchema(schema)}))}));
 server.setRequestHandler(CallToolRequestSchema,async (req?: any,extra?: any)=>{
  try{const operation=Object.keys(schemas).find((op)=>req.params.name===`${platform}_${op}`);if(!operation)throw Error();const args=schemas[operation].parse(req.params.arguments||{});const result=await requestPlatform({socketPath,platform,operation,args,signal:extra.signal});if(platform==='douyin'&&operation==='read'&&result?.media){
    const {media,...rest}=result;
    const sample=observationMedia(media,rest.items?.[0]?.id);
    if(sample)return {content:[{type:'text',text:JSON.stringify({...rest,mediaEvidence:{kind:sample.kind,seconds:sample.seconds}})},
      {type:'image',mimeType:'image/jpeg',data:sample.data}]};
    return {content:[{type:'text',text:JSON.stringify(rest)}]};
   }
   return {content:[{type:'text',text:JSON.stringify(result)}]};}catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify(platformFailure(error))}]};}
 });return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const i=process.argv.indexOf('--platform');const platform=i>=0?process.argv[i+1]:undefined;const socketPath=await platformSocketPath();await createPlatformMcp({platform,socketPath}).connect(new StdioServerTransport());}catch{process.stderr.write('Platform MCP could not start.\n');process.exitCode=1;}}
