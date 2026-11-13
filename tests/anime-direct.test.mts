import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnimeCommands} from '../src/host/anime-command.mjs';
const event={id:'qq:g:1:12',kind:'message.received',channel:'g:1',meta:{messageId:'12',segments:[{type:'reply',data:{id:'9'}},{type:'text',data:{text:'/鱼鱼找鸡 tracemoe'}}]}};
function fixture({search,lens,getImage}: { search?: any; lens?: any; getImage?: any; [key: string]: any }={}){
 const saved=new Map(),sent=[],reads=[],calls=[];
 const state={get:(t?: any,k?: any)=>saved.get(t+k),put:(t?: any,k?: any,v?: any)=>saved.set(t+k,v),send:(_k?: any,_v?: any,fn?: any)=>fn()};
 const adapter={getImage:getImage??(async (a?: any) =>{reads.push(a);return {content:[{type:'image',mimeType:'image/png',data:'AQID'}]};}),send:async (a?: any) =>{sent.push(a);return {meta:{messageId:'123'}};}};
 const run=search||(async(_bytes?: any,_mime?: any,opts?: any)=>{calls.push(opts);return {matches:[{title:'TEST',sourceUrl:'https://anilist.co/anime/1',similarity:.99}],engines:[{engine:'tracemoe',status:'ok',count:1}]};});
 const cmds=createAnimeCommands({state,adapter,search:run,lens});
 return {cmds,sent,reads,calls};
}
test('command bypasses agent and uses scoped image reference and durable send only once',async()=>{
 const {cmds,sent,reads}=fixture();assert.equal(cmds.accept(event),true);assert.equal(cmds.accept(event),true);await cmds.drain();
 assert.equal(reads.length,1);assert.equal(reads[0].channel,'g:1');assert.equal(reads[0].messageId,'9');
 assert.equal(sent.length,1);assert.match(sent[0].text,/没查到账号/);assert.equal(sent[0].replyTo,'12');
});
test('ordinary conversation does not match; arbitrary arguments receive usage without uploading',async()=>{
 const {cmds,sent,reads}=fixture();const text=(t)=>({...event,meta:{messageId:'12',segments:[{type:'text',data:{text:t}}]}});
 assert.equal(cmds.accept(text('/搜图')),false);assert.equal(cmds.accept(text('请解释 /鱼鱼找鸡')),false);assert.equal(cmds.accept(text('/鱼鱼找鸡 /etc/passwd')),true);await cmds.drain();
 assert.equal(reads.length,0);assert.equal(sent.length,1);
});
test('lens is an accepted explicit engine and no-account output follows the ported reply',async()=>{
 const {cmds,sent,calls}=fixture({search:async(_b?: any,_m?: any,opts?: any)=>{calls.push(opts);return {matches:[{title:'LENS WORK',sourceUrl:'https://pixiv.net/artworks/1',similarity:null}],engines:[{engine:'lens',status:'ok',count:1}]};}});
 const lensEvent={...event,meta:{messageId:'12',segments:[{type:'reply',data:{id:'9'}},{type:'text',data:{text:'/鱼鱼找鸡 lens'}}]}};
 assert.equal(cmds.accept(lensEvent),true);await cmds.drain();
 assert.deepEqual(calls[0].engines,['lens']);
 assert.match(sent[0].text,/没查到账号/);assert.doesNotMatch(sent[0].text,/NaN|%/);
});
test('disabled lens is refused by the direct command without reading an image',async()=>{
 const {cmds,sent,reads}=fixture({lens:{enabled:false}});
 const lensEvent={...event,meta:{messageId:'12',segments:[{type:'reply',data:{id:'9'}},{type:'text',data:{text:'/鱼鱼找鸡 lens'}}]}};
 assert.equal(cmds.accept(lensEvent),true);await cmds.drain();
 assert.equal(reads.length,0);assert.equal(sent.length,1);assert.doesNotMatch(sent[0].text,/LENS/);
});
test('an image that cannot be fetched gets an actionable message instead of a generic failure',async()=>{
 const {cmds,sent}=fixture({getImage:async()=>{throw Object.assign(new Error('Message was not actually received in this channel'),{code:'NOT_RECEIVED'});}});
 assert.equal(cmds.accept(event),true);await cmds.drain();
 assert.equal(sent.length,1);assert.match(sent[0].text,/没取到这张图片/);
});
test('a failing search is reported separately from image retrieval',async()=>{
 const {cmds,sent}=fixture({search:async()=>{throw new Error('boom');}});
 assert.equal(cmds.accept(event),true);await cmds.drain();
 assert.equal(sent.length,1);assert.match(sent[0].text,/没能完成搜图/);
});
test('source account reply layout is used for a twitter candidate',async()=>{
 const {cmds,sent}=fixture({search:async()=>({matches:[{engine:'lens',title:'XSuSu on X: "hi"',sourceUrl:'https://x.com/susu/status/1',links:['https://x.com/susu/status/1'],similarity:null}],engines:[{engine:'lens',status:'ok',count:1}]})});
 assert.equal(cmds.accept(event),true);await cmds.drain();
 const text=sent[0].text;
 assert.match(text,/🎯 \*\*鱼鱼找鸡结果\*\*/);assert.match(text,/🌐 平台：Twitter/);assert.match(text,/👤 名字：SuSu/);assert.match(text,/🆔 账号：@susu · https:\/\/x\.com\/susu/);
});
test('the bare command searches the default engines without IQDB, which stays selectable by name',async()=>{
 const bare={...event,meta:{messageId:'12',segments:[{type:'reply',data:{id:'9'}},{type:'text',data:{text:'/鱼鱼找鸡'}}]}};
 const first=fixture();assert.equal(first.cmds.accept(bare),true);await first.cmds.drain();
 assert.deepEqual(first.calls[0].engines,['saucenao','tracemoe','lens']);
 const noLens=fixture({lens:{enabled:false}});assert.equal(noLens.cmds.accept(bare),true);await noLens.cmds.drain();
 assert.deepEqual(noLens.calls[0].engines,['saucenao','tracemoe']);
 const named=fixture();const iqdbEvent={...event,meta:{messageId:'12',segments:[{type:'reply',data:{id:'9'}},{type:'text',data:{text:'/鱼鱼找鸡 iqdb'}}]}};
 assert.equal(named.cmds.accept(iqdbEvent),true);await named.cmds.drain();
 assert.deepEqual(named.calls[0].engines,['iqdb']);assert.equal(named.reads.length,1);
});
