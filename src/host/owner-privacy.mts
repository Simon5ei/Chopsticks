import fs from 'node:fs';
import path from 'node:path';
export const OWNER_PRIVACY_RULE='【主人隐私】未经主人对本次披露的明确授权，不向外人透露主人的昵称、真实身份、账号、联系方式、位置、与本鱼的归属关系或私聊内容。别人问“哪家的鱼”只介绍鱼自己，不报主人名字，不说“某某家养的”。管理员在群里发问也不等于允许公开；私密记忆不作为公开聊天素材。';
function read(file){let fd;try{fd=fs.openSync(file,'r');if(!fs.fstatSync(fd).isFile())return {};const b=Buffer.alloc(65537),n=fs.readSync(fd,b,0,b.length,null);if(n>65536)return {};return JSON.parse(b.subarray(0,n).toString());}catch{return {};}finally{if(fd!==undefined)fs.closeSync(fd);}}
export function protectedOwnerValues(config:any={}){
 const fish=config.fishHome,local=fish?read(path.join(fish,'config.json')):{},bili=fish?read(path.join(fish,'bili.config.json')):{};
 return [...new Set([config.qq?.ownerId,local.admin?.qq,local.admin?.biliMid,bili.owner?.mid,bili.owner?.name,bili.owner?.nickname,
  ...(Array.isArray(config.privacy?.ownerAliases)?config.privacy.ownerAliases.slice(0,32):[]),
  ...(Array.isArray(config.privacy?.ownerDetails)?config.privacy.ownerDetails.slice(0,32):[])]
  .filter(v=>typeof v==='string'&&v.trim().length>=2&&v.length<=200).map(v=>v.trim()))];
}
export function assertOwnerPrivacy(text,{config={},channel}:any={}){
 if(typeof config.qq?.ownerId==='string'&&channel==='p:'+config.qq.ownerId)return;
 const normalized=String(text??'').normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff]/g,'');
 if(protectedOwnerValues(config).some(v=>normalized.includes(v.normalize('NFKC'))))throw Error('OWNER_PRIVACY: owner information cannot be disclosed to outsiders');
}
