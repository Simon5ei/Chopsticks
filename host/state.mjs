import {createHash} from 'node:crypto';
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createHostState(store){
 const {db}=store;
 db.exec(`CREATE TABLE IF NOT EXISTS host_kv(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS host_sends(id TEXT PRIMARY KEY,digest TEXT,state TEXT,value TEXT);
 UPDATE host_sends SET state='uncertain' WHERE state='sending';`);
 const get=(kind,id)=>{const row=db.prepare('SELECT value FROM host_kv WHERE kind=? AND id=?').get(kind,id);return row&&JSON.parse(row.value);};
 const put=(kind,id,value)=>db.prepare('INSERT OR REPLACE INTO host_kv VALUES(?,?,?)').run(kind,id,JSON.stringify(value));
 return {get,put,
  list:kind=>db.prepare('SELECT id,value FROM host_kv WHERE kind=?').all(kind).map(r=>({id:r.id,...JSON.parse(r.value)})),
  bind:(id,value)=>put('binding',id,value),binding:id=>get('binding',id),
  fresh(id){const binding=get('binding',id);if(!binding)throw Error('Unbound worker');const context=store.context({channel:binding.channel});const changed=context.revision>binding.revision;put('binding',id,{...binding,revision:context.revision});return {changed,...context};},
  read(channel,{unread=false,limit=40}={}){const mark=get('read',channel)||{ack:0,seen:0};let events=store.recent({channel,groups:false,limit});if(unread)events=events.filter(e=>e.seq>mark.ack);const readThroughSeq=events.at(-1)?.seq||mark.ack;put('read',channel,{...mark,seen:Math.max(mark.seen,readThroughSeq)});return {events,readThroughSeq};},
  markRead(channel,seq){const mark=get('read',channel)||{ack:0,seen:0};if(!Number.isSafeInteger(seq)||seq<0||seq>mark.seen)throw Error('Cannot acknowledge unseen messages');put('read',channel,{...mark,ack:Math.max(mark.ack,seq)});return {readThroughSeq:Math.max(mark.ack,seq)};},
  async send(id,input,perform){
   if(typeof id!=='string'||!id)throw Error('Stable send id required');
   const digest=hash(input),prior=db.prepare('SELECT * FROM host_sends WHERE id=?').get(id);
   if(prior){if(prior.digest!==digest)throw Error('Idempotency payload changed');if(prior.state==='confirmed')return JSON.parse(prior.value);throw Error('Send uncertain: inspect receipt before deliberate recovery');}
   db.prepare('INSERT INTO host_sends VALUES(?,?,?,?)').run(id,digest,'sending','{}');
   try {const receipt=await perform();db.prepare('UPDATE host_sends SET state=?,value=? WHERE id=?').run('confirmed',JSON.stringify(receipt),id);return receipt;}
   catch(error){db.prepare('UPDATE host_sends SET state=? WHERE id=?').run('uncertain',id);throw error;}
  }
 };
}
