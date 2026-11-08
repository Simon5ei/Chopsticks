import path from 'node:path';

export const supportedPlugins=Object.freeze({
 date:{id:'github.xiexiaojia780.date-context-plugin',tools:['query_date','query_holiday']},
 wiki:{id:'xxxxx7258.moegirl-wiki-plugin',tools:['moegirl_lookup']},
});
export function normalizeMaiBotConfig(config: Record<string, any>={}){
 if(config.enabled!==true)return {enabled:false,plugins:[]};
 if(!Array.isArray(config.plugins)||config.plugins.length>2)throw Error('MaiBot requires at most two explicitly configured plugins');
 const seen=new Set<any>();
 const plugins=config.plugins.map((plugin)=>{
  if(!plugin||!Object.hasOwn(supportedPlugins,plugin.kind))throw Error('Unsupported MaiBot plugin kind');
  if(seen.has(plugin.kind))throw Error('Duplicate MaiBot plugin namespace');seen.add(plugin.kind);
  if(typeof plugin.root!=='string'||!path.isAbsolute(plugin.root))throw Error('MaiBot plugin root must be absolute');
  if(plugin.config!==undefined&&(!plugin.config||typeof plugin.config!=='object'||Array.isArray(plugin.config)))throw Error('Invalid plugin config');
  return {kind:plugin.kind,root:plugin.root,config:plugin.config||{}};
 });
 return {...config,enabled:true,plugins};
}
export function maiBotToolNames(config?: any){return normalizeMaiBotConfig(config).plugins.flatMap((p)=>supportedPlugins[p.kind].tools.map((n)=>`mcp__maibot_${p.kind}__${n}`));}
