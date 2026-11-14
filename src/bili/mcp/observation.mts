import fs from 'node:fs/promises';
import path from 'node:path';

type Cue = {from:number;content:string};
const isCue = (cue: any): cue is Cue => Number.isFinite(cue?.from)&&cue.from>=0&&
 typeof cue.content==='string'&&cue.content.trim().length>0;
const timestamp = (seconds:number) => [Math.floor(seconds/60),Math.floor(seconds%60)].map(n=>String(n).padStart(2,'0')).join(':');

export async function subtitleSample(files:string[],bvid:string,lines:number) {
 const file=files.find(file=>new RegExp('^'+bvid+'-[A-Za-z0-9-]{2,20}\\.json$').test(path.basename(file)));
 if(!file||(await fs.stat(file)).size>512*1024)return null;
 try {
  const {body}=JSON.parse(await fs.readFile(file,'utf8'));
  if(!Array.isArray(body))return null;
  const cues=body.slice(0,Math.min(lines,200)).filter(isCue);
  if(!cues.length)return null;
  return cues.map(cue=>`[${timestamp(cue.from)}] ${cue.content.slice(0,320)}`).join('\n').slice(0,6000);
 }catch{return null;}
}

export async function frameSample(files:string[],bvid:string) {
 const file=files.find(file=>path.basename(file)==='observation-frames.json');
 if(file&&(await fs.stat(file)).size<=2048){
  try{
   const value=JSON.parse(await fs.readFile(file,'utf8'));
   if(value.bvid===bvid&&Array.isArray(value.seconds)&&value.seconds.length===4&&
      value.seconds.every(seconds=>Number.isFinite(seconds)&&seconds>=0&&seconds<=180)){
    return value.seconds.map(timestamp).join('、');
   }
  }catch{}
 }
 return '已收到视频画面样本，未取得采样时间。';
}

