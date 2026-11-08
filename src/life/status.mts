const states=new Set<any>(['ready','login_required','verification_required','unsupported','error','unknown','degraded','refused']);
const actions=new Set<any>(['feed','detail','comments','search','inbox','notifications','like','comment','reply','publish','dm']);
export const safeCode=(value)=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(value)?value:undefined;
export function platformStatus(input: Record<string, any>={}){
 const output: any={state:states.has(input.state)?input.state:'error'};
 if(typeof input.accountId==='string')output.accountId=input.accountId.slice(0,256);
 if(input.capabilities)output.capabilities=Object.fromEntries(Object.entries(input.capabilities).filter(([k,v])=>actions.has(k)&&typeof v==='boolean'));
 if(safeCode(input.code))output.code=input.code;
 if(states.has(input.authentication?.state))output.authentication={state:input.authentication.state};
 if(input.operations&&typeof input.operations==='object')output.operations=Object.fromEntries(Object.entries<{state: string; code?: string; checkedAt?: number}>(input.operations).filter(([k,v])=>actions.has(k)&&states.has(v?.state)).map(([k,v])=>[k,{state:v.state,...safeCode(v.code)?{code:v.code}:{},...Number.isFinite(v.checkedAt)&&v.checkedAt>=0?{checkedAt:v.checkedAt}:{}}]));
 return output;
}
export function readTarget(platform?: any,args?: any,binding?: any){
 const expected=String(binding.sourceTargetId||binding.targetId||'');let id=args.id;
 if(args.url){
  const u=new URL(args.url);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('Invalid source URL');
  const patterns={heybox:[['www.xiaoheihe.cn','xiaoheihe.cn'],/^\/app\/bbs\/link\/(\d+)\/?$/],douyin:[['www.douyin.com','douyin.com'],/^\/video\/(\d+)\/?$/],bilibili:[['www.bilibili.com','bilibili.com','t.bilibili.com'],/^\/(?:video\/)?(BV[0-9A-Za-z]{10}|\d+)\/?$/]};
  const rule=patterns[platform],match=rule&&rule[0].includes(u.hostname)&&u.pathname.match(rule[1]);
  if(!match||match[1]!==expected||(id&&id!==match[1]))throw Error('URL does not match canonical source');id=match[1];
 }
 if(!id||String(id)!==expected)throw Error('Read target does not match canonical source');return {...args,id};
}
