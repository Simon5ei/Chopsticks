const MAX_IMAGE = 64 * 1024;
type Sample = {itemId:string;kind:'frames'|'images';data:string;seconds?:number};

export function observationMedia(value: any,itemId: string): Sample|undefined {
 if(typeof itemId!=='string'||!/^\d{6,30}$/.test(itemId)||value?.itemId!==itemId||!['frames','images'].includes(value.kind)||
    typeof value.data!=='string'||value.data.length>Math.ceil(MAX_IMAGE/3)*4||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data))return;
 const bytes=Buffer.from(value.data,'base64');
 if(bytes.length>MAX_IMAGE||bytes.length<4||bytes[0]!==255||bytes[1]!==216||
    bytes.at(-2)!==255||bytes.at(-1)!==217)return;
 if(value.kind==='frames'&&(!Number.isFinite(value.seconds)||value.seconds<0||value.seconds>86400))return;
 return {itemId,kind:value.kind,data:value.data,...value.kind==='frames'?{seconds:value.seconds}:{}};
}

