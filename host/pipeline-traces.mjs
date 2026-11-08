/** Indexed source correlation and provider-reported usage; no inferred token counts. */
export function createPipelineTraces({db,record}){
 if(!db)return {link(){},native(){return false;},query(){return {items:[],metrics:{modelResponses:0,reportedTotalTokens:null,usageComplete:false}};}};
 db.exec(`CREATE TABLE IF NOT EXISTS pipeline_links(trace_seq INTEGER,kind TEXT,value TEXT,PRIMARY KEY(trace_seq,kind,value));
 CREATE INDEX IF NOT EXISTS pipeline_lookup ON pipeline_links(kind,value,trace_seq);
 CREATE TABLE IF NOT EXISTS pipeline_usage(id TEXT PRIMARY KEY,trace_seq INTEGER,input_units INTEGER,output_units INTEGER,total_units INTEGER);
 CREATE INDEX IF NOT EXISTS pipeline_usage_trace ON pipeline_usage(trace_seq);`);
 function link(seq,r){
  const insert=db.prepare('INSERT OR IGNORE INTO pipeline_links VALUES(?,?,?)');
  for(const kind of ['eventId','batchId','requestId','ticketId'])for(const value of new Set([r[kind],r.data?.[kind],...(kind==='eventId'&&Array.isArray(r.data?.eventIds)?r.data.eventIds.slice(0,32):[]),...(kind==='batchId'&&Array.isArray(r.data?.batchIds)?r.data.batchIds.slice(0,4):[])]))if(typeof value==='string'&&value.length<=512)insert.run(seq,kind,value);
  db.prepare('DELETE FROM pipeline_links WHERE trace_seq NOT IN (SELECT seq FROM traces)').run();
  db.prepare('DELETE FROM pipeline_usage WHERE trace_seq NOT IN (SELECT seq FROM traces)').run();
 }
 const number=(...values)=>values.find(v=>Number.isSafeInteger(v)&&v>=0)??null;
 function native(sessionId,event,source){
  if(event.type!=='assistant/message')return false;
  const d=event.data||{},suffix=Number.isSafeInteger(event.seq)?`seq:${event.seq}`:Number.isSafeInteger(d.turn)&&Number.isSafeInteger(d.step)?`turn:${d.turn}:step:${d.step}`:null;
  // Without a stable provider/native identity we cannot count a replay safely.
  if(!suffix)return false;
  const id=`${sessionId}:${suffix}`;
  if(db.prepare('SELECT 1 FROM pipeline_usage WHERE id=?').get(id))return true;
  const usage=d.usage||d.message?.usage||{},input=number(usage.inputTokens,usage.promptTokens,usage.input_tokens,usage.prompt_tokens),output=number(usage.outputTokens,usage.completionTokens,usage.output_tokens,usage.completion_tokens);
  const total=number(usage.totalTokens,usage.total_tokens,input!==null&&output!==null?input+output:null);
  const seq=record({...source,sessionId,kind:'model.response',data:{requestId:source.requestId,batchId:source.batchId,batchIds:source.batchIds,ticketId:source.ticketId,eventIds:source.eventIds,nativeSeq:event.seq,inputUnits:input,outputUnits:output,totalUnits:total,usageKnown:total!==null}});
  if(seq!=null)db.prepare('INSERT OR IGNORE INTO pipeline_usage VALUES(?,?,?,?,?)').run(id,seq,input,output,total);
  return false;
 }
 function query(payload={}){
  const clauses=[],args=[];
  for(const field of ['eventId','batchId','requestId','ticketId'])if(typeof payload[field]==='string'&&payload[field]){clauses.push('EXISTS(SELECT 1 FROM pipeline_links l WHERE l.trace_seq=t.seq AND l.kind=? AND l.value=?)');args.push(field,payload[field].slice(0,512));}
  for(const field of ['channel','sessionId'])if(typeof payload[field]==='string'&&payload[field]){clauses.push(`t.${field}=?`);args.push(payload[field].slice(0,512));}
  const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
  const metric=db.prepare(`SELECT COUNT(*) AS modelResponses,COUNT(u.total_units) AS usageKnownResponses,SUM(u.total_units) AS reportedTotalTokens FROM pipeline_usage u JOIN traces t ON t.seq=u.trace_seq ${where}`).get(...args);
  const metrics={...metric,usageComplete:metric.modelResponses>0&&metric.modelResponses===metric.usageKnownResponses};
  if(Number.isSafeInteger(payload.beforeSeq)&&payload.beforeSeq>0){clauses.push('t.seq<?');args.push(payload.beforeSeq);}
  const limit=Math.max(1,Math.min(100,Math.floor(Number(payload.limit)||50)));
  const rows=db.prepare(`SELECT t.* FROM traces t ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY t.seq DESC LIMIT ?`).all(...args,limit+1);
  const more=rows.length>limit;rows.length=Math.min(rows.length,limit);
  const items=rows.map(row=>({...row,data:JSON.parse(row.data)}));
  return {items,nextBeforeSeq:more?items.at(-1)?.seq:null,metrics,retention:'最近保留的追踪记录；响应数仅统计有稳定原生事件 ID 的已完成模型响应。'};
 }
 return {link,native,query};
}
