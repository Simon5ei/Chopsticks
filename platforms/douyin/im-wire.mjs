// Bounded, read-only protobuf decoder. Field conventions: yunsur/douyin-mcp
// 7e90d139007f141cb7389aa509d8e6e67f7b5840 (MIT), checked against Douyin's
// currently served PC IM schema. Never constructs authentication or signatures.
export function wire(input) {
  if(!(input instanceof Uint8Array)||input.length>8*1024*1024)throw Error('invalid protobuf');
  const b=Buffer.from(input),m=new Map();let i=0,count=0;
  function integer(){let n=0n;for(let s=0n;s<70n;s+=7n){if(i>=b.length)throw Error('truncated protobuf');const v=b[i++];n|=BigInt(v&127)<<s;if(!(v&128))return n;}throw Error('oversized integer');}
  while(i<b.length){if(++count>100000)throw Error('oversized protobuf');const tag=Number(integer()),f=tag>>>3,w=tag&7;let value;if(!f)throw Error('invalid field');if(w===0)value=integer().toString();else if(w===2){const length=Number(integer());if(!Number.isSafeInteger(length)||length<0||i+length>b.length)throw Error('truncated protobuf');value=b.subarray(i,i+length);i+=length;}else if(w===1||w===5){i+=w===1?8:4;if(i>b.length)throw Error('truncated protobuf');continue;}else throw Error('unsupported protobuf');m.set(f,[...(m.get(f)||[]),value]);}
  return m;
}
const one=(m,k)=>m.get(k)?.[0];
const num=(m,k)=>typeof one(m,k)==='string'?one(m,k):'0';
const str=(m,k)=>Buffer.isBuffer(one(m,k))?one(m,k).toString('utf8'):'';
const sub=(m,k)=>{const b=one(m,k);if(!Buffer.isBuffer(b))throw Error('missing message');return wire(b);};
const many=(m,k)=>(m.get(k)||[]).filter(Buffer.isBuffer).map(wire);
function content(m,k){try{return JSON.parse(str(m,k))?.text||'';}catch{return '';}}
export function decodeImRequest(input){const e=wire(input);if(num(e,1)!=='100')throw Error('unexpected request');const b=sub(sub(e,8),100);return {conversationId:str(b,1),conversationType:Number(num(b,2)),clientMessageId:str(b,8),text:content(b,4)};}
export function decodeImResponse(input){const e=wire(input);if(num(e,1)!=='100')throw Error('unexpected response');const b=sub(sub(e,6),100);return {cmd:100,status:Number(num(e,3))||Number(num(b,3)),serverMessageId:num(b,1),clientMessageId:str(b,4),checkCode:num(b,5)};}
export function platformTime(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)return undefined;return Math.floor(n<100000000000?n*1000:n>=100000000000000?n/1000:n);}
function message(m){return {conversationId:str(m,1),conversationType:Number(num(m,2)),serverMessageId:num(m,3),sender:num(m,7),text:content(m,8),secUid:str(m,14),at:platformTime(num(m,10))};}
export function decodeInbox(input){
  try{const e=wire(input),cmd=Number(num(e,1));if(num(e,3)!=='0')return {items:[],incomplete:true};const b=sub(sub(e,6),cmd);let messages=[],hasMore=false;
    if(cmd===2043){for(const c of many(b,1))messages.push(...many(c,2));hasMore=num(b,2)!=='0';}
    else if(cmd===2048){const recent=sub(b,1);for(const c of many(recent,2))messages.push(...many(c,2));hasMore=num(recent,3)!=='0';}
    else if(cmd===301||cmd===200||cmd===203){messages=many(b,1);hasMore=num(b,cmd===203?5:3)!=='0';}
    else return {items:[],incomplete:true};
    return {items:messages.filter(m=>num(m,6)==='7'&&num(m,12)==='0').map(message).filter(m=>m.text),hasMore,incomplete:false};
  }catch{return {items:[],incomplete:true};}
}
