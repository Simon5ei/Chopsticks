import {parseSaucenao, parseIqdb, parseTracemoe} from './parsers.mjs';
import {searchLens, closeLensBrowser, lensFailureCode} from './lens.mjs';
import {needsDownscale, prepareImage} from './prepare.mjs';

const ENDPOINTS = Object.freeze({
  saucenao: 'https://saucenao.com/search.php',
  tracemoe: 'https://api.trace.moe/search?anilistInfo',
  iqdb: 'https://iqdb.org/',
});
const ENGINES = Object.freeze(['saucenao','tracemoe','iqdb','lens']);
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const abortError = () => new DOMException('Image search cancelled', 'AbortError');
class Failure extends Error {
declare code: any;
 constructor(code?: any) { super(code); this.code = code; } }

function validateImage(bytes?: any, mimeType?: any) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_IMAGE) throw new TypeError('Invalid image bytes');
  const starts = (values) => values.every((value?: any, i?: any) => bytes[i] === value);
  const valid = {
    'image/png': () => bytes.length >= 16 && starts([137,80,78,71,13,10,26,10]),
    'image/jpeg': () => bytes.length >= 4 && starts([255,216,255]) && bytes[3] !== 0,
    'image/gif': () => bytes.length >= 13 && (starts([71,73,70,56,55,97]) || starts([71,73,70,56,57,97])),
    'image/webp': () => bytes.length >= 16 && starts([82,73,70,70]) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80 && bytes[12] === 86 && bytes[13] === 80 && bytes[14] === 56 && [32,76,88].includes(bytes[15]),
  };
  if (!Object.hasOwn(valid, mimeType) || !valid[mimeType]()) throw new TypeError('Unsupported image signature or MIME');
}

function uploadForm(engine?: any, bytes?: any, mimeType?: any) {
  const form = new FormData();
  const ext = {'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'}[mimeType];
  form.append(engine === 'tracemoe' ? 'image' : 'file', new Blob([bytes], {type: mimeType}), `image.${ext}`);
  if (engine === 'saucenao') {
    // Pixiv 5/6, Danbooru 9, Yandere 12, Anime 21 only; never all-library db=999.
    form.append('dbmask', [5n,6n,9n,12n,21n].reduce((mask?: any, index?: any) => mask | (1n << index), 0n).toString());
    form.append('output_type', '0');
  }
  if (engine === 'iqdb') for (const id of [1,2,3,4,5,6]) form.append('service[]', String(id));
  return form;
}

async function readBounded(response?: any, signal?: any) {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE)) {
    void response.body?.cancel().catch(() => {});
    throw new Failure('RESPONSE_TOO_LARGE');
  }
  if (!response.body) throw new Failure('INVALID_FORMAT');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once:true});
  let size = 0;
  const chunks = [];
  try {
    if (signal.aborted) throw new Failure('TIMEOUT');
    for (;;) {
      const {value,done} = await reader.read();
      if (signal.aborted) throw new Failure('TIMEOUT');
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) { cancel(); throw new Failure('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', {fatal:true}).decode(all);
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

async function request(engine?: any, bytes?: any, mimeType?: any, fetchImpl?: any, signal?: any) {
  let response;
  try{
   response = await fetchImpl(ENDPOINTS[engine], {
    method:'POST', body:uploadForm(engine,bytes,mimeType), redirect:'error', signal,
    headers:{Accept:engine === 'tracemoe' ? 'application/json' : 'text/html'},
  });
  }catch(error){const cause=String(error?.cause?.code||'');if(/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR/i.test(cause))throw new Failure('NETWORK_UNAVAILABLE');throw error;}
  if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Failure('TIMEOUT'); }
  if (!response.ok || response.redirected || (response.url && response.url !== ENDPOINTS[engine])) {
    void response.body?.cancel().catch(() => {});
    throw new Failure('HTTP_ERROR');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!(engine === 'tracemoe' ? /^application\/json(?:;|$)/i : /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i).test(contentType)) {
    void response.body?.cancel().catch(() => {});
    throw new Failure('INVALID_FORMAT');
  }
  const body = await readBounded(response, signal);
  if (/captcha|verify (?:you are|you're) human|Just a moment|cf-chl-|challenge-platform|access denied/i.test(body)) throw new Failure('UPSTREAM_CHALLENGE');
  try {
    return engine === 'tracemoe' ? parseTracemoe(JSON.parse(body)) : engine === 'saucenao' ? parseSaucenao(body) : parseIqdb(body);
  } catch (error) {
    throw new Failure(error.message === 'UPSTREAM_BUSY' ? 'UPSTREAM_BUSY' : 'INVALID_FORMAT');
  }
}

// A fast transport failure is usually a transient DNS/TLS hiccup; one bounded
// retry keeps the search usable. Slow failures (timeouts) are never retried.
async function requestWithRetry(engine?: any,bytes?: any,mimeType?: any,fetchImpl?: any,signal?: any){
 const started=Date.now();
 try{return await request(engine,bytes,mimeType,fetchImpl,signal);}
 catch(error){const code=error instanceof Failure?error.code:'REQUEST_FAILED';
  if(signal?.aborted||!['REQUEST_FAILED','NETWORK_UNAVAILABLE'].includes(code)||Date.now()-started>5000)throw error instanceof Failure?error:new Failure('REQUEST_FAILED');
  return request(engine,bytes,mimeType,fetchImpl,signal);}
}
async function oneEngine(engine: any, bytes: any, mimeType: any, fetchImpl: any, parentSignal: any, userSignal: any, {lensSearch, lens}: { lensSearch?: any; lens?: any; [key: string]: any }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, {once:true});
  if (parentSignal.aborted) abort();
  // iqdb uploads are consistently slower than the other engines; give it its own
  // budget instead of making every engine wait for the slowest.
  const DEADLINES: Record<string, number> = {saucenao:30_000,tracemoe:30_000,iqdb:45_000,lens:40_000};
  const deadline = DEADLINES[engine] ?? 30_000;
  const timer = setTimeout(abort, deadline);
  let onAbort;
  const cancelled = new Promise<any | void>((_?: any,reject?: any) => {
    onAbort = () => reject(new Failure('TIMEOUT'));
    controller.signal.addEventListener('abort', onAbort, {once:true});
    if (controller.signal.aborted) onAbort();
  });
  try {
    const matches = await Promise.race([
      engine === 'lens'
        ? lensSearch(bytes, mimeType, {...lens, signal: controller.signal, timeoutMs: Math.min(deadline - 1000, lens?.timeoutMs ?? 40_000)})
        : requestWithRetry(engine,bytes,mimeType,fetchImpl,controller.signal),
      cancelled,
    ]);
    return {matches, summary:{engine,status:'ok',count:matches.length}};
  } catch (error) {
    if (userSignal?.aborted) throw abortError();
    const code = engine === 'lens' ? lensFailureCode(error) : error instanceof Failure ? error.code : 'REQUEST_FAILED';
    return {matches:[], summary:{engine,status:'failed',count:0,error:code}};
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort',abort);
    controller.signal.removeEventListener('abort',onAbort);
  }
}

/** Upload an explicitly selected illustration/anime image to the selected fixed engines. */
export async function searchAnimeImage(bytes?: any, mimeType?: any, {engines=['saucenao','tracemoe','iqdb','lens'], signal, fetchImpl=globalThis.fetch, lensSearch=searchLens, lens={}}: { engines?: any[]; signal?: any; fetchImpl?: any; lensSearch?: any; lens?: Record<string, any>; [key: string]: any } = {}) {
  if (needsDownscale(bytes)) { const prepared = await prepareImage(bytes, mimeType, {signal}); bytes = prepared.bytes; mimeType = prepared.mimeType; }
  validateImage(bytes,mimeType);
  if (!Array.isArray(engines) || !engines.length || engines.length > 4 || new Set<any>(engines).size !== engines.length || engines.some((engine) => typeof engine !== 'string' || !ENGINES.includes(engine))) throw new TypeError('Invalid anime engine selection');
  if (typeof fetchImpl !== 'function') throw new TypeError('Invalid fetch implementation');
  if (typeof lensSearch !== 'function') throw new TypeError('Invalid lens search implementation');
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(abort,60_000);
  try {
    const results = await Promise.all(engines.map((engine) => oneEngine(engine,bytes,mimeType,fetchImpl,controller.signal,signal,{lensSearch,lens})));
    if (signal?.aborted) throw abortError();
    const matches = [];
    const seen = new Set<any>();
    for (const result of results) for (const match of result.matches) {
      if (matches.length === 8) break;
      if (seen.has(match.sourceUrl)) continue;
      seen.add(match.sourceUrl);
      matches.push(match);
    }
    return {matches,engines:results.map((result) => ({...result.summary, count:matches.filter((match) => match.engine === result.summary.engine).length})),externalUpload:true};
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',abort);
  }
}

/** Release the singleton Lens browser during host shutdown. */
export async function closeImageSource() { await closeLensBrowser(); }
