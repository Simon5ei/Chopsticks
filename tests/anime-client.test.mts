import test from 'node:test';
import assert from 'node:assert/strict';

let searchAnimeImage, DEFAULT_ENGINES;
try { ({ searchAnimeImage, DEFAULT_ENGINES } = await import('../src/image-source/client.mjs') as any); } catch {}
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
const sauce = (url: string = 'https://www.pixiv.net/artworks/123', score: string = '92', title: string = '作品') =>
  `<div class="result"><div class="resultsimilarityinfo">${score}%</div><div class="resulttitle"><strong>${title}</strong></div><a href="${url}">作品</a></div>`;
const iqdb = (url: string = '//danbooru.donmai.us/posts/456', score: string = '88') =>
  `<table><tr><th>Best match</th></tr><tr><td><a href="${url}">作品</a></td></tr><tr><td>${score}% similarity</td></tr></table>`;
const trace = (result: any[] = [{ similarity: .94, anilist: { id: 789, title: { native: '番剧' } }, episode: 2, video: 'https://private.invalid/movie.mp4' }]) => JSON.stringify({ error: '', result });
const response = (body?: any, type: string = 'text/html', status: number = 200) => new Response(body, {status, headers: {'content-type':type}});
const call = (fetchImpl?: any, options: Record<string, any> = {}) => searchAnimeImage(png, 'image/png', {
  fetchImpl,
  engines: ['saucenao','tracemoe','iqdb'],
  lensSearch: async () => [],
  ...options,
});

test('client exists and posts only approved anime forms to fixed endpoints', async () => {
  assert.equal(typeof searchAnimeImage, 'function', 'anime image-source client must be implemented');
  const seen = [];
  const result = await call(async (url?: any, init?: any) => {
    seen.push(url);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.signal.aborted, false);
    assert.ok(init.body instanceof FormData);
    if (url === 'https://saucenao.com/search.php') {
      assert.equal(init.body.get('dbmask'), '2101856');
      assert.notEqual(init.body.get('db'), '999');
      assert.equal(init.body.get('output_type'), '0');
      assert.ok(init.body.get('file') instanceof Blob);
      return response(sauce());
    }
    if (url === 'https://api.trace.moe/search?anilistInfo') {
      assert.ok(init.body.get('image') instanceof Blob);
      return response(trace(), 'application/json');
    }
    assert.equal(url, 'https://iqdb.org/');
    assert.ok(init.body.get('file') instanceof Blob);
    assert.deepEqual(init.body.getAll('service[]'), ['1','2','3','4','5','6']);
    return response(iqdb());
  });
  assert.equal(seen.length, 3);
  assert.equal(result.externalUpload, true);
  assert.deepEqual(result.engines.map((e) => [e.engine,e.status,e.count]), [['saucenao','ok',1],['tracemoe','ok',1],['iqdb','ok',1]]);
  assert.deepEqual(result.matches.map((e) => e.sourceUrl), ['https://pixiv.net/artworks/123','https://anilist.co/anime/789','https://danbooru.donmai.us/posts/456']);
  assert.equal(JSON.stringify(result).includes('movie.mp4'), false);
});

test('rejects unknown, oversized, empty, duplicate, and non-array engine selection before upload', async () => {
  for (const engines of [['google'], ['iqdb','google'], [], ['iqdb','iqdb'], ['saucenao','tracemoe','iqdb','lens','google'], 'iqdb', null]) {
    await assert.rejects(call(() => assert.fail('must not upload'), { engines }), /engine/i);
  }
});

test('lens browser search is a fourth isolated engine and keeps its own list position', async () => {
  const seen = [];
  const r = await searchAnimeImage(png, 'image/png', {
    engines: ['saucenao','lens','iqdb'],
    fetchImpl: async (url?: any) => url.includes('saucenao') ? response(sauce()) : response(iqdb()),
    lensSearch: async (bytes?: any, mime?: any, options?: any) => {
      seen.push({ bytes, mime, options });
      return [{ engine:'lens', similarity:null, title:'Lens work', sourceUrl:'https://pixiv.net/artworks/9', links:['https://pixiv.net/artworks/9'] }];
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].bytes, png);
  assert.equal(seen[0].mime, 'image/png');
  assert.equal(seen[0].options.signal.aborted, false);
  assert.deepEqual(r.engines.map((e?: any) => [e.engine,e.status,e.count]), [['saucenao','ok',1],['lens','ok',1],['iqdb','ok',1]]);
  assert.deepEqual(r.matches.map((m?: any) => m.sourceUrl), ['https://pixiv.net/artworks/123','https://pixiv.net/artworks/9','https://danbooru.donmai.us/posts/456']);
});

test('a failing lens browser search does not hide other engines or leak its message', async () => {
  const r = await searchAnimeImage(png, 'image/png', {
    engines: ['lens','saucenao'],
    fetchImpl: async () => response(sauce()),
    lensSearch: async () => { throw Object.assign(new Error('GOOGLE_CAPTCHA https://private.invalid'), { code:'GOOGLE_CAPTCHA' }); },
  });
  assert.deepEqual(r.engines.map((e?: any) => [e.engine,e.status,e.error]), [['lens','failed','GOOGLE_CAPTCHA'],['saucenao','ok',undefined]]);
  assert.equal(r.matches.length, 1);
  assert.doesNotMatch(JSON.stringify(r), /private|GOOGLE_CAPTCHA https/);
});

// Regression (2026-11-13): IQDB timed out on every recorded run from the server,
// so each default search waited out its full deadline. It stays selectable by
// name but is no longer part of the default set.
test('the default engine set is saucenao, trace.moe and lens; IQDB runs only when named', async () => {
  const seen = [];
  const r = await searchAnimeImage(png, 'image/png', {
    fetchImpl: async (url?: any) => { seen.push(url); return url.includes('trace.moe') ? response(trace(), 'application/json') : response(sauce()); },
    lensSearch: async () => [],
  });
  assert.deepEqual(r.engines.map((e?: any) => e.engine), ['saucenao','tracemoe','lens']);
  assert.deepEqual(DEFAULT_ENGINES, ['saucenao','tracemoe','lens']);
  assert.equal(seen.some((url?: any) => url.includes('iqdb')), false);
  const named = await call(async () => response(iqdb()), { engines: ['iqdb'] });
  assert.deepEqual(named.engines.map((e?: any) => [e.engine, e.status, e.count]), [['iqdb','ok',1]]);
});

// Regression (2026-11-13): a 4.9 MB image timed out on every engine because the
// original bytes were uploaded unchanged; large images are reduced first.
const bigPng = () => { const bytes = new Uint8Array(1024 * 1024 + 1); bytes.set(png); return bytes; };
const smallJpeg = Uint8Array.from([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1]);
const uploads = async (options: Record<string, any> = {}, bytes: any = bigPng()) => {
  const sent = [];
  const result = await searchAnimeImage(bytes, 'image/png', {
    engines: ['saucenao','tracemoe','lens'],
    fetchImpl: async (url?: any, init?: any) => {
      const file = init.body.get(url.includes('trace.moe') ? 'image' : 'file');
      sent.push({ engine: url.includes('trace.moe') ? 'tracemoe' : 'saucenao', size: file.size, type: file.type, name: file.name });
      return url.includes('trace.moe') ? response(trace(), 'application/json') : response(sauce());
    },
    lensSearch: async (lensBytes?: any, mime?: any) => { sent.push({ engine: 'lens', size: lensBytes.length, type: mime }); return []; },
    ...options,
  });
  return { sent, result };
};

test('an image over 1 MiB is reduced once and every engine receives the reduced JPEG', async () => {
  const calls = [];
  const { sent, result } = await uploads({ compress: async (bytes?: any, mime?: any, options?: any) => {
    calls.push({ size: bytes.length, mime, aborted: options.signal.aborted });
    return { bytes: smallJpeg, mimeType: 'image/jpeg' };
  } });
  assert.deepEqual(calls, [{ size: 1024 * 1024 + 1, mime: 'image/png', aborted: false }]);
  assert.equal(sent.length, 3);
  assert.equal(sent.every((s?: any) => s.size === smallJpeg.length && s.type === 'image/jpeg'), true);
  assert.equal(sent.filter((s?: any) => s.name).every((s?: any) => s.name === 'image.jpg'), true);
  assert.deepEqual(result.engines.map((e?: any) => e.status), ['ok','ok','ok']);
});

test('an image of at most 1 MiB is uploaded unchanged without invoking the reducer', async () => {
  const exact = new Uint8Array(1024 * 1024); exact.set(png);
  const { sent } = await uploads({ compress: async () => assert.fail('must not reduce a small image') }, exact);
  assert.equal(sent.every((s?: any) => s.size === 1024 * 1024 && s.type === 'image/png'), true);
});

test('a reducer that fails or returns an unusable result falls back to the original image', async () => {
  const unusable = [
    async () => { throw new Error('ffmpeg missing https://private.invalid'); },
    async () => null,
    async () => ({ bytes: new Uint8Array(16), mimeType: 'image/jpeg' }),
    async () => ({ bytes: smallJpeg, mimeType: 'image/png' }),
    async () => { const bytes = new Uint8Array(1024 * 1024 + 1); bytes.set(smallJpeg); return { bytes, mimeType: 'image/jpeg' }; },
  ];
  for (const compress of unusable) {
    const { sent, result } = await uploads({ compress });
    assert.equal(sent.length, 3);
    assert.equal(sent.every((s?: any) => s.size === 1024 * 1024 + 1 && s.type === 'image/png'), true);
    assert.doesNotMatch(JSON.stringify(result), /private|ffmpeg/);
  }
});

test('cancellation during reduction aborts the search before any upload', async () => {
  const controller = new AbortController();
  const pending = uploads({ signal: controller.signal, compress: async () => { controller.abort(); return null; }, fetchImpl: () => assert.fail('must not upload') });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('rejects invalid image signatures, mismatched MIME, and excessive bytes before upload', async () => {
  const nope = () => assert.fail('must not upload');
  for (const [bytes,mime] of [[png,'image/jpeg'],[new Uint8Array([1,2,3]),'image/png'],[new Uint8Array(8*1024*1024+1),'image/png'],[png,'text/plain'],['path.png','image/png']]) {
    await assert.rejects(searchAnimeImage(bytes,mime,{fetchImpl:nope}), /image|MIME|bytes/i);
  }
  for (const [bytes,mime] of [[Uint8Array.from([255,216,255,224,0,0]),'image/jpeg'],[new TextEncoder().encode('GIF89a00000000'),'image/gif'],[Uint8Array.from([82,73,70,70,4,0,0,0,87,69,66,80,86,80,56,32]),'image/webp']]) {
    const r = await searchAnimeImage(bytes,mime,{engines:['iqdb'],fetchImpl:async()=>response('No relevant matches')});
    assert.equal(r.engines[0].status, 'ok');
  }
});

test('keeps each IQDB result score scoped to its own table and requires a score', async () => {
  const r = await call(async()=>response(iqdb() + iqdb('//yande.re/post/show/99','15') + iqdb('//konachan.com/post/show/33','oops')), {engines:['iqdb']});
  assert.deepEqual(r.matches.map((m) => [m.sourceUrl,m.similarity]), [['https://danbooru.donmai.us/posts/456',.88]]);
});

test('IQDB rejects negative or ambiguous per-table scores instead of assigning false confidence', async () => {
  const html = iqdb('//danbooru.donmai.us/posts/111','-90') + iqdb('//yande.re/post/show/222','88').replace('</table>','<tr><td>20% similarity</td></tr><tr><td><a href="//konachan.com/post/show/333">other result</a></td></tr></table>');
  const r = await call(async()=>response(html), {engines:['iqdb']});
  assert.deepEqual(r.matches, []);
});

test('all approved artwork paths remain usable while tracking and fragment data are removed', async () => {
  const urls = ['https://danbooru.donmai.us/posts/1','https://yande.re/post/show/2','https://konachan.com/post/show/3','https://anilist.co/anime/4','https://myanimelist.net/anime/5','https://anime-pictures.net/posts/6','https://zerochan.net/7','https://e-shuushuu.net/image/8','https://gelbooru.com/index.php?page=post&amp;s=view&amp;id=9'];
  for (const url of urls) {
    const r = await call(async()=>response(sauce(url)), {engines:['saucenao']});
    assert.equal(r.matches[0]?.sourceUrl,url.replaceAll('&amp;','&'));
  }
});

test('rejects social, local, credentials, encoded-path and deceptive domain links', async () => {
  const urls = ['https://twitter.com/a','http://pixiv.net/artworks/1','https://pixiv.net/users/1','https://pixiv.net.evil.org/artworks/1','https://pixiv.net@127.0.0.1/artworks/1','https://pixiv.net:444/artworks/1','file:///etc/passwd','http://localhost/a','https://i.pximg.net/img/a.png','https://pixiv.net/artworks/%31','https://pixiv.net/artworks/1/../users/2','https://anilist.co/user/1'];
  const r = await call(async()=>response(urls.map((url)=>sauce(url)).join('')), {engines:['saucenao']});
  assert.equal(r.engines[0].status, 'ok');
  assert.deepEqual(r.matches, []);
});

test('normalizes allowed artwork URLs, caps titles and total matches, and discards untrusted scores', async () => {
  const html = Array.from({length:12},(_?: any,i?: any)=>sauce(`https://www.pixiv.net/artworks/${100+i}?tracking=x#profile`,'91','a'.repeat(300))).join('') + sauce('https://yande.re/post/show/1','101') + sauce('https://yande.re/post/show/2','59') + sauce('https://yande.re/post/show/3','oops');
  const r = await call(async()=>response(html), {engines:['saucenao']});
  assert.equal(r.matches.length, 8);
  assert.ok(r.matches.every((m)=>m.title.length<=160 && m.similarity===.91 && !m.sourceUrl.includes('?')));
});

test('trace requires a valid result envelope and anime identifiers and high finite score', async () => {
  const r = await call(async()=>response(trace([{similarity:.86,anilist:{id:1}},{similarity:1.1,anilist:{id:2}},{similarity:.9,anilist:{id:'../../user/1'}},{similarity:.9,anilist:{id:3,title:{native:'title'}}}]), 'application/json'), {engines:['tracemoe']});
  assert.deepEqual(r.matches.map((m)=>m.sourceUrl), ['https://anilist.co/anime/3']);
  for (const body of ['{}','{"result":{}}','{"result":[],"error":"private payload"}','not json']) {
    const bad = await call(async()=>response(body,'application/json'), {engines:['tracemoe']});
    assert.equal(bad.engines[0].status,'failed');
    assert.equal(JSON.stringify(bad).includes('private payload'), false);
  }
});

test('upstream failures and upload redirects remain independent and never leak arbitrary upstream text', async () => {
  const r = await call(async(url?: any,init?: any)=>{
    assert.equal(init.redirect,'error');
    if(url.includes('saucenao')) throw new Error('https://private.invalid/secret');
    if(url.includes('trace.moe')) return response(trace(),'application/json');
    return response('SECRET body','text/html',302);
  });
  assert.deepEqual(r.engines.map((e)=>e.status), ['failed','ok','failed']);
  assert.equal(r.matches.length,1);
  assert.doesNotMatch(JSON.stringify(r), /private|SECRET/);
});

test('HTTP errors, challenge pages, invalid formats and oversized streamed bodies explicitly fail', async () => {
  for (const make of [()=>response('secret','text/html',403),()=>response('secret','text/html',500),()=>response('<html>Just a moment... verify you are human</html>'),()=>response('<html>unrelated welcome page</html>'),()=>response(sauce(),'application/json'),()=>new Response(new ReadableStream({start(c?: any){c.enqueue(new Uint8Array(1024*1024+1));c.enqueue(new Uint8Array(1024*1024+1));c.close();}}),{headers:{'content-type':'text/html'}})]) {
    const r = await call(async()=>make(),{engines:['saucenao']});
    assert.equal(r.engines[0].status,'failed');
    assert.equal(r.engines[0].count,0);
    assert.match(r.engines[0].error,/^[A-Z_]+$/);
    assert.deepEqual(r.matches,[]);
  }
});

test('abort propagates during fetch and during a stalled response body', async () => {
  for (const bodyStalls of [false,true]) {
    const controller = new AbortController();
    let started;
    const ready = new Promise<any | void>((resolve)=>{started=resolve;});
    const pending = call(async()=>{
      started();
      return bodyStalls ? new Response(new ReadableStream({start(){}}),{headers:{'content-type':'text/html'}}) : new Promise<any | void>(()=>{});
    },{engines:['iqdb'],signal:controller.signal});
    await ready;
    controller.abort();
    await assert.rejects(pending,{name:'AbortError'});
  }
  const c = new AbortController(); c.abort();
  await assert.rejects(call(()=>assert.fail('must not upload'),{signal:c.signal}),{name:'AbortError'});
});

test('engine deadlines fail bounded requests even if transport ignores cancellation', async (t?: any) => {
  t.mock.timers.enable({apis:['setTimeout']});
  const pending = call(()=>new Promise<any | void>(()=>{}),{engines:['iqdb']});
  t.mock.timers.tick(45_000);
  const result = await pending;
  assert.equal(result.engines[0].status,'failed');
  assert.equal(result.engines[0].error,'TIMEOUT');
});

test('a fast transient transport failure is retried once per engine',async()=>{
 let failures=0;
 const r: any=await call(async (url?: any)=>{
  if(failures<3){failures++;throw new TypeError('fetch failed');}
  return url.includes('saucenao')?response(sauce()):url.includes('trace')?response(trace(),'application/json'):response(iqdb());
 });
 assert.equal(failures,3);assert.deepEqual(r.engines.map((e?: any)=>e.status),['ok','ok','ok']);
});

test('a reset TLS connection is reported as a network failure instead of a generic error',async()=>{
 const r: any=await call(async ()=>{const e=new TypeError('fetch failed');(e as any).cause={code:'ECONNRESET'};throw e;});
 assert.deepEqual(r.engines.map((e?: any)=>e.error),['NETWORK_UNAVAILABLE','NETWORK_UNAVAILABLE','NETWORK_UNAVAILABLE']);
});
