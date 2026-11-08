import { createHash, randomUUID } from 'node:crypto';
import { segmentsOf, textOf, imageSegments, officialImageUrl } from './qq-helpers/segments.mjs';

const LIMIT = 5000;
function boundedSet(map, key, value) { map.set(key, value); while (map.size > LIMIT) map.delete(map.keys().next().value); }
function problem(code, message) { return Object.assign(new Error(message), { code }); }
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** OneBot transport only. Durable send intent/idempotency belongs to the host. */
export function createQQAdapter({ httpUrl, wsUrl, token = '', ownerId, selfId, allowGroups = [], allowUsers = [], denyUsers = [],
  onEvent = async () => {}, onStatus = () => {}, fetchImpl = globalThis.fetch, WebSocketImpl } = {}) {
  const base = new URL(httpUrl); const websocketUrl = new URL(wsUrl);
  const httpToken = typeof token === 'string' ? token : String(token?.http ?? '');
  const wsToken = typeof token === 'string' ? token : String(token?.ws ?? '');
  if (!['http:', 'https:'].includes(base.protocol) || !['ws:', 'wss:'].includes(websocketUrl.protocol)
    || base.username || base.password || websocketUrl.username || websocketUrl.password) throw new Error('Invalid QQ gateway URL');
  const groups = new Set(allowGroups.map(String)), users = new Set(allowUsers.map(String)), blocked = new Set(denyUsers.map(String));
  let botId = String(selfId ?? ''), socket, reconnectTimer, closed = true, starting, attempts = 0, lifecycle = 0;
  let connected = false, lastPacketAt = null, lastError = null, receiveHealthy = null;
  const received = new Map(), seen = new Map(), sends = new Map(), selfMessages = new Map(), sendTimes = [];
  let inboundChain = Promise.resolve(), sendChain = Promise.resolve();
  const status = () => ({ connected, started: !closed, reconnecting: !!reconnectTimer, reconnectAttempts: attempts, selfId: botId,
    lastPacketAt, receiveHealthy, lastError });
  function publish() { try { onStatus(status()); } catch { /* Observers cannot break transport. */ } }
  function target(channel) {
    const match = /^(g|p):(\d+)$/.exec(String(channel));
    if (!match || !(match[1] === 'g' ? groups : users).has(match[2])) throw problem('NOT_ALLOWED', 'QQ target is not allowlisted');
    return { kind: match[1], id: match[2] };
  }
  async function request(action, data = {}, sending = false, signal) {
    let res, body;
    try {
      const timeout=AbortSignal.timeout(15000);
      signal?.throwIfAborted();
      res = await fetchImpl(`${base.href.replace(/\/$/, '')}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json',
        ...(httpToken ? { authorization: `Bearer ${httpToken}` } : {}) }, body: JSON.stringify(data), signal: signal?AbortSignal.any([signal,timeout]):timeout });
      body = await res.json();
    } catch {
      throw problem(sending ? 'SEND_UNCERTAIN' : 'GATEWAY_UNAVAILABLE', sending ? 'QQ send acknowledgement unavailable; do not retry blindly' : 'QQ gateway request failed');
    }
    if (!res.ok || body?.status !== 'ok' || body?.retcode !== 0) {
      throw problem(sending && !res.ok ? 'SEND_UNCERTAIN' : 'GATEWAY_REJECTED', 'QQ gateway did not confirm the operation');
    }
    return body.data;
  }
  function observed(channel, messageId) {
    target(channel); const message = received.get(`${channel}:${String(messageId)}`);
    if (!message) throw problem('NOT_RECEIVED', 'Message was not actually received in this channel');
    return message;
  }
  async function incoming(raw) {
    if (closed) return;
    let event; try { event = JSON.parse(String(raw)); } catch { return; }
    lastPacketAt = Date.now();
    if (event.post_type === 'meta_event') { if (event.meta_event_type === 'heartbeat') receiveHealthy = event.status?.good ?? event.status?.online ?? null; publish(); return; }
    if (event.post_type !== 'message' || !['group', 'private'].includes(event.message_type)) return;
    const actorId = String(event.user_id ?? '');
    if (!/^\d+$/.test(actorId) || blocked.has(actorId) || actorId === botId || String(event.sender?.user_id ?? '') === botId) return;
    const channel = event.message_type === 'group' ? `g:${event.group_id}` : `p:${actorId}`;
    try { target(channel); } catch { return; }
    if (event.message_id == null || !/^-?\d+$/.test(String(event.message_id))) return;
    const messageId = String(event.message_id), id = `qq:${channel}:${messageId}`;
    if (seen.has(id)) return;
    const segments = segmentsOf(event.message ?? event.raw_message);
    const time = Number(event.time);
    const normalized = { id, kind: 'message.received', channel, actorId, text: textOf(segments),
      at: Number.isFinite(time) && time > 0 ? time * 1000 : Date.now(), meta: { messageId,
        senderName: String(event.sender?.card || event.sender?.nickname || actorId), segments,
        addressed: channel.startsWith('p:') || segments.some(s => (s.type === 'at' && String(s.data.qq) === botId)
          || (s.type === 'reply' && selfMessages.has(`${channel}:${String(s.data.id)}`))),
        selfId: botId, admin: actorId === String(ownerId ?? '') } };
    // Mark only after durable consumer acceptance: a rejected journal write may be replayed.
    boundedSet(received, `${channel}:${messageId}`, normalized);
    await onEvent(normalized);
    boundedSet(seen, id, true);
  }
  function reconnect() {
    if (closed || reconnectTimer) return;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(attempts++, 5)));
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (!closed) connect(); }, delay);
    reconnectTimer.unref?.(); publish();
  }
  function connect() {
    if (closed) return;
    try { socket = new WebSocketImpl(websocketUrl.href, { headers: wsToken ? { Authorization: `Bearer ${wsToken}` } : {}, maxPayload: 2 * 1024 * 1024 }); }
    catch { lastError = 'QQ websocket connection failed'; reconnect(); return; }
    const current = socket;
    current.on('open', () => { if (closed || socket !== current) return; connected = true; attempts = 0; lastError = null; publish(); });
    current.on('message', data => { if (socket !== current || closed) return;
      inboundChain = inboundChain.then(() => incoming(data)).catch(() => { lastError = 'QQ inbound event could not be stored'; publish(); }); });
    current.on('error', () => { lastError = 'QQ websocket connection failed'; connected = false; publish(); });
    current.on('close', () => { if (socket !== current) return; connected = false; publish(); reconnect(); });
  }
  async function start() {
    if (starting) return starting;
    if (!closed) return status();
    const generation = ++lifecycle;
    starting = (async () => {
      const info = await request('get_login_info');
      if (!/^\d+$/.test(String(info?.user_id ?? ''))) throw new Error('QQ gateway did not identify logged-in account');
      if (botId && botId !== String(info.user_id)) throw new Error('QQ gateway account differs from configured selfId');
      botId = String(info.user_id);
      if (!WebSocketImpl) WebSocketImpl = (await import('ws')).default;
      if (generation !== lifecycle) return status();
      closed = false; connect(); return status();
    })();
    try { return await starting; } finally { starting = null; }
  }
  function close() { lifecycle++; closed = true; clearTimeout(reconnectTimer); reconnectTimer = null; connected = false; socket?.close(); publish(); }
  // Host-only restoration from its trusted canonical journal. Never expose this
  // method as a model tool or accept events supplied by an external message.
  function hydrateEvents(events) {
    if (!Array.isArray(events)) throw new TypeError('Trusted journal events must be an array');
    const restored = { received: 0, sent: 0 };
    for (const event of events) {
      if (!event || !['message.received', 'message.sent'].includes(event.kind)) continue;
      let destination; try { destination = target(event.channel); } catch { continue; }
      const messageId = String(event.meta?.messageId ?? ''), actorId = String(event.actorId ?? '');
      if (!/^-?\d+$/.test(messageId) || !/^\d+$/.test(actorId) || typeof event.id !== 'string' || !event.id) continue;
      const key = `${event.channel}:${messageId}`;
      if (event.kind === 'message.sent') {
        if (!botId || actorId !== botId) continue;
        boundedSet(selfMessages, key, true);
        restored.sent++;
      } else {
        if (actorId === botId || blocked.has(actorId) || (destination.kind === 'p' && destination.id !== actorId)) continue;
        const copy = { ...event, actorId, meta: { ...event.meta, messageId, segments: segmentsOf(event.meta?.segments ?? []) } };
        boundedSet(received, key, copy);
        boundedSet(seen, event.id, true);
        restored.received++;
      }
    }
    return restored;
  }
  function send({ channel, text = '', segments = [], replyTo, idempotencyKey, signal } = {}) {
    let t, parts;
    try {
      signal?.throwIfAborted();
      t = target(channel); if (closed) throw new Error('QQ adapter is closed');
      if (!Array.isArray(segments)) throw new Error('QQ segments must be an array');
      if (String(text).length > 4000 || segments.length > 8) throw new Error('QQ send is too large');
      parts = segmentsOf(segments);
      for (const part of parts) {
        if (part.type === 'text') { if (typeof part.data.text !== 'string' || part.data.text.length > 4000) throw new Error('Invalid text segment'); }
        else if (part.type === 'at') { if (!/^\d+$/.test(String(part.data.qq))) throw new Error('Only individual QQ mentions allowed'); }
        else if (part.type === 'image' || part.type === 'mface') {
          const url = officialImageUrl(part.data.url);
          const known = [...received.values()].some(e => e.channel === channel && imageSegments(e.meta.segments).some(s => s.data.url === url));
          if (!known) throw new Error('Image must have been received in this channel');
          part.type = 'image'; part.data = { file: url };
        } else throw new Error('Unsupported outbound QQ segment');
      }
      if (text) parts.push({ type: 'text', data: { text: String(text) } });
      if (!parts.length) throw new Error('Empty QQ message');
      if ([httpToken, wsToken].some(secret => secret && JSON.stringify(parts).includes(secret))) throw new Error('QQ message contains a gateway credential');
      if (replyTo != null) {
        if (!selfMessages.has(`${channel}:${String(replyTo)}`)) observed(channel, replyTo);
        parts.unshift({ type: 'reply', data: { id: String(replyTo) } });
      }
    } catch (error) { return Promise.reject(error); }
    const key = String(idempotencyKey || randomUUID()), hash = fingerprint({ channel, parts });
    const previous = sends.get(key);
    if (previous) return previous.hash === hash ? previous.promise : Promise.reject(new Error('Idempotency key reused with different QQ content'));
    // This is a bounded process-local cache, not the durable idempotency journal.
    // The host must check its persisted send key before invoking send. Only
    // settled results may age out; pending/ambiguous effects remain protected.
    if (sends.size >= LIMIT) {
      for (const [oldKey, entry] of sends) {
        if (entry.state === 'confirmed' || entry.state === 'failed') { sends.delete(oldKey); break; }
      }
    }
    if (sends.size >= LIMIT) return Promise.reject(new Error('QQ unresolved send cache full; reconcile uncertain deliveries'));
    const entry = { hash, state: 'pending', promise: null };
    const promise = sendChain.then(async () => {
      // A different send may have held this queue while the caller cancelled.
      // Once HTTP starts, retain its confirmed/uncertain outcome; do not turn a
      // potentially accepted send into a retryable cancellation.
      signal?.throwIfAborted();
      if (closed) throw new Error('QQ adapter is closed'); target(channel);
      const now = Date.now(); while (sendTimes.length && sendTimes[0] < now - 60000) sendTimes.shift();
      if (sendTimes.length >= 8) throw problem('RATE_LIMIT', 'QQ send limit reached; wait before another send');
      sendTimes.push(now);
      const data = await request(t.kind === 'g' ? 'send_group_msg' : 'send_private_msg', {
        [t.kind === 'g' ? 'group_id' : 'user_id']: Number(t.id), message: parts, auto_escape: true }, true);
      if (data?.message_id == null || !/^-?\d+$/.test(String(data.message_id))) throw problem('SEND_UNCERTAIN', 'QQ sent receipt has no message id; do not retry blindly');
      const messageId = String(data.message_id), event = { id: `qq:${channel}:${messageId}`, kind: 'message.sent', channel, actorId: botId,
        text: textOf(parts), at: Date.now(), meta: { messageId, senderName: '我', segments: parts, selfId: botId, admin: false, idempotencyKey: key, confirmed: true } };
      boundedSet(selfMessages, `${channel}:${messageId}`, true);
      try { await onEvent(event); } catch { throw problem('SEND_CONFIRMED_UNRECORDED', 'QQ confirmed delivery but journal write failed; do not resend'); }
      return event;
    }).then(value => { entry.state = 'confirmed'; return value; }, error => {
      entry.state = ['SEND_UNCERTAIN', 'SEND_CONFIRMED_UNRECORDED'].includes(error?.code) ? 'uncertain' : 'failed';
      throw error;
    });
    entry.promise = promise;
    sends.set(key, entry); sendChain = promise.catch(() => {}); return promise;
  }
  async function downloadImage(url, signal) {
    signal?.throwIfAborted();
    let current = officialImageUrl(url);
    for (let hops = 0; hops < 4; hops++) {
      const timeout=AbortSignal.timeout(15000);
      const response = await fetchImpl(current, { redirect: 'manual', signal: signal?AbortSignal.any([signal,timeout]):timeout });
      if ([301, 302, 303, 307, 308].includes(response.status)) { current = officialImageUrl(new URL(response.headers.get('location'), current).href); await response.body?.cancel?.(); continue; }
      if (!response.ok) throw new Error('QQ image download failed');
      const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)) throw new Error('QQ media is not a supported image');
      if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) { await response.body?.cancel?.(); throw new Error('QQ image exceeds 8 MiB'); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) { await response.body.cancel?.().catch?.(() => {}); throw new Error('QQ image exceeds 8 MiB'); } chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks);
      const valid = mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mimeType === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
      if (!valid) throw new Error('QQ image bytes do not match image type');
      return { type: 'image', mimeType, data: bytes.toString('base64') };
    }
    throw new Error('Too many QQ image redirects');
  }
  async function getImage({ channel, messageId, maxImages=4, signal }) {
    signal?.throwIfAborted();
    if(!Number.isInteger(maxImages)||maxImages<1||maxImages>4)throw new Error('Invalid image limit');
    const event = observed(channel, messageId), media = imageSegments(event.meta.segments);
    if (!media.length) throw new Error('Received message has no supported image');
    const content = [];
    for (const segment of media.slice(0, maxImages)) {
      signal?.throwIfAborted();
      const file = String(segment.data.file || '');
      const refreshable = Boolean(file) && file.length <= 255 && !/[\\/:]/.test(file);
      const freshUrl = async () => {
        if (!refreshable) throw new Error('Image has no supported gateway reference');
        const data = await request('get_image', { file }, false, signal);
        if (!data?.url) throw new Error('QQ gateway returned no image URL');
        return data.url;
      };
      const storedUrl = segment.data.url;
      const url = storedUrl || await freshUrl();
      try {
        content.push(await downloadImage(url,signal));
      } catch (error) {
        // QQ image URLs carry a short-lived rkey. A reply to an older message
        // can still be valid while the stored URL has expired; ask the gateway
        // for a fresh URL using the stable file reference and retry once.
        if (signal?.aborted || !storedUrl || !refreshable) throw error;
        const refreshed = await freshUrl();
        if (refreshed === url) throw error;
        content.push(await downloadImage(refreshed,signal));
      }
    }
    return { content };
  }
  async function getForward({ channel, messageId }) {
    const event = observed(channel, messageId);
    const ids = event.meta.segments.filter(s => s.type === 'forward').map(s => String(s.data.id || '')).filter(id => /^[\w-]{1,256}$/.test(id));
    if (!ids.length) throw new Error('Received message has no supported forward reference');
    const forwards = [];
    for (const id of ids.slice(0, 4)) forwards.push({ id, ...(await request('get_forward_msg', { id })) });
    return { forwards };
  }
  return { start, close, send, getImage, getForward, hydrateEvents, status };
}
