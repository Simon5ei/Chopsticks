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
  async function request(action, data = {}, sending = false) {
    let res, body;
    try {
      res = await fetchImpl(`${base.href.replace(/\/$/, '')}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000) });
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
    try { socket = new WebSocketImpl(websocketUrl.href, { headers: token ? { Authorization: `Bearer ${token}` } : {}, maxPayload: 2 * 1024 * 1024 }); }
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
  function send({ channel, text = '', segments = [], replyTo, idempotencyKey } = {}) {
    let t, parts;
    try {
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
      if (token && JSON.stringify(parts).includes(token)) throw new Error('QQ message contains a gateway credential');
      if (replyTo != null) { observed(channel, replyTo); parts.unshift({ type: 'reply', data: { id: String(replyTo) } }); }
    } catch (error) { return Promise.reject(error); }
    const key = String(idempotencyKey || randomUUID()), hash = fingerprint({ channel, parts });
    const previous = sends.get(key);
    if (previous) return previous.hash === hash ? previous.promise : Promise.reject(new Error('Idempotency key reused with different QQ content'));
    // Bounded journal does not evict uncertain/confirmed intents silently. Host persists across restart.
    if (sends.size >= LIMIT) return Promise.reject(new Error('QQ send receipt cache full; rotate adapter after durable reconciliation'));
    const promise = sendChain.then(async () => {
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
    });
    sends.set(key, { hash, promise }); sendChain = promise.catch(() => {}); return promise;
  }
  async function downloadImage(url) {
    let current = officialImageUrl(url);
    for (let hops = 0; hops < 4; hops++) {
      const response = await fetchImpl(current, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
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
  async function getImage({ channel, messageId }) {
    const event = observed(channel, messageId), media = imageSegments(event.meta.segments);
    if (!media.length) throw new Error('Received message has no supported image');
    const content = [];
    for (const segment of media.slice(0, 4)) {
      let url = segment.data.url;
      if (!url) {
        const file = String(segment.data.file || '');
        if (!file || file.length > 255 || /[\\/:]/.test(file)) throw new Error('Image has no supported gateway reference');
        const data = await request('get_image', { file }); url = data?.url;
      }
      content.push(await downloadImage(url));
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
  return { start, close, send, getImage, getForward, status };
}
