import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {provenPublishRefusal,refusalEvidence} from '../platforms/douyin/publish-diagnostics.mjs';

const PLATFORMS = new Set<any>(['qzone','douyin','heybox','bilibili']);
const REVISION = /^[a-f0-9]{64}$/;
const inflight = new Set<any>();
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);
const targetFor = (platform) => platform === 'qzone' ? 'own-friends' : 'own-public';

async function privateDirectory(directory?: any) {
 const firstCreated=await fs.mkdir(directory,{recursive:true,mode:0o700});
 const stat = await fs.lstat(directory);
 if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw Error('Live test directory must be private');
 if(firstCreated && process.platform!=='win32'){
  let current=directory;
  for(;;){await syncDirectory(path.dirname(current));if(current===firstCreated)break;current=path.dirname(current);}
 }
}
async function syncDirectory(directory?: any) {
 // Windows does not expose directory fsync through Node. Files are still fsynced.
 if (process.platform === 'win32') return;
 const handle = await fs.open(directory,'r');
 try {await handle.sync();} finally {await handle.close();}
}
async function exclusive(file?: any,data?: any) {
 const handle = await fs.open(file,'wx',0o600);
 try {await handle.writeFile(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data,null,2)+'\n');await handle.sync();} finally {await handle.close();}
 await syncDirectory(path.dirname(file));
}
async function replace(file?: any,data?: any) {
 const temp = file+'.'+randomUUID()+'.tmp';
 await exclusive(temp,data);
 await fs.rename(temp,file);await syncDirectory(path.dirname(file));
}
async function read(file?: any) {
 try {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid live test ledger');
  return JSON.parse(await fs.readFile(file,'utf8'));
 } catch(error) {if(error.code === 'ENOENT')return null;throw Error('Invalid live test ledger');}
}

// Deterministic PNG with only the four fixed glyphs; no uploaded/caller media.
function pongPng() {
 const glyphs = ['11110/10001/10001/11110/10000/10000/10000','00000/01110/10001/10001/10001/01110/00000','00000/11110/10001/10001/10001/10001/00000','00000/01111/10001/10001/01111/00001/11110'].map((g) => g.split('/'));
 const width=512,height=512,scale=16,left=72,top=192;
 const pixels=Buffer.alloc(height*(1+width*3),255);
 for(let y=0;y<height;y++)pixels[y*(1+width*3)]=0;
 for(let g=0;g<4;g++)for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(glyphs[g][y][x]==='1')for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++) {
  const offset=(top+y*scale+dy)*(1+width*3)+1+(left+(g*6+x)*scale+dx)*3;
  pixels.fill(24,offset,offset+3);
 }
 function chunk(type?: any,data?: any) {
  const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([header,body,tail]);
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}

/** root is a deployment-configured PRIVATE artifact directory, never a request field.
 * prepare is read-only and returns {ready:true,accountId}; publish sends once and
 * returns {id,accountId}; verify reads actual platform data and returns
 * {verified:true,id,accountId,text,target}. Recovery without a known receipt also
 * requires {intentId:intent.intentId,correlated:true}, backed by unique platform
 * request evidence, never a text/time-only search. All callbacks receive intent.
 */
export function createLiveTestRunner({root,revision:sourceRevision,platforms}: { root?: any; revision?: any; platforms?: any; [key: string]: any }) {
 if(typeof root!=='string' || !path.isAbsolute(root) || typeof sourceRevision!=='string' || !REVISION.test(sourceRevision) || !platforms || typeof platforms!=='object')throw Error('Invalid live test configuration');
 root=path.resolve(root);
 return {async run(request?: any,context: Record<string, any>={}) {
  if(context.operator!==true)throw Error('Live test requires operator authorization');
  if(!request || typeof request!=='object' || Array.isArray(request) || Object.keys(request).some((k)=>!['platform','revision','mode'].includes(k)))throw Error('Invalid live test request');
  const {platform,revision,mode}=request;
  if(!PLATFORMS.has(platform) || typeof revision!=='string' || !REVISION.test(revision) || !['prepare','execute','verify'].includes(mode))throw Error('Invalid live test request');
  if(mode!=='verify' && revision!==sourceRevision)throw Error('Live test source revision mismatch');
  const adapter=platforms[platform];
  if(!adapter || ['prepare','publish','verify'].some((k)=>typeof adapter[k]!=='function'))throw Error('Live test platform is unavailable');
  const platformDir=path.join(root,platform),directory=path.join(platformDir,revision);
  await privateDirectory(root);await privateDirectory(platformDir);await privateDirectory(directory);
  const file=(name)=>path.join(directory,name+'.json'),activeFile=path.join(platformDir,'active.json');
  const result=(state?: any,extra: Record<string, any>={})=>({state,platform,revision,...extra});
  const report=async (state?: any,extra: Record<string, any>={})=>{const value=result(state,{...extra,updatedAt:new Date().toISOString()});await replace(file('result'),value);return value;};
  let active=await read(activeFile),intent=await read(file('intent')),receipt=await read(file('receipt')),candidate=await read(file('candidate')),verified=await read(file('verified')),resolution=await read(file('resolution'));
  if(mode!=='verify' && (intent || verified || active?.revision===revision))return result('already_recorded',{recordedState:verified?'verified':resolution?.state==='not_sent'?'not_sent':receipt?'confirmed_readback_pending':'unknown'});
  if(active && active.revision!==revision)return result('blocked_unknown');
  const input={platform,revision,text:'pong',target:targetFor(platform),imagePath:platform==='douyin'?path.join(directory,'pong.png'):null};
  async function releaseReservation() {
   // The configured platform owner is the sole process performing readback.
   const current=await read(activeFile);
   if(current?.revision===revision){await fs.unlink(activeFile);await syncDirectory(platformDir);}
  }

  async function readback() {
   const knownReceipt=receipt||candidate;
   const unresolved=()=>report(receipt?'confirmed_readback_pending':'unknown',knownReceipt?{receiptId:knownReceipt.id}:{});
   let evidence;
   try {evidence=await adapter.verify({...input,accountId:intent.accountId,intent,receipt:knownReceipt});} catch {return unresolved();}
   if(evidence?.verified!==true || !validId(evidence.id) || evidence.accountId!==intent.accountId || evidence.text!=='pong' || evidence.target!==input.target || (knownReceipt && evidence.id!==knownReceipt.id) || (!knownReceipt && (evidence.correlated!==true || !validId(intent.intentId) || evidence.intentId!==intent.intentId)))return unresolved();
   let safeUrl;try{const u=new URL(evidence.url);if(u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=1000)safeUrl=u.href;}catch{}
   const privacyProof=platform==='qzone'&&evidence.visibilityEvidence==='qzone_raw_ugc_right_4'?{visibilityEvidence:'qzone_raw_ugc_right_4'}:{};
   const confirmed={id:evidence.id,accountId:intent.accountId,text:'pong',target:input.target,...privacyProof,...safeUrl?{url:safeUrl}:{},verifiedAt:new Date().toISOString()};
   if(!receipt){receipt={id:evidence.id,accountId:intent.accountId,confirmedAt:confirmed.verifiedAt};await replace(file('receipt'),receipt);}
   await replace(file('verified'),confirmed);
   const output=await report('verified',{id:evidence.id,...privacyProof,...safeUrl?{url:safeUrl}:{}});
   // Never clear another revision's reservation.
   await releaseReservation();
   return output;
  }

  if(mode==='verify') {
   if(inflight.has(platformDir))return result('in_progress');
   inflight.add(platformDir);
   try {
    if(resolution?.state==='not_sent'){await releaseReservation();return result('not_sent',{code:resolution.code,phase:resolution.phase});}
    if(verified){await releaseReservation();return result('verified',{id:verified.id,...verified.visibilityEvidence?{visibilityEvidence:verified.visibilityEvidence}:{},...verified.url?{url:verified.url}:{}});}
    if(!intent)return result(active?'unknown':'no_record');
    return await readback();
   } finally {inflight.delete(platformDir);}
  }
  if(mode==='prepare') {
   // A refresh failure must not leave an older readiness result executable.
   await fs.rm(file('prepared'),{force:true});await syncDirectory(directory);
   if(input.imagePath) {
    const bytes=pongPng();
    try {await exclusive(input.imagePath,bytes);} catch(error) {if(error.code!=='EEXIST')throw error;if(!(await fs.readFile(input.imagePath)).equals(bytes))throw Error('Invalid fixed PNG artifact');}
   }
   let readiness;
   try {readiness=await adapter.prepare({...input});} catch {return result('not_ready');}
   if(readiness?.ready!==true || !validId(readiness.accountId))return result('not_ready');
   await replace(file('prepared'),{...input,accountId:readiness.accountId,preparedAt:new Date().toISOString()});
   return result('prepared',{text:'pong',target:input.target,accountId:readiness.accountId});
  }

  const prepared=await read(file('prepared'));
  if(!prepared || prepared.platform!==platform || prepared.revision!==revision || prepared.text!=='pong' || prepared.target!==input.target || !validId(prepared.accountId))return result('preparation_required');
  if(input.imagePath && !(await fs.readFile(input.imagePath)).equals(pongPng()))throw Error('Invalid fixed PNG artifact');
  // This exclusive, fsynced reservation is never released on uncertainty. Even a
  // crash between reservation and intent blocks another external attempt.
  try {await exclusive(activeFile,{revision,reservedAt:new Date().toISOString()});} catch(error) {
   if(error.code==='EEXIST'){active=await read(activeFile);return result(active?.revision===revision?'already_recorded':'blocked_unknown');}
   throw error;
  }
  inflight.add(platformDir);
  try {
   intent={...input,accountId:prepared.accountId,intentId:randomUUID(),startedAt:new Date().toISOString()};
   try {await exclusive(file('intent'),intent);} catch(error) {if(error.code==='EEXIST')return result('already_recorded');throw error;}
   let published;
   try {published=await adapter.publish({...input,accountId:intent.accountId,intent});} catch {return report('unknown');}
   if(platform==='douyin'&&provenPublishRefusal(published)){
    resolution={state:'not_sent',platform,revision,intentId:intent.intentId,code:published.code,...refusalEvidence(published),resolvedAt:new Date().toISOString()};
    await replace(file('resolution'),resolution);const output=await report('not_sent',{code:published.code,...refusalEvidence(published)});await releaseReservation();return output;
   }
   if(published?.confirmed===false&&published.accepted===true&&validId(published.receiptId)&&published.accountId===intent.accountId){
    await replace(file('candidate'),{id:published.receiptId,accountId:intent.accountId,confirmed:false,acceptedAt:new Date().toISOString()});
    return report('unknown',{receiptId:published.receiptId});
   }
   if(!validId(published?.id) || published.accountId!==intent.accountId || published.confirmed===false)return report('unknown');
   receipt={id:published.id,accountId:intent.accountId,confirmedAt:new Date().toISOString()};
   await replace(file('receipt'),receipt);
   return await readback();
  } finally {inflight.delete(platformDir);}
 }};
}
