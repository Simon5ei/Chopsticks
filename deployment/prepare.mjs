// Run on the server as its existing DSH service owner. No secrets are printed.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {migrateMemory} from './migrate-memory.mjs';
const mode=process.argv[2];if(!['validation','production'].includes(mode))throw Error('Expected validation or production');
const validation=mode==='validation';
const app=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const root=validation?'/opt/chopsticks-validation':'/var/lib/chopsticks';
const home=validation?path.join(root,'home/dsh'):'/root/.dsh';
const stateDir=path.join(root,'state'),fishHome=path.join(root,'fish');
fs.mkdirSync(stateDir,{recursive:true,mode:0o700});fs.mkdirSync(fishHome,{recursive:true,mode:0o700});fs.mkdirSync(home,{recursive:true,mode:0o700});
const read=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
const old=read('/opt/surfcore/config.json');
for(const name of ['characters','bili','bili.config.json','config.json','alignments.json']){const source=path.join('/root/.dsh/surfcore',name);if(fs.existsSync(source))fs.cpSync(source,path.join(fishHome,name),{recursive:true});}
const current=read(path.join(fishHome,'characters/current.json'));current.dir=path.join(fishHome,'characters',current.id);fs.writeFileSync(path.join(fishHome,'characters/current.json'),JSON.stringify(current));
const bili=read(path.join(fishHome,'bili.config.json'));delete bili.toolsPath;fs.writeFileSync(path.join(fishHome,'bili.config.json'),JSON.stringify(bili,null,2),{mode:0o600});
const config={stateDir,fishHome,validation,validationProbe:validation,model:{provider:'deepseek-official',model:'deepseek-flash'},fishGuard:old.fishGuard,
 qq:{enabled:true,httpUrl:old.snowluma.httpUrl,wsUrl:old.snowluma.wsUrl,token:old.snowluma.accessToken,ownerId:old.ownerQQ,allowGroups:old.allow.groups,allowUsers:old.allow.private,denyUsers:old.deny.users},
 bili:{enabled:!validation,allowWrite:!validation,sessionId:`bili-whale-${current.id}`,intervalMs:Math.max(600000,(bili.night?.minGapMin||30)*60000),maxVideos:Math.min(6,bili.night?.maxVideos||3),windows:bili.night?.windows||[],maxWakesPerDay:bili.night?.maxWakesPerDay||12},webSearch:old.webSearch};
if(validation){config.qq={enabled:true};config.bili.enabled=false;config.bili.allowWrite=false;}
else {
 const response=await fetch(`${config.qq.httpUrl.replace(/\/$/,'')}/get_login_info`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.qq.token}`},body:'{}',signal:AbortSignal.timeout(10000)});
 const login=await response.json();if(!response.ok||login.status!=='ok'||login.retcode!==0||!/^\d+$/.test(String(login.data?.user_id)))throw Error('QQ account verification failed');
 config.qq.selfId=String(login.data.user_id);
 const account=read(path.join(old.snowluma.homeDir||'/opt/snowluma/gateway-data','config',`onebot_${config.qq.selfId}.json`));
 const ws=account.networks?.wsServers?.find(s=>Number(s.port)===Number(new URL(config.qq.wsUrl).port));
 if(!ws?.accessToken)throw Error('Current QQ account websocket credential unavailable');
 config.qq.token={http:old.snowluma.accessToken,ws:ws.accessToken};
}
fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(config,null,2),{mode:0o600});
const oldMap=read('/opt/surfcore/state/sessions.json',{sessions:{}}).sessions;
const sessions=validation?{}:Object.fromEntries(Object.entries(oldMap).map(([key,id])=>[key.replace(/^group:/,'g:').replace(/^private:/,'p:'),id]));
fs.writeFileSync(path.join(stateDir,'qq-sessions.json'),JSON.stringify({sessions}),{mode:0o600});
const sourceProfile='/root/.dsh/profiles/web',targetProfile=path.join(home,'profiles/web');fs.mkdirSync(targetProfile,{recursive:true});
if(validation){for(const name of ['.credentials.yaml','credentials.yaml']){const p='/root/.dsh/'+name;if(fs.existsSync(p))fs.copyFileSync(p,path.join(home,name));}}
const original=yaml.load(fs.readFileSync(path.join(sourceProfile,'cordis.patch.yml'),'utf8'));
function filter(rows){return rows.flatMap(row=>{if(row.insert){const list=filter(row.insert);return list.length?[{...row,insert:list}]:[];}if(/snowluma|surfcore|sessioncross|web-search-safe/.test(`${row.id||''} ${row.name||''}`))return [];return [row];});}
const patches=filter(original);
for(const row of patches)if(row.id==='agent-default-model')row.config={...row.config,...config.model};
// Generic web MCP is supplied by this repository when present.
if(fs.existsSync(path.join(app,'web/server.mjs')))patches.push({insert:[{id:'mcp-web-search-safe',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'web-search-safe',transport:'stdio',command:'/opt/node24/bin/node',args:[path.join(app,'web/server.mjs')],env:{CHOPSTICKS_CONFIG:path.join(root,'config.json')}}}]});
fs.writeFileSync(path.join(targetProfile,'cordis.patch.yml'),yaml.dump(patches,{lineWidth:-1}));
fs.writeFileSync(path.join(targetProfile,'cordis.yml'),'[]\n');
fs.writeFileSync(path.join(targetProfile,'package.json'),JSON.stringify({name:'dsh-profile-web',private:true,dependencies:{chopsticks:`link:${app}`},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','chopsticks']}}},null,2));
fs.mkdirSync(path.join(targetProfile,'node_modules'),{recursive:true});
const link=path.join(targetProfile,'node_modules/chopsticks');if(fs.existsSync(link))fs.unlinkSync(link);fs.symlinkSync(app,link,'dir');
let stats={};if(!validation)stats=migrateMemory({config,runtimeStateDir:stateDir,oldSocialFile:'/opt/surfcore/state/social-v2.json'});
console.log(JSON.stringify({mode,root,home,app,sessions:Object.keys(sessions).length,migration:stats}));
