import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createLiveTestRunner} from './live-test.mjs';
import {createBiliService} from '../bili/mcp/service.mjs';
import {readBiliDynamicReceipt} from '../bili/lib/dynamic-readback.mjs';
import {safeCode} from './status.mjs';
import {provenPublishRefusal,refusalEvidence} from '../platforms/douyin/publish-diagnostics.mjs';

const SOURCE_ROOT=fileURLToPath(new URL('../',import.meta.url));
const SOURCE_DIRS=['adapters','bili','core','desktop','host','image-source','life','platforms','presets','style','tasks'];
const SOURCE_FILES=['package.json','package-lock.json'];
const hash=value=>createHash('sha256').update(value).digest('hex');
const stableId=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const ownTarget=platform=>platform==='qzone'?'own-friends':'own-public';
const visibility=platform=>platform==='qzone'?'friends':'public';
const urlFor=(platform,id,account)=>platform==='bilibili'?`https://t.bilibili.com/${id}`:platform==='heybox'?`https://www.xiaoheihe.cn/app/bbs/link/${id}`:platform==='douyin'?`https://www.douyin.com/note/${id}`:`https://user.qzone.qq.com/${account}/mood/${id}`;

/** Freeze this manifest outside the source tree; the request never chooses files. */
export async function buildLiveSourceManifest(sourceRoot=SOURCE_ROOT) {
 const files=[];
 async function visit(relative) {
  const file=path.join(sourceRoot,relative);let stat;try{stat=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}
  if(stat.isSymbolicLink())throw Error('Invalid source inventory');
  if(stat.isDirectory()){for(const name of (await fs.readdir(file)).sort())await visit(`${relative}/${name}`);}
  else if(stat.isFile() && /\.(?:mjs|js|json|py|sh|yml|yaml)$/.test(relative))files.push({path:relative,sha256:hash(await fs.readFile(file))});
 }
 for(const name of [...SOURCE_DIRS,...SOURCE_FILES])await visit(name);
 files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(!files.some(x=>x.path==='package.json')||!files.some(x=>x.path.startsWith('life/')))throw Error('Incomplete source inventory');
 return {version:1,revision:hash(files.map(x=>`${x.path}\0${x.sha256}\n`).join('')),files};
}

async function sourceManifest(stateDir,sourceRoot,checkFiles=true) {
 let manifest;try{manifest=JSON.parse(await fs.readFile(path.join(stateDir,'life','source-revision.json'),'utf8'));}catch{throw Error('Live source manifest unavailable');}
 if(manifest?.version!==1 || !/^[a-f0-9]{64}$/.test(manifest.revision)||!Array.isArray(manifest.files))throw Error('Invalid live source manifest');
 if(checkFiles){const actual=await buildLiveSourceManifest(sourceRoot);if(JSON.stringify(actual)!==JSON.stringify(manifest))throw Error('Live source manifest mismatch');}
 return manifest;
}

async function stagePng(config,input) {
 if(!config.douyin?.desktopUser)return input.imagePath;
 const root=config.douyin.userStateDir;
 if(typeof root!=='string'||!path.isAbsolute(root)||await fs.realpath(root)!==path.normalize(root))throw Error('Invalid media directory');
 const info=await fs.lstat(root);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Invalid media directory');
 if(process.platform!=='win32') {
  if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(config.douyin.desktopUser))throw Error('Invalid desktop account');
  const {stdout}=await promisify(execFile)('/usr/bin/getent',['passwd',config.douyin.desktopUser],{encoding:'utf8',timeout:5000});
  const fields=stdout.trim().split(':');if(fields[0]!==config.douyin.desktopUser || Number(fields[2])!==info.uid || info.uid<=0 || (info.mode&0o077))throw Error('Invalid desktop account');
 }
 const media=path.join(root,'media');let created=false;try{await fs.mkdir(media,{mode:0o700});created=true;}catch(e){if(e.code!=='EEXIST')throw e;}
 if(created&&process.platform!=='win32')await fs.chown(media,info.uid,info.gid);
 const stat=await fs.lstat(media);if(!stat.isDirectory()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.uid!==info.uid||(stat.mode&0o077))))throw Error('Invalid media directory');
 const bytes=await fs.readFile(input.imagePath);if(!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw Error('Invalid fixed PNG');
 const staged=path.join(media,`live-pong-${input.revision}.png`);
 let handle;try{handle=await fs.open(staged,'wx',0o600);await handle.writeFile(bytes);if(process.platform!=='win32')await handle.chown(info.uid,info.gid);await handle.sync();}
 catch(e){if(e.code!=='EEXIST')throw e;const old=await fs.lstat(staged);if(!old.isFile()||old.isSymbolicLink()||(process.platform!=='win32'&&(old.uid!==info.uid||(old.mode&0o077)))||!(await fs.readFile(staged)).equals(bytes))throw Error('Invalid staged PNG');}
 finally{await handle?.close();}
 return staged;
}

function actualText(platform,value) {
 if(typeof value!=='string')return null;
 if(platform!=='heybox')return value;
 try{const blocks=JSON.parse(value);if(Array.isArray(blocks)&&blocks.every(b=>b.type==='text'&&typeof b.text==='string'))return blocks.map(b=>b.text).join('');}catch{}
 return value.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>\s*<p[^>]*>/gi,'\n').replace(/^<p[^>]*>|<\/p>$/gi,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
}

export function createLivePlatformTests({config,owners,state,now=Date.now,sourceRoot=SOURCE_ROOT,biliService,biliReadback=readBiliDynamicReceipt}={}) {
 const service=biliService||createBiliService({fishHome:config.fishHome});
 function health(platform,action,result,error=false) {
  const code=safeCode(result?.code)||(result?.warnings||[]).map(safeCode).find(Boolean);
  const stateName=/verification_required/i.test(code||'')?'verification_required':/login_required/i.test(code||'')?'login_required':error?'unknown':result?.confirmed===false?'unknown':result?.warnings?.length?'partial':'ready';
  state.put?.('health',`life-operation:${platform}:${action}`,{state:stateName,at:now(),...(code?{code}:{}),...(stableId(result?.receiptId)?{receiptId:result.receiptId}:{})});
 }
 return {async run(request,context={}) {
  if(context.operator!==true)throw Error('Live test requires operator authorization');
  if(!request||Object.keys(request).some(k=>!['platform','revision','mode'].includes(k)))throw Error('Invalid live test request');
  if(config.validation===true)throw Error('Live writes disabled in validation');
  const {platform,mode}=request,adapter=owners[platform],signal=context.signal;
  if(!['qzone','douyin','heybox','bilibili'].includes(platform)||!adapter)throw Error('Live platform unavailable');
  const manifest=await sourceManifest(config.stateDir,sourceRoot,mode!=='verify');
  const ensureSource=async()=>{signal?.throwIfAborted();const current=await sourceManifest(config.stateDir,sourceRoot);if(current.revision!==manifest.revision)throw Error('Live source changed');};
  const account=async()=>{
   signal?.throwIfAborted();
   if(platform==='bilibili'){const cfg=JSON.parse(await fs.readFile(path.join(config.fishHome,'bili.config.json'),'utf8'));const id=String(cfg.self?.mid??'');if(!/^[1-9][0-9]{0,19}$/.test(id))throw Error('Bili account unavailable');return id;}
   const status=await adapter.status({signal});if(status?.state!=='ready'||!stableId(status.accountId))throw Error('Live account unavailable');return status.accountId;
  };
  const read=async(action,id)=>{try{const result=await adapter.read({action,...id?{id}:{},limit:1,signal});health(platform,action,result);const code=result?.warnings?.find(x=>/required|error|unavailable|invalid|unverified|incomplete|unexpected|transport/i.test(x));if(!Array.isArray(result?.items)||code)throw Object.assign(Error('Readback preflight unavailable'),{code:safeCode(code)});return result;}catch(e){health(platform,action,{code:e.code},true);throw e;}};
  const callbacks={
   prepare:async input=>{
    const accountId=await account();
    if(platform==='bilibili'){
     const dry=await service.call('bili_dynamic_post',{text:'pong',mode:'dry'},{role:'operator',canWrite:true,sessionId:`live-test:${manifest.revision}`,signal});
     health(platform,'publish',{code:dry?.isError?'BILI_PREFLIGHT_FAILED':'DRY_PREFLIGHT_ONLY'},true);if(dry?.isError)throw Error('Bili preflight failed');
    }else{
     if(!adapter.capabilities?.publish||!adapter.capabilities?.detail)throw Error('Live operation unavailable');
     const feed=await read('feed');if(feed.items[0]?.id){const detail=await read('detail',feed.items[0].id);if(!detail.items.some(x=>x.id===feed.items[0].id))throw Error('Detail preflight failed');}
     if(platform==='douyin')await stagePng(config,input);
     if(await account()!==accountId)throw Error('Account changed');
    }
    return {ready:true,accountId};
   },
   publish:async input=>{
    await ensureSource();if(await account()!==input.accountId)throw Error('Account changed');
    let receipt;
    if(platform==='bilibili'){
     const output=await service.call('bili_dynamic_post',{text:'pong',mode:'go'},{role:'operator',canWrite:true,sessionId:`live-test:${input.intent.intentId}`,signal});
     const r=output?.structuredContent?.receipt;
     if(r?.status==='confirmed'&&r.kind==='dynamic'&&/^[1-9][0-9]{0,19}$/.test(r.id)&&r.url===urlFor(platform,r.id))receipt={confirmed:true,platformId:r.id,accountId:input.accountId};
     else receipt={confirmed:false,state:'unknown',code:'BILI_RECEIPT_UNKNOWN'};
    }else{
     const writeContext={accountId:input.accountId,...platform==='douyin'?{format:'image',media:[{path:await stagePng(config,input)}]}:{}};
     signal?.throwIfAborted();
     try{receipt=await adapter.write({action:'publish',targetId:ownTarget(platform),text:'pong',intentId:input.intent.intentId,context:writeContext,signal});}catch(e){health(platform,'publish',{code:e.code},true);throw Error('Live publish unknown');}
    }
    health(platform,'publish',receipt);
    if(platform==='douyin'&&provenPublishRefusal(receipt))return {confirmed:false,code:receipt.code,...refusalEvidence(receipt)};
    if(receipt?.confirmed!==true){return {confirmed:false,...stableId(receipt?.receiptId)&&(!receipt.accountId||receipt.accountId===input.accountId)?{accepted:true,receiptId:receipt.receiptId,accountId:input.accountId}:{},...safeCode(receipt?.code)?{code:receipt.code}:{}};}
    const receiptAccount=receipt.accountId;
    if(!stableId(receipt.platformId)||receiptAccount!==input.accountId||(platform!=='bilibili'&&(receipt.targetId!==(platform==='qzone'?receipt.platformId:ownTarget(platform))||receipt.visibility!==visibility(platform))))throw Error('Live receipt mismatch');
    return {id:receipt.platformId,accountId:input.accountId,url:urlFor(platform,receipt.platformId,input.accountId)};
   },
   verify:async input=>{
    if(!input.receipt?.id)return {verified:false};
    if(await account()!==input.accountId)return {verified:false};
    const id=input.receipt.id,url=urlFor(platform,id,input.accountId);
    if(platform==='bilibili'){
     const r=await biliReadback({fishHome:config.fishHome,receipt:{status:'confirmed',kind:'dynamic',id,url},expectedText:'pong',signal});
     if(r?.status!=='verified'||r.id!==id)return {verified:false};
    }else if(platform==='qzone'){
     if(typeof adapter.verifyOwnPost!=='function')return {verified:false};
     const r=await adapter.verifyOwnPost({id,accountId:input.accountId,signal});
     if(r?.verified!==true||r.id!==id||r.accountId!==input.accountId||r.text!=='pong'||r.target!=='own-friends'||r.visibility!=='friends'||r.visibilityEvidence!=='qzone_raw_ugc_right_4'){health(platform,'detail',{code:r?.code||'QZONE_READBACK_UNKNOWN'},true);return {verified:false};}
    }else{
     const expectedId=id;
     const result=await read('detail',expectedId),item=result.items.find(x=>x.id===expectedId);
     if(!item||item.actorId!==input.accountId||actualText(platform,item.text)!=='pong'||item.visibility!==visibility(platform))return {verified:false};
    }
    health(platform,'publish',{confirmed:true});return {verified:true,id,accountId:input.accountId,text:'pong',target:ownTarget(platform),url,...platform==='qzone'?{visibilityEvidence:'qzone_raw_ugc_right_4'}:{}};
   }
  };
  const runner=createLiveTestRunner({root:path.join(config.stateDir,'life','live-test'),revision:manifest.revision,platforms:{[platform]:callbacks}});
  return runner.run(request,context);
 }};
}
