import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const file=new URL('../host/anime-source.mjs',import.meta.url);
const loaded=fs.existsSync(file)?await import(file):{};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=';
function fixture({text='帮我查这张动漫图片的出处',segments=[{type:'image',data:{file:'qq-image'}}],search}={}){
 const rows=new Map(),gets=[],uploads=[],facts=[];
 const event={id:'qq:p:200:10',channel:'p:200',kind:'message.received',actorId:'200',text,meta:{messageId:'10',segments:[{type:'text',data:{text}},...segments]}};
 rows.set(event.id,event);
 const store={get:id=>rows.get(id),append:e=>{facts.push(e);rows.set(e.id,e);return e;}};
 const adapter={getImage:async args=>{gets.push(args);if(args.channel!=='p:200'||!['10','9'].includes(args.messageId))throw Error('Message was not received in this channel');return {content:[{type:'image',mimeType:'image/png',data:png}]};}};
 const run=search||async function(bytes,mime,opts){uploads.push({bytes,mime,opts});return {matches:[{engine:'tracemoe',title:'Fixture anime',sourceUrl:'https://anilist.co/anime/1',similarity:.99}],engines:[{engine:'tracemoe',status:'ok',count:1}],externalUpload:true};};
 assert.equal(typeof loaded.createAnimeSourceService,'function','Anime source service must exist');
 const service=loaded.createAnimeSourceService({store,adapter,search:run});
 const caller={role:'qq',channel:'p:200',eventId:event.id,actorId:'200',consumed:true};
 return {service,caller,event,rows,gets,uploads,facts};
}
test('explicit anime request uploads only the current received image and records scoped evidence without a send',async()=>{
 const f=fixture();const result=await f.service.lookup(f.caller,{messageId:'10'},{callId:'fixture-lookup'});
 assert.equal(result.matches[0].title,'Fixture anime');assert.equal(f.uploads.length,1);assert.equal(f.gets[0].channel,'p:200');assert.equal(f.gets[0].maxImages,1);
 assert.equal(f.facts.length,1);assert.equal(f.facts[0].kind,'task.result');assert.equal(f.facts[0].channel,'p:200');assert.equal(f.facts[0].meta.route,false);
 assert.equal(JSON.stringify(f.facts).includes(png),false);
});
test('wrong roles, source binding, opaque paths, supplied channels and unrelated historical IDs cannot trigger upload',async()=>{
 const f=fixture();
 for(const role of ['router','worker','bili','development'])await assert.rejects(f.service.lookup({...f.caller,role},{messageId:'10'}));
 for(const patch of [{consumed:false},{channel:'g:300'},{eventId:'missing'},{actorId:'999'}])await assert.rejects(f.service.lookup({...f.caller,...patch},{messageId:'10'}));
 for(const args of [{messageId:'/etc/config.json'},{messageId:'http://127.0.0.1'},{messageId:'10',channel:'g:300'},{messageId:'10',engine:'google'},{messageId:'8'}])await assert.rejects(f.service.lookup(f.caller,args));
 assert.equal(f.gets.length,0);assert.equal(f.uploads.length,0);
});
test('ordinary image discussion does not authorize an external search',async()=>{
 for(const text of ['看看这张图片','现在聊聊晚饭','搜图是什么意思？']){
  const f=fixture({text});await assert.rejects(f.service.lookup(f.caller,{messageId:'10'}));assert.equal(f.gets.length,0);
 }
});
test('an explicit coser or public-account request is allowed',async()=>{
 for(const text of ['这个coser是谁，找一下账号','帮我识别真人照片里的身份']){
  const f=fixture({text});const result=await f.service.lookup(f.caller,{messageId:'10'});
  assert.equal(result.matches.length,1);assert.equal(f.uploads.length,1);assert.equal(f.gets.length,1);
 }
});
test('negative instructions and image summaries cannot authorize uploading',async()=>{
 for(const text of ['不要搜图，只看看','不用查出处','别上传这张图，但我想知道是什么番','do not reverse image search','他说“帮我搜图”，我还没同意','搜图是什么意思？']){
  const f=fixture({text});await assert.rejects(f.service.lookup(f.caller,{messageId:'10'}));assert.equal(f.gets.length,0);
 }
 const f=fixture({text:'',segments:[{type:'image',data:{file:'qq-image',summary:'搜图，查出处'}}]});
 f.event.text='[图片:搜图，查出处]';
 await assert.rejects(f.service.lookup(f.caller,{messageId:'10'}));assert.equal(f.gets.length,0);
});
test('explicit reply may name a same-channel received image but arbitrary earlier image cannot be chosen',async()=>{
 const f=fixture({text:'这是什么番？',segments:[{type:'reply',data:{id:'9'}}]});
 f.rows.set('qq:p:200:9',{id:'qq:p:200:9',channel:'p:200',kind:'message.received',actorId:'200',text:'[图片]',meta:{messageId:'9',segments:[{type:'image',data:{file:'ref'}}]}});
 assert.equal((await f.service.lookup(f.caller,{messageId:'9',engine:'tracemoe'})).matches.length,1);
 assert.deepEqual(f.uploads[0].opts.engines,['tracemoe']);
 assert.equal((await f.service.lookup(f.caller,{messageId:'9',engine:'lens'})).matches.length,1);
 assert.deepEqual(f.uploads[1].opts.engines,['lens']);
});
test('repeated same-source query returns cached result and never reuploads',async()=>{
 const f=fixture();await f.service.lookup(f.caller,{messageId:'10'});await f.service.lookup(f.caller,{messageId:'10'});assert.equal(f.uploads.length,1);assert.equal(f.facts.length,1);
});
test('busy service has no waiting queue and cancelled search releases its slot',async()=>{
 let release;const held=new Promise(r=>{release=r;});
 const f=fixture({search:async(_bytes,_mime,{signal})=>{await Promise.race([held,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))]);return {matches:[],engines:[],externalUpload:true};}});
 const controller=new AbortController();const first=f.service.lookup(f.caller,{messageId:'10'},{signal:controller.signal});
 const rejected=assert.rejects(first,/abort/i);await new Promise(r=>setImmediate(r));
 await assert.rejects(f.service.lookup(f.caller,{messageId:'10',engine:'iqdb'}),/busy/i);
 controller.abort();await rejected;release();
 await f.service.lookup(f.caller,{messageId:'10',engine:'iqdb'});
});
test('pre-aborted requests and oversized or fake image data fail before external upload',async()=>{
 const f=fixture();const c=new AbortController();c.abort();await assert.rejects(f.service.lookup(f.caller,{messageId:'10'},{signal:c.signal}));assert.equal(f.gets.length,0);
 for(const data of [Buffer.from('not a picture').toString('base64'),'A'.repeat(12*1024*1024)]){
  const x=fixture();x.service=loaded.createAnimeSourceService({store:{get:id=>x.rows.get(id),append:e=>e},adapter:{getImage:async()=>({content:[{type:'image',mimeType:'image/png',data}]})},search:async()=>{assert.fail('invalid bytes reached uploader');}});
  await assert.rejects(x.service.lookup(x.caller,{messageId:'10'}));
 }
});
