// Google Lens reverse-image search through a headless Chrome driven over CDP.
// Browser automation and the Lens extraction idea are adapted from
// coser-image-search 1.0.0 (Copyright (c) 2026 小鲸鱼, MIT); see
// ../notices/image-source-MIT-LICENSE and PROVENANCE.json. Only the fixed
// Google upload/result flow and artwork/anime link extraction are kept.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {socialNameFromTitle} from './accounts.mjs';

const MAX_TITLE = 160;
const IDLE_MS = 120_000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const BROWSER_CANDIDATES = [
  '/opt/chrome/chrome-linux64/chrome',
  '/opt/chrome-headless/chrome-headless-shell-linux64/chrome-headless-shell',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const ARTWORK_CARD_RE = /pixiv|danbooru|yande|anilist|myanimelist|anime|zerochan|gelbooru|konachan|shuushuu/i;
const SOCIAL_CARD_RE = /^(?:x|twitter|推特|instagram|ig|ins|微博|weibo|bilibili|哔哩|tiktok|抖音|facebook|fb|threads|xiaohongshu|小红书)\b|\bon\s+(?:x|twitter|instagram|tiktok|facebook|threads|微博|bilibili|小红书)\b/i;
const LENS_SOCIAL_URL_RE = /^https?:\/\/(?:www\.|m\.)?(?:x|twitter|instagram|weibo|bilibili|tiktok|facebook|threads|xiaohongshu)\.(?:com|net)\//i;

// Fixed flow only: the browser opens Google's own pages and submits the image
// to Lens. No caller-supplied URL ever reaches the browser.
const LENS_START = 'https://www.google.com/';
const LENS_UPLOAD = 'https://lens.google.com/v3/upload?hl=';
const LENS_WAIT = '(document.body && (/unusual traffic|our systems have detected/i.test(document.body.innerText) || /\\/sorry\\//.test(location.href)) ? "captcha" : (document.body && document.body.innerText.length > 400 && document.querySelectorAll("a[href]").length > 25 ? "ready" : ""))';

const LENS_EXTRACT = `(() => {
  const isGoogle = (host) => /(^|\\.)google\\.[a-z.]+$/i.test(host);
  const isAsset = (host) => /(^|\\.)(gstatic|googleusercontent)\\.com$/i.test(host);
  const cleanTitle = (node) => {
    const heading = node.querySelector('h1,h2,h3,[role=heading]');
    const text = String(
      (heading && heading.textContent) ||
      node.getAttribute('aria-label') ||
      node.textContent || ''
    ).replace(/\\s+/g, ' ').trim();
    return text.slice(0, 200);
  };
  const rows = [];
  const cards = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    if (a.closest('header, footer, nav, [role=navigation]')) continue;
    const raw = a.getAttribute('href') || '';
    let u;
    try { u = new URL(raw, location.href); } catch (e) { continue; }
    if (u.protocol !== 'https:') continue;
    const title = cleanTitle(a);
    if (!title) continue;
    if (isGoogle(u.hostname) && u.pathname === '/goto' && u.searchParams.get('url')) {
      if (cards.length < 24) cards.push({ wrapper: u.href, title });
      continue;
    }
    if (isGoogle(u.hostname) || isAsset(u.hostname)) {
      const wrapped = u.searchParams.get('url') || u.searchParams.get('q') || '';
      if (!/^https?:\\/\\//.test(wrapped) || seen.has(wrapped)) continue;
      seen.add(wrapped);
      rows.push({ url: wrapped, title });
      continue;
    }
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    rows.push({ url: u.href, title });
  }
  const bodyText = document.body ? document.body.innerText.slice(0, 4000) : '';
  return JSON.stringify({
    url: location.href,
    cards: cards,
    results: rows,
    links: document.querySelectorAll('a[href]').length,
    snippet: bodyText.slice(0, 500),
    captcha: /unusual traffic|our systems have detected/i.test(bodyText) || /\\/sorry\\//.test(location.href),
    empty: /No matches|No results|找不到相符|没有找到|未找到/i.test(bodyText)
  });
})()`;

const sleep = (ms) => new Promise<any | void>((resolve) => { setTimeout(resolve, ms); });
const abortError = () => new DOMException('Image search cancelled', 'AbortError');
function failure(code?: any) { const error: any = new Error(code); error.code = code; return error; }
let trace: (...args: unknown[]) => void = () => {};

export function resolveBrowser(explicit?: any, env: any = process.env) {
  const candidates = [explicit, env.CHOPSTICKS_CHROME, ...BROWSER_CANDIDATES].filter((value) => typeof value === 'string' && value);
  for (const candidate of candidates) { try { if (fs.statSync(candidate).isFile()) return candidate; } catch {} }
  return '';
}

export function lensFailureCode(error?: any) {
  const code = String(error?.code ?? '');
  if (/^(?:GOOGLE_CAPTCHA|GOOGLE_UNREACHABLE|BROWSER_UNAVAILABLE|NO_BROWSER|TIMEOUT|INVALID_FORMAT|REQUEST_FAILED)$/.test(code)) return code === 'NO_BROWSER' ? 'BROWSER_UNAVAILABLE' : code;
  const text = `${code} ${String(error?.message ?? '')}`;
  if (/GOOGLE_CAPTCHA|captcha|unusual traffic|our systems have detected|\/sorry\//i.test(text)) return 'GOOGLE_CAPTCHA';
  if (/BROWSER_UNAVAILABLE|NO_BROWSER|ENOENT|找不到.*(?:Chrome|Chromium|浏览器)|executable|DevToolsActivePort/i.test(text)) return 'BROWSER_UNAVAILABLE';
  if (/GOOGLE_UNREACHABLE|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|ERR_PROXY|ERR_TIMED_OUT|ERR_ABORTED|ERR_INTERNET/i.test(text)) return 'GOOGLE_UNREACHABLE';
  if (/TIMEOUT|CDP 超时|超时/i.test(text)) return 'TIMEOUT';
  return 'REQUEST_FAILED';
}

// Google's own sites and the hosts that only serve its scripts, thumbnails and
// telemetry. Neither is ever the page an image came from.
const GOOGLE_HOST_RE = /(?:^|\.)google\.(?:com|[a-z]{2,3}|com?\.[a-z]{2})$/i;
const GOOGLE_ASSET_HOST_RE = /(?:^|\.)(?:gstatic\.com|googleusercontent\.com|googleapis\.com|ggpht\.com|google-analytics\.com|googletagmanager\.com|googlesyndication\.com|googleadservices\.com|doubleclick\.net)$/i;

/**
 * Decide what a request paused while resolving a Lens /goto card means.
 * `continue`: Google's own navigation, let it proceed. `target`: the top-level
 * navigation to the result site (never loaded, only its URL is kept). `miss`:
 * anything else — a /goto page that renders Google UI requests gstatic scripts
 * first, and those used to be reported as the image source.
 */
export function gotoRequestAction({url, resourceType}: { url?: any; resourceType?: any; [key: string]: any } = {}) {
  let host;
  try {
    const parsed = new URL(String(url ?? ''));
    if (!/^https?:$/.test(parsed.protocol)) return 'continue';
    host = parsed.hostname;
  } catch { return 'continue'; }
  if (GOOGLE_HOST_RE.test(host)) return 'continue';
  if (GOOGLE_ASSET_HOST_RE.test(host)) return 'miss';
  return resourceType == null || resourceType === 'Document' ? 'target' : 'miss';
}

function safeCandidateUrl(raw?: any) {
  try {
    const url = new URL(String(raw ?? ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (GOOGLE_HOST_RE.test(url.hostname) || GOOGLE_ASSET_HOST_RE.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function mapLensRows(rows?: any, {max = 8}: { max?: number; [key: string]: any } = {}) {
  const out = [];
  const seen = new Set<any>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const sourceUrl = safeCandidateUrl(row?.url);
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const title = String(row?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    const authorName = socialNameFromTitle(title);
    out.push({
      engine: 'lens',
      similarity: null,
      title,
      sourceUrl,
      links: [sourceUrl],
      ...(authorName ? {authorName} : {}),
    });
    if (out.length === max) break;
  }
  return out;
}

// ── singleton headless browser ───────────────────────────────────────────────
let browser = null;
let starting = null;
let idleTimer = null;

function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { void closeLensBrowser(); }, IDLE_MS);
  idleTimer.unref?.();
}

function waitForFile(file?: any, timeoutMs?: any) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      try {
        const text = fs.readFileSync(file, 'utf8').trim();
        if (text) return text;
      } catch {}
      await sleep(120);
    }
    throw failure('BROWSER_UNAVAILABLE');
  })();
}

function parseCdpMessage(event?: any) {
  try { return JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch { return null; }
}

async function startBrowser({exe, profileDir, proxy, doh, timeoutMs = 25_000}: { exe?: any; profileDir?: any; proxy?: any; doh?: any; timeoutMs?: number; [key: string]: any }) {
  const executable = resolveBrowser(exe);
  if (!executable) throw failure('NO_BROWSER');
  fs.mkdirSync(profileDir, {recursive: true, mode: 0o700});
  try { fs.rmSync(path.join(profileDir, 'DevToolsActivePort'), {force: true}); } catch {}
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=Translate,MediaRouter',
    ...(doh ? ['--enable-features=DnsOverHttps', '--dns-over-https-mode=secure', `--dns-over-https-templates=${doh}`] : []),
    '--lang=zh-CN',
    `--user-agent=${BROWSER_UA}`,
    ...(proxy ? [`--proxy-server=${String(proxy)}`] : []),
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    ...(process.getuid?.() === 0 ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    'about:blank',
  ];
  const proc = spawn(executable, args, {stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32'});
  proc.on('error', () => {});
  let ws;
  try {
    const raw = await waitForFile(path.join(profileDir, 'DevToolsActivePort'), Math.min(timeoutMs, 20_000));
    const port = Number(String(raw).split(/\r?\n/)[0]);
    if (!Number.isFinite(port) || port <= 0) throw failure('BROWSER_UNAVAILABLE');
    const deadline = Date.now() + Math.min(timeoutMs, 15_000);
    let target = null;
    while (Date.now() < deadline && !target) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {signal: AbortSignal.timeout(3000)});
        const list = await response.json();
        target = (Array.isArray(list) ? list : []).find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? null;
      } catch {}
      if (!target) await sleep(150);
    }
    if (!target) throw failure('BROWSER_UNAVAILABLE');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 1;
    await new Promise<any | void>((resolve?: any, reject?: any) => {
      const timer = setTimeout(() => reject(failure('TIMEOUT')), Math.min(timeoutMs, 15_000));
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
      ws.addEventListener('error', () => { clearTimeout(timer); reject(failure('BROWSER_UNAVAILABLE')); }, {once: true});
    });
    ws.addEventListener('message', (event) => {
      const message = parseCdpMessage(event);
      if (!message?.id) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(failure('REQUEST_FAILED'));
      else entry.resolve(message.result);
    });
    ws.addEventListener('close', () => { if (browser?.ws === ws) browser = null; });
    const state = {
      proc, profileDir, port, ws, pending, proxy, doh,
      send(method?: any, params: Record<string, any> = {}) {
        const id = nextId++;
        return new Promise<any | void>((resolve?: any, reject?: any) => {
          const timer = setTimeout(() => { pending.delete(id); reject(failure('TIMEOUT')); }, 25_000);
          pending.set(id, {
            resolve: (value) => { clearTimeout(timer); resolve(value); },
            reject: (error) => { clearTimeout(timer); reject(error); },
          });
          try { ws.send(JSON.stringify({id, method, params})); }
          catch { clearTimeout(timer); pending.delete(id); reject(failure('REQUEST_FAILED')); }
        });
      },
    };
    browser = state;
    return state;
  } catch (error) {
    try { ws?.close(); } catch {}
    await killBrowser(proc);
    throw error;
  }
}

function killBrowser(proc?: any) {
  if (!proc) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
    else { try { process.kill(-proc.pid, 'SIGKILL'); } catch { proc.kill('SIGKILL'); } }
  } catch {}
}

export async function closeLensBrowser() {
  clearTimeout(idleTimer);
  idleTimer = null;
  const state = browser;
  browser = null;
  starting = null;
  if (!state) return;
  try { state.ws.close(); } catch {}
  killBrowser(state.proc);
}

process.once('exit', () => { if (browser) { try { browser.ws.close(); } catch {} killBrowser(browser.proc); } });

async function ensureBrowser({exe, profileDir, proxy, doh}: { exe?: any; profileDir?: any; proxy?: any; doh?: any; [key: string]: any }) {
  const wantProxy = String(proxy ?? '');
  const wantDoh = String(doh ?? '');
  if (browser) {
    if (browser.proxy === wantProxy && browser.doh === wantDoh) { scheduleIdle(); return browser; }
    await closeLensBrowser();
  }
  if (!starting) {
    starting = (async () => {
      const base = {exe, proxy: wantProxy, doh: wantDoh};
      try {
        return await startBrowser({...base, profileDir: profileDir || fs.mkdtempSync(path.join(os.tmpdir(), 'chopsticks-lens-'))});
      } catch (error) {
        if (error.code === 'NO_BROWSER') throw error;
        return startBrowser({...base, profileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'chopsticks-lens-'))});
      }
    })().finally(() => { starting = null; });
  }
  const state = await starting;
  scheduleIdle();
  return state;
}

// ── CDP helpers ──────────────────────────────────────────────────────────────
/**
 * Settle with the CDP command or the cancellation, whichever comes first.
 * The command has already been dispatched when this runs, so its promise must
 * always keep a handler: a call made after cancellation used to drop it, and
 * its later rejection (CDP error or the 25 s command timer) ended the host
 * process as an unhandled rejection.
 */
export function raced(promise?: any, signal?: any) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason ?? abortError());
  }
  return new Promise<any | void>((resolve?: any, reject?: any) => {
    const onAbort = () => reject(signal.reason ?? abortError());
    signal.addEventListener('abort', onAbort, {once: true});
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

async function evaluate(state?: any, expression?: any, signal?: any) {
  const result: any = await raced(state.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true}), signal);
  return result?.result?.value;
}

async function navigate(state?: any, url?: any, signal?: any, timeoutMs: number = 20_000) {
  const result: any = await raced(state.send('Page.navigate', {url}), signal);
  if (result?.errorText) {
    throw /ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL|ERR_PROXY|ERR_TIMED_OUT/i.test(result.errorText)
      ? failure('GOOGLE_UNREACHABLE') : failure('REQUEST_FAILED');
  }
  const deadline = Date.now() + Math.min(timeoutMs, 20_000);
  while (Date.now() < deadline) {
    try { if (await evaluate(state, 'document.readyState', signal) === 'complete') return; } catch (error) { if (signal.aborted) throw error; }
    await sleep(150);
  }
}

async function waitFor(state?: any, expression?: any, signal?: any, timeoutMs?: any) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(state, expression, signal);
      if (value) return value;
    } catch (error) { if (signal.aborted) throw error; }
    await sleep(400);
  }
  return '';
}

async function extractPage(state?: any, signal?: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await evaluate(state, LENS_EXTRACT, signal);
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) { if (signal.aborted) throw error; }
    await sleep(500);
  }
  return {};
}

async function uploadImage(state: any, file: any, {hl, timeoutMs, signal}: { hl?: any; timeoutMs?: any; signal?: any; [key: string]: any }) {
  trace('upload:start');
  const prepare = [
    '(function () {',
    "  if (document.getElementById('fishLensForm')) return 'exists';",
    "  var form = document.createElement('form');",
    "  form.id = 'fishLensForm'; form.method = 'POST'; form.enctype = 'multipart/form-data';",
    `  form.action = '${LENS_UPLOAD}${hl}';`,
    "  form.target = '_self'; form.style.display = 'none';",
    "  var picker = document.createElement('input');",
    "  picker.type = 'file'; picker.name = 'encoded_image'; picker.id = 'fishLensFile';",
    '  form.appendChild(picker);',
    "  var marker = document.createElement('input');",
    "  marker.type = 'hidden'; marker.name = 'image_content'; marker.value = '';",
    '  form.appendChild(marker);',
    '  document.body.appendChild(form);',
    "  return 'ok';",
    '})()',
  ].join('\n');
  await raced(state.send('Page.enable'), signal);
  await raced(state.send('DOM.enable'), signal);
  try {
    await raced(state.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true});",
    }), signal);
  } catch {}
  await navigate(state, LENS_START, signal);
  trace('upload:start page ready');
  await waitFor(state, 'document.body && document.readyState === "complete"', signal, 10_000);
  trace('upload:prepare', JSON.stringify(await evaluate(state, prepare, signal)));
  await sleep(300);
  let objectId = 0;
  for (let attempt = 0; attempt < 5 && !objectId; attempt++) {
    try {
      const object: any = await raced(state.send('Runtime.evaluate', {expression: "document.getElementById('fishLensFile')"}), signal);
      objectId = object?.result?.objectId ?? 0;
    } catch (error) { if (signal.aborted) throw error; }
    trace('upload:lookup', attempt, Boolean(objectId));
    if (!objectId) { await evaluate(state, prepare, signal); await sleep(500); }
  }
  if (!objectId) {
    const error: any = failure('INVALID_FORMAT');
    try {
      error.detail = {
        url: await evaluate(state, 'location.href', signal),
        ready: await evaluate(state, 'document.readyState', signal),
        form: await evaluate(state, "!!document.getElementById('fishLensForm')", signal),
        body: await evaluate(state, 'document.body ? document.body.innerText.slice(0, 300) : "NO_BODY"', signal),
      };
    } catch {}
    throw error;
  }
  let nodeId = 0;
  try {
    const node: any = await raced(state.send('DOM.requestNode', {objectId}), signal);
    nodeId = node?.nodeId ?? 0;
  } catch (error) { if (signal.aborted) throw error; }
  if (!nodeId) {
    try {
      const doc: any = await raced(state.send('DOM.getDocument', {depth: 2, pierce: false}), signal);
      const found: any = await raced(state.send('DOM.querySelector', {nodeId: doc.root.nodeId, selector: '#fishLensFile'}), signal);
      nodeId = found?.nodeId ?? 0;
    } catch (error) { if (signal.aborted) throw error; }
  }
  trace('upload:node', nodeId);
  if (!nodeId) throw failure('INVALID_FORMAT');
  await raced(state.send('DOM.setFileInputFiles', {files: [file], nodeId}), signal);
  trace('upload:file set');
  await evaluate(state, "document.getElementById('fishLensForm').submit()", signal);
  const status = await waitFor(state, LENS_WAIT, signal, Math.min(timeoutMs, 45_000));
  trace('upload:wait', status);
  await sleep(2_500);
  const page = await extractPage(state, signal);
  trace('upload:extract', JSON.stringify({url: page.url, rows: page.results?.length, cards: page.cards?.length, links: page.links, captcha: page.captcha, empty: page.empty, snippet: String(page.snippet ?? '').slice(0, 300)}));
  const url = String(await evaluate(state, 'location.href', signal) ?? '');
  if (status === 'captcha' || page.captcha) throw failure('GOOGLE_CAPTCHA');
  if (!/^https:\/\/www\.google\.[a-z.]+\/search/i.test(page.url || url)) throw failure('REQUEST_FAILED');
  return {...page, url: page.url || url};
}

async function resolveGoto(state: any, wrapperUrl: any, {timeoutMs, signal}: { timeoutMs?: any; signal?: any; [key: string]: any }) {
  const send =(method?: any, params?: any) => state.send(method, params).catch(() => {});
  try { await raced(state.send('Fetch.enable', {patterns: [{urlPattern: '*', requestStage: 'Request'}]}), signal); trace('goto:enabled'); }
  catch (error) { trace('goto:enable failed', error?.code); if (signal.aborted) throw error; return ''; }
  let target = '';
  let handler;
  const found = new Promise<any | void>((resolve) => {
    const timer = setTimeout(() => resolve(''), timeoutMs);
    handler = (event) => {
      const message = parseCdpMessage(event);
      if (message?.method !== 'Fetch.requestPaused') return;
      const requestId = message.params?.requestId;
      const url = String(message.params?.request?.url ?? '');
      if (!requestId) return;
      const action = gotoRequestAction({url, resourceType: message.params?.resourceType});
      trace('goto:paused', action, url.slice(0, 140));
      if (action === 'continue') { send('Fetch.continueRequest', {requestId}); return; }
      clearTimeout(timer);
      send('Fetch.failRequest', {requestId, errorReason: 'Aborted'});
      resolve(action === 'target' ? url : '');
    };
    state.ws.addEventListener('message', handler);
  });
  try {
    await raced(send('Page.navigate', {url: wrapperUrl}), signal);
    target = await found;
  } catch (error) {
    if (signal.aborted) throw error;
  } finally {
    if (handler) state.ws.removeEventListener('message', handler);
    try { await send('Page.stopLoading'); } catch {}
    try { await send('Fetch.disable'); } catch {}
  }
  trace('goto:result', target.slice(0, 140));
  return target;
}

async function collectRows(state: any, {results, cards}: { results?: any; cards?: any; [key: string]: any }, {timeoutMs, signal, maxCards = 3}: { timeoutMs?: any; signal?: any; maxCards?: number; [key: string]: any }) {
  const rows = Array.isArray(results) ? results.slice() : [];
  const list = Array.isArray(cards) ? cards.slice() : [];
  if (!list.length || maxCards <= 0) return rows;
  const score = (item) => SOCIAL_CARD_RE.test(String(item?.title ?? '')) ? 2 : ARTWORK_CARD_RE.test(String(item?.title ?? '')) ? 1 : 0;
  list.sort((a?: any, b?: any) => score(b) - score(a));
  const seen = new Set<any>(rows.map((row) => String(row?.url ?? '')));
  for (const card of list.slice(0, maxCards)) {
    if (signal.aborted) throw signal.reason ?? abortError();
    const target = await resolveGoto(state, String(card?.wrapper ?? ''), {timeoutMs: Math.min(timeoutMs, 5_000), signal});
    if (!target || seen.has(target)) continue;
    seen.add(target);
    rows.push({url: target, title: card.title});
  }
  return rows;
}

/**
 * Search Google Lens and return artwork/anime candidates. Throws an Error with
 * a stable `.code` on failure; returns [] for a legitimate no-match page.
 */
export async function searchLens(bytes?: any, mimeType?: any, {signal, timeoutMs = 45_000, browser: exe = '', proxy = '', doh = 'https://cloudflare-dns.com/dns-query', profileDir = '', hl = 'zh-CN', exactPass = true, resolveCards = 6, debug = false}: { signal?: any; timeoutMs?: number; browser?: string; proxy?: string; doh?: string; profileDir?: string; hl?: string; exactPass?: boolean; resolveCards?: number; debug?: boolean; [key: string]: any } = {}) {
  if (debug) trace = (...args) => console.error('[lens]', ...args);
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw failure('INVALID_FORMAT');
  if (signal?.aborted) throw abortError();
  const extension = /png/i.test(String(mimeType ?? '')) ? 'png' : /webp/i.test(String(mimeType ?? '')) ? 'webp' : /gif/i.test(String(mimeType ?? '')) ? 'gif' : 'jpg';
  const directory = profileDir && fs.existsSync(profileDir) ? profileDir : os.tmpdir();
  const file = path.join(directory, `chopsticks-lens-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${extension}`);
  fs.writeFileSync(file, bytes, {mode: 0o600});
  const local = new AbortController();
  const timer = setTimeout(() => local.abort(failure('TIMEOUT')), timeoutMs);
  const abort = () => local.abort(signal.reason ?? abortError());
  signal?.addEventListener('abort', abort, {once: true});
  try {
    const state = await raced(ensureBrowser({exe, profileDir, proxy, doh}), local.signal);
    const page = await uploadImage(state, file, {hl, timeoutMs, signal: local.signal});
    let rows = Array.isArray(page.results) ? page.results.slice() : [];
    let cards = Array.isArray(page.cards) ? page.cards.slice() : [];
    // Same order as the source tool: resolve visual cards first, then use the
    // exact-match tab only when no social card was found.
    if (resolveCards > 0) {
      rows = await collectRows(state, {results: rows, cards}, {timeoutMs, signal: local.signal, maxCards: resolveCards});
    }
    const looksSocial = (list) => list.some((row) =>
      SOCIAL_CARD_RE.test(String(row?.title ?? '')) || LENS_SOCIAL_URL_RE.test(String(row?.url ?? '')));
    if (exactPass !== false && !looksSocial(rows)) {
      try {
        const exact = new URL(String(page.url ?? ''));
        if (/^https:\/\/www\.google\.[a-z.]+\/search$/i.test(exact.origin + exact.pathname)) {
          exact.searchParams.set('udm', '48');
          await navigate(state, exact.href, local.signal, 15_000);
          await waitFor(state, LENS_WAIT, local.signal, Math.min(timeoutMs, 8_000));
          await sleep(1_800);
          const second = await extractPage(state, local.signal);
          if (!second.captcha) {
            if (Array.isArray(second.results)) rows = rows.concat(second.results);
            if (Array.isArray(second.cards)) cards = cards.concat(second.cards);
            if (resolveCards > 0) {
              rows = await collectRows(state, {results: rows, cards}, {timeoutMs, signal: local.signal, maxCards: resolveCards});
            }
          }
        }
      } catch (error) { if (local.signal.aborted) throw error; }
    }
    return mapLensRows(rows);
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (local.signal.aborted) throw local.signal.reason ?? failure('TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    try { fs.rmSync(file, {force: true}); } catch {}
    trace = () => {};
    scheduleIdle();
  }
}
