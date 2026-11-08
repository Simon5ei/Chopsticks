import {hash} from './state.mjs';

/** Adapted from xhstoyea/maibot-reminder's scoped tools and proactive intent contract.
 * Scheduling and recovery use the canonical Chopsticks journal, not plugin TOML. */
export function createReminders({store,ingest,isAllowedChannel,now=Date.now,maxPerSource=20}){
 const db=store.db;let closed=false,inflight;
 db.exec(`CREATE TABLE IF NOT EXISTS host_reminders(id TEXT PRIMARY KEY,channel TEXT NOT NULL,actor TEXT NOT NULL,source TEXT NOT NULL,at INTEGER NOT NULL,text TEXT NOT NULL,digest TEXT NOT NULL,status TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS host_reminders_due ON host_reminders(status,at);
 UPDATE host_reminders SET status='pending' WHERE status='emitting';`);
 function owner(caller){
  if(closed)throw Error('Reminders closed');
  const channel=caller?.channel||caller?.chatKey;
  if(caller?.role!=='qq'||!/^[gp]:\d+$/.test(channel)||typeof caller.actorId!=='string'||!isAllowedChannel(channel))throw Error('QQ source permission required');
  return {channel,actor:caller.actorId};
 }
 function schedule(caller,args,callId){
  const {channel,actor}=owner(caller),source=store.get(caller.eventId);
  if(caller.consumed!==true||source?.kind!=='message.received'||source.channel!==channel||source.actorId!==actor)throw Error('Consumed canonical source required');
  if(!args||Object.keys(args).some(k=>!['at','text'].includes(k)))throw Error('Unknown reminder argument or destination');
  if(typeof args.at!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(args.at))throw Error('Reminder timezone is required');
  const calendar=/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(args.at);
  const at=Date.parse(args.at);
  if(!calendar||!Number.isFinite(at)||new Date(Date.UTC(+calendar[1],+calendar[2]-1,+calendar[3])).toISOString().slice(0,10)!==args.at.slice(0,10))throw Error('Invalid reminder date');
  if(typeof args.text!=='string'||!args.text.trim()||args.text.length>1000)throw Error('Invalid reminder text');
  if(typeof callId!=='string'||!callId||callId.length>512)throw Error('Stable reminder call ID required');
  const text=args.text.trim(),id=hash([caller.eventId,callId]),digest=hash({channel,actor,at,text});
  const prior=db.prepare('SELECT * FROM host_reminders WHERE id=?').get(id);
  if(prior){if(prior.digest!==digest)throw Error('Reminder payload changed');return {id,status:prior.status,at:new Date(prior.at).toISOString()};}
  if(at<=now())throw Error('Reminder must be in the future');
  if(db.prepare("SELECT count(*) AS n FROM host_reminders WHERE channel=? AND actor=? AND status='pending'").get(channel,actor).n>=maxPerSource)throw Error('Reminder limit reached');
  db.prepare('INSERT INTO host_reminders VALUES(?,?,?,?,?,?,?,?)').run(id,channel,actor,source.id,at,text,digest,'pending');
  return {id,status:'pending',at:new Date(at).toISOString()};
 }
 function list(caller){const {channel,actor}=owner(caller);return db.prepare("SELECT id,at,text FROM host_reminders WHERE channel=? AND actor=? AND status='pending' ORDER BY at").all(channel,actor).map(r=>({...r,at:new Date(r.at).toISOString()}));}
 function cancel(caller,id){const {channel,actor}=owner(caller),row=db.prepare('SELECT * FROM host_reminders WHERE id=?').get(id);if(!row||row.channel!==channel||row.actor!==actor)throw Error('Reminder source owner mismatch');if(row.status==='fired'||row.status==='emitting'||store.get(`reminder:${id}`))return {cancelled:false,reason:'already_accepted'};db.prepare("UPDATE host_reminders SET status='cancelled' WHERE id=?").run(id);return {cancelled:true};}
 async function deliver(){
  for(const row of db.prepare("SELECT * FROM host_reminders WHERE status='pending' AND at<=? ORDER BY at LIMIT 100").all(now())){
   if(closed)break;
   if(!isAllowedChannel(row.channel)){db.prepare("UPDATE host_reminders SET status='blocked' WHERE id=?").run(row.id);continue;}
   if(!db.prepare("UPDATE host_reminders SET status='emitting' WHERE id=? AND status='pending'").run(row.id).changes)continue;
   // Retry is only a duplicate append of the exact stable event, never a platform send.
   try{
    if(!store.get(`reminder:${row.id}`))await ingest({id:`reminder:${row.id}`,kind:'timer',channel:row.channel,actorId:'reminder',text:`约定的提醒已到期：${row.text}`,meta:{reminderId:row.id,sourceEventId:row.source,requestedBy:row.actor}});
    db.prepare("UPDATE host_reminders SET status='fired' WHERE id=? AND status='emitting'").run(row.id);
   }catch(error){db.prepare("UPDATE host_reminders SET status='pending' WHERE id=? AND status='emitting'").run(row.id);throw error;}
  }
 }
 function tick(){if(closed)return Promise.resolve();if(inflight)return inflight;inflight=deliver().finally(()=>{inflight=undefined;});return inflight;}
 return {schedule,list,cancel,tick,async close(){closed=true;await inflight;}};
}
