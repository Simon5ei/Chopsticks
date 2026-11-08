import {searchAnimeImage,closeImageSource} from '../image-source/client.mjs';
import {extractAccounts,formatReply} from '../image-source/accounts.mjs';

const allEngines = ['saucenao','tracemoe','iqdb','lens'];
export const commandPrefix = 'qq-anime-command:';

function command(segments) {
  const text = segments.filter(s=>s.type==='text').map(s=>s.data.text).join('').trim();
  return /^\/鱼鱼找鸡(?=\s|$)(.*)$/su.exec(text);
}
function usageFor(engines) {
  return `请引用或附上一张图片，发送 /鱼鱼找鸡。也可指定 ${engines.join('、')}。`;
}
function reasonLabel(code) {
  return ({TIMEOUT:'超时',GOOGLE_CAPTCHA:'需要谷歌验证',GOOGLE_UNREACHABLE:'谷歌连不上',BROWSER_UNAVAILABLE:'浏览器不可用',INVALID_FORMAT:'格式异常',UPSTREAM_BUSY:'上游繁忙'})[code] ?? '失败';
}
function format(result) {
  const candidates = result.matches.map(m=>({
    engine:m.engine,
    title:m.title,
    sourceUrl:m.sourceUrl,
    links:m.links,
    similarity:m.similarity,
    ...(m.authorName ? {authorName:m.authorName} : {}),
  }));
  const accounts = extractAccounts(candidates,{max:3,strictNames:true});
  const enginesUsed = result.engines.filter(e=>e.status==='ok').map(e=>e.engine);
  const failures = result.engines.filter(e=>e.status==='failed').map(e=>({engine:e.engine,reason:reasonLabel(e.error)}));
  return formatReply({accounts,candidates,enginesUsed,failures});
}
function logFailure(stage,error) {
  const reason = String(error?.code || error?.message || error?.name || 'ERROR').replace(/\s+/g,' ').slice(0,120);
  console.error(`[anime-command] ${stage}: ${reason}`);
}
export function createAnimeCommands({state,adapter,search=searchAnimeImage,lens}) {
  const pending = new Set();
  const controller = new AbortController();
  const lensEnabled = lens?.enabled !== false;
  const engines = lensEnabled ? allEngines : allEngines.filter(engine=>engine!=='lens');
  const accepted = new Set(engines);
  const usage = usageFor(engines);
  let busy = false;
  async function execute(event,arg,key) {
    const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]);
    const segments = event.meta.segments;
    const target = segments.find(s=>s.type==='reply')?.data?.id ??
      (segments.some(s=>['image','mface'].includes(s.type)) ? event.meta.messageId : null);
    let answer = usage;
    if ((!arg || accepted.has(arg)) && target != null) {
      let media;
      try { media = await adapter.getImage({channel:event.channel,messageId:String(target),maxImages:1,signal}); }
      catch (error) {
        logFailure('image',error);
        answer = signal.aborted ? '这次搜图超时了，请稍后再试。' : '没取到这张图片。请直接回复原图，或重新发一次图后再试。';
      }
      if (media) {
        try {
          const image = media.content[0];
          const result = await search(Buffer.from(image.data,'base64'),image.mimeType,{engines:arg?[arg]:engines,signal,lens});
          answer = format(result);
        } catch (error) {
          logFailure('search',error);
          answer = signal.aborted ? '这次搜图超时了，请稍后再试。' : '这次没能完成搜图，请稍后再试。';
        }
      }
    }
    if (controller.signal.aborted) return;
    const input = {channel:event.channel,replyTo:event.meta.messageId,text:answer};
    await state.send(key,input,()=>adapter.send({...input,idempotencyKey:key,signal:controller.signal}));
  }
  return {
    accept(event) {
      if(event.kind!=='message.received') return false;
      const match = command(event.meta?.segments || []);
      if(!match) return false;
      const key = commandPrefix+event.id;
      if(state.get('anime-command',key)) return true;
      state.put('anime-command',key,{status:'accepted'});
      if(busy) {
        state.put('anime-command',key,{status:'busy'});
        return true;
      }
      busy=true;
      const work = execute(event,match[1].trim().toLowerCase(),key)
        .then(()=>state.put('anime-command',key,{status:controller.signal.aborted?'interrupted':'finished'}))
        .catch(()=>state.put('anime-command',key,{status:'unconfirmed'}))
        .finally(()=>{busy=false;pending.delete(work);});
      pending.add(work);
      return true;
    },
    async drain(){await Promise.allSettled([...pending]);},
    async close(){controller.abort();await this.drain();await closeImageSource();}
  };
}
