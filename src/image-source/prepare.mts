import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Uploading a multi-megabyte original makes every engine slow and often fails.
// Anything over this budget is re-encoded once with ffmpeg, bounded by time and
// size; if the tool is missing or fails, the original is used unchanged.
export const UPLOAD_BUDGET = 3 * 1024 * 1024;
export function needsDownscale(bytes?: any){return bytes instanceof Uint8Array && bytes.length > UPLOAD_BUDGET;}
function runFfmpeg(input?: any, output?: any, signal?: any){
 return new Promise<void>((resolve,reject)=>{
  const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-vf','scale=1600:-2:force_original_aspect_ratio=decrease','-q:v','3',output],{stdio:'ignore'});
  const timer=setTimeout(()=>{try{child.kill('SIGKILL')}catch{}reject(Error('downscale timeout'));},12000);
  const abort=()=>{try{child.kill('SIGKILL')}catch{};reject(Error('cancelled'));};
  signal?.addEventListener('abort',abort,{once:true});
  child.once('error',()=>{clearTimeout(timer);reject(Error('downscale unavailable'));});
  child.once('exit',(code)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);code===0?resolve():reject(Error('downscale failed'));});
 });
}
export async function prepareImage(bytes?: any, mimeType?: any, {signal}: {signal?: any}={}){
 if(!needsDownscale(bytes))return {bytes,mimeType,downscaled:false};
 let dir;
 try{
  dir=await mkdtemp(join(tmpdir(),'anime-prepare-'));
  const ext={ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[mimeType]||'png';
  const input=join(dir,'in.'+ext), output=join(dir,'out.jpg');
  await writeFile(input,Buffer.from(bytes),{mode:0o600});
  await runFfmpeg(input,output,signal);
  const out=await readFile(output);
  if(out.length>=bytes.length)return {bytes,mimeType,downscaled:false};
  return {bytes:new Uint8Array(out),mimeType:'image/jpeg',downscaled:true};
 }catch{return {bytes,mimeType,downscaled:false};}
 finally{if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
