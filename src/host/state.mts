import {createHash} from 'node:crypto';
export const hash=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createHostState(store?: any){
 const {db}=store;
 db.exec(`CREATE TABLE IF NOT EXISTS host_kv(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS host_sends(id TEXT PRIMARY KEY,digest TEXT,state TEXT,value TEXT);
 UPDATE host_sends SET state='uncertain' WHERE state='sending';`);
 const get=(kind?: any,id?: any)=>{const row=db.prepare('SELECT value FROM host_kv WHERE kind=? AND id=?').get(kind,id);return row&&JSON.parse(row.value);};
 const put=(kind?: any,id?: any,value?: any)=>db.prepare('INSERT OR REPLACE INTO host_kv VALUES(?,?,?)').run(kind,id,JSON.stringify(value));
 return {get,put,
  list:(kind)=>db.prepare('SELECT id,value FROM host_kv WHERE kind=?').all(kind).map((r)=>({id:r.id,...JSON.parse(r.value)})),
  bind:(id?: any,value?: any)=>put('binding',id,value),binding:(id)=>get('binding',id),
  fresh(id?: any){const binding=get('binding',id);if(!binding)throw Error('Unbound worker');const context=store.context({channel:binding.channel});const changed=context.revision>binding.revision;put('binding',id,{...binding,revision:context.revision});return {changed,...context};},
  read(channel?: any,{unread=false,limit=40}: { unread?: boolean; limit?: number; [key: string]: any }={}){const mark=get('read',channel)||{ack:0,seen:0};let events=store.recent({channel,groups:false,limit});if(unread)events=events.filter((e)=>e.seq>mark.ack);const readThroughSeq=events.at(-1)?.seq||mark.ack;put('read',channel,{...mark,seen:Math.max(mark.seen,readThroughSeq)});return {events,readThroughSeq};},
  markRead(channel?: any,seq?: any){const mark=get('read',channel)||{ack:0,seen:0};if(!Number.isSafeInteger(seq)||seq<0||seq>mark.seen)throw Error('Cannot acknowledge unseen messages');put('read',channel,{...mark,ack:Math.max(mark.ack,seq)});return {readThroughSeq:Math.max(mark.ack,seq)};},
  async send(id?: any,input?: any,perform?: any){
   if(typeof id!=='string'||!id)throw Error('Stable send id required');
   const digest=hash(input),prior=db.prepare('SELECT * FROM host_sends WHERE id=?').get(id);
   if(prior){if(prior.digest!==digest)throw Error('Idempotency payload changed');if(prior.state==='confirmed')return JSON.parse(prior.value);throw Error(prior.state==='not_sent'?'Send not_sent: new deliberate source decision required':'Send uncertain: inspect receipt before deliberate recovery');}
   db.prepare('INSERT INTO host_sends VALUES(?,?,?,?)').run(id,digest,'sending','{}');
   try {const receipt=await perform();db.prepare('UPDATE host_sends SET state=?,value=? WHERE id=?').run('confirmed',JSON.stringify(receipt),id);return receipt;}
   catch(error){const deliveryState=error?.deliveryState==='not_sent'?'not_sent':'uncertain';const diagnostic={deliveryState,...typeof error?.receiptId==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(error.receiptId)?{receiptId:error.receiptId}:{},...typeof error?.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?{code:error.code}:{},...Number.isSafeInteger(error?.apiCode)?{apiCode:error.apiCode}:{},...typeof error?.endpoint==='string'&&/^\/[A-Za-z0-9/_-]{1,160}$/.test(error.endpoint)?{endpoint:error.endpoint}:{}};db.prepare('UPDATE host_sends SET state=?,value=? WHERE id=?').run(deliveryState,JSON.stringify(diagnostic),id);throw error;}
  }
 };
}
