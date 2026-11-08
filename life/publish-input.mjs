import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export function publishInput(args,config){
 const out={};
 if(args.title!==undefined){if(typeof args.title!=='string'||args.title.length>100)throw Error('Invalid title');out.title=args.title;}
 if(args.format!==undefined){if(!['image','article'].includes(args.format))throw Error('Invalid publish format');out.format=args.format;}
 const roots=(config.life?.mediaRoots||[path.join(config.stateDir,'media'),...(config.fishHome?[path.join(config.fishHome,'media')]:[])]).filter(p=>fs.existsSync(p)).map(p=>fs.realpathSync(p));
 function admit(file){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('Absolute media path required');
  const real=fs.realpathSync(file);if(!roots.some(root=>{const rel=path.relative(root,real);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);}))throw Error('Media path is outside publish media roots');
  const stat=fs.statSync(real);if(!stat.isFile()||stat.size<8||stat.size>100*1024*1024)throw Error('Invalid media file');
  const content=fs.readFileSync(real),head=content.subarray(0,16),type=head.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':head[0]===255&&head[1]===216?'image/jpeg':head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP'?'image/webp':null;
  if(!type)throw Error('Unsupported media bytes');return {path:real,mimeType:type,sha256:createHash('sha256').update(content).digest('hex')};
 }
 if(args.media!==undefined){if(!Array.isArray(args.media)||args.media.length<1||args.media.length>35)throw Error('Invalid media list');out.media=args.media.map(m=>admit(m?.path));}
 if(args.coverPath!==undefined){const cover=admit(args.coverPath);if(!cover.mimeType.startsWith('image/'))throw Error('Cover must be an image');out.coverPath=cover.path;out.coverSha256=cover.sha256;}
 return out;
}
