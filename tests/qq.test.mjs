import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createQQAdapter } from '../adapters/qq.mjs';

class Socket extends EventEmitter {
  static instances = [];
  constructor(url, options) { super(); this.url = url; this.options = options; Socket.instances.push(this); }
  close() { this.emit('close'); }
  message(data) { this.emit('message', Buffer.from(JSON.stringify(data))); }
}
const response = (data, { status = 'ok', retcode = 0, ok = true } = {}) => ({ ok, json: async () => ({ status, retcode, data }) });
async function fixture(extra = {}) {
  const events = [], requests = [];
  const adapter = createQQAdapter({ httpUrl: 'http://gateway.test:3000', wsUrl: 'ws://gateway.test:3001', token: 'private-token',
    ownerId: '10001', selfId: '90001', allowGroups: ['20001', '20002'], allowUsers: ['10001'], denyUsers: ['66666'],
    onEvent: async e => events.push(e), WebSocketImpl: Socket,
    fetchImpl: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return response(url.endsWith('get_login_info') ? { user_id: '90001' } : { message_id: '777' }); }, ...extra });
  await adapter.start();
  const socket = Socket.instances.at(-1); socket.emit('open');
  return { adapter, socket, events, requests };
}
const inbound = (extra = {}) => ({ post_type: 'message', message_type: 'group', group_id: 20001, user_id: 10002, self_id: 90001,
  message_id: 123, time: 1700000000, sender: { nickname: 'friend' }, message: [{ type: 'text', data: { text: 'hello' } }], ...extra });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('normalizes admissible inbound once with trusted admin and preserves media fields', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const event = inbound({ message: [{ type: 'at', data: { qq: '90001' } }, { type: 'text', data: { text: '管理员 hello' } },
    { type: 'mface', data: { emoji_id: 'e', sub_type: '1', summary: 'sticker', url: 'https://qpic.cn/x' } }] });
  f.socket.message(event); f.socket.message(event); await settle();
  assert.equal(f.events.length, 1); const e = f.events[0];
  assert.equal(e.channel, 'g:20001'); assert.equal(e.actorId, '10002'); assert.equal(e.meta.admin, false);
  assert.equal(e.meta.addressed, true); assert.equal(e.meta.segments[2].data.emoji_id, 'e'); assert.equal(e.at, 1700000000000);
});
test('denies unknown channels, blocked senders, self echoes and malformed frames', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  for (const patch of [{ group_id: 999 }, { user_id: 66666 }, { user_id: 90001 }, { message_type: 'private', user_id: 10002 }]) f.socket.message(inbound(patch));
  f.socket.emit('message', Buffer.from('{')); await settle(); assert.equal(f.events.length, 0);
});
test('owner authority comes from actual user id; CQ is decoded without losing reply references', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  f.socket.message(inbound({ user_id: 10001, message: '[CQ:reply,id=99][CQ:at,qq=90001]hi&#91;x&#93; &amp; ok' })); await settle();
  assert.equal(f.events[0].meta.admin, true); assert.equal(f.events[0].meta.addressed, true);
  assert.match(f.events[0].text, /hi\[x\] & ok/); assert.equal(f.events[0].meta.segments[0].data.id, '99');
});
test('send only records a confirmed receipt and deduplicates concurrent idempotency keys', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  const request = { channel: 'g:20001', text: '[CQ:at,qq=all]', idempotencyKey: 'same' };
  const [a, b] = await Promise.all([f.adapter.send(request), f.adapter.send(request)]);
  assert.equal(a.id, b.id); assert.equal(a.kind, 'message.sent'); assert.equal(a.meta.messageId, '777');
  assert.equal(f.events.length, 1); assert.equal(f.requests.filter(r => r.url.endsWith('send_group_msg')).length, 1);
  assert.equal(f.requests.at(-1).body.message[0].type, 'text');
  assert.equal(f.requests.at(-1).body.auto_escape, true);
  await assert.rejects(f.adapter.send({ ...request, text: 'different' }), /idempotency/i);
});
test('send rechecks targets and only replies to a message received in that channel', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  await assert.rejects(f.adapter.send({ channel: 'g:999', text: 'x' }), /allow/i);
  await assert.rejects(f.adapter.send({ channel: 'g:20001', text: 'x', replyTo: '123' }), /received/i);
  f.socket.message(inbound()); await settle();
  await f.adapter.send({ channel: 'g:20001', text: 'x', replyTo: '123' });
  assert.deepEqual(f.requests.at(-1).body.message[0], { type: 'reply', data: { id: '123' } });
});
test('transport failure is uncertain and identical request is never blindly retried', async t => {
  let sends = 0;
  const f = await fixture({ fetchImpl: async url => { if (url.endsWith('get_login_info')) return response({ user_id: '90001' }); sends++; throw new Error('timeout private-token'); } });
  t.after(() => f.adapter.close());
  const request = { channel: 'g:20001', text: 'x', idempotencyKey: 'uncertain' };
  for (let i = 0; i < 2; i++) await assert.rejects(f.adapter.send(request), e => e.code === 'SEND_UNCERTAIN' && !e.message.includes('private-token'));
  assert.equal(sends, 1); assert.equal(f.events.length, 0);
});
test('gateway rejection is not a confirmed send; missing receipt is uncertain', async t => {
  for (const result of [response({}, { retcode: 100 }), response({}, { status: 'failed' }), response({})]) {
    const f = await fixture({ fetchImpl: async url => url.endsWith('get_login_info') ? response({ user_id: '90001' }) : result });
    t.after(() => f.adapter.close()); await assert.rejects(f.adapter.send({ channel: 'g:20001', text: 'x' })); assert.equal(f.events.length, 0);
  }
});
test('lookup only accepts actually received media/forward references in their channel', async t => {
  const calls = [];
  const f = await fixture({ fetchImpl: async (url, opts) => { if (!opts.body) return new Response(Buffer.from('GIF89a'), { headers: { 'content-type': 'image/gif' } }); calls.push({ url, body: JSON.parse(opts.body) });
    return response(url.endsWith('get_login_info') ? { user_id: '90001' } : url.endsWith('get_forward_msg') ? { messages: [{ content: 'hello' }] } : { url: 'https://multimedia.nt.qq.com/image', file: '/secret/local/path' }); } });
  t.after(() => f.adapter.close());
  await assert.rejects(f.adapter.getImage({ channel: 'g:20001', messageId: '123' }), /received/i);
  f.socket.message(inbound({ message: [{ type: 'image', data: { file: 'opaque-image' } }, { type: 'forward', data: { id: 'forward-id' } }] })); await settle();
  await assert.rejects(f.adapter.getImage({ channel: 'g:20002', messageId: '123' }), /received/i);
  const image = await f.adapter.getImage({ channel: 'g:20001', messageId: '123' });
  assert.equal(image.content[0].data, Buffer.from('GIF89a').toString('base64')); assert.equal(image.content[0].type, 'image');
  assert.ok(!JSON.stringify(image).includes('/secret/local/path'));
  const forward = await f.adapter.getForward({ channel: 'g:20001', messageId: '123' });
  assert.equal(forward.forwards[0].messages[0].content, 'hello');
  assert.deepEqual(calls.at(-1).body, { id: 'forward-id' });
});
test('image download rejects off-domain redirects, mismatched bytes and oversized content', async t => {
  for (const download of [
    new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }),
    new Response('secret text', { headers: { 'content-type': 'image/png' } }),
    new Response('GIF89a', { headers: { 'content-type': 'image/gif', 'content-length': String(9 * 1024 * 1024) } })
  ]) {
    const calls = [];
    const f = await fixture({ fetchImpl: async (url, opts) => { calls.push(url); return opts.body ? response({ user_id: '90001' }) : download; } });
    t.after(() => f.adapter.close());
    f.socket.message(inbound({ message: [{ type: 'image', data: { url: 'https://multimedia.nt.qq.com/image' } }] })); await settle();
    await assert.rejects(f.adapter.getImage({ channel: 'g:20001', messageId: '123' }));
    assert.equal(calls.length, 2); assert.ok(calls.every(url => !url.includes('127.0.0.1')));
  }
});
test('onEvent consumer can immediately reference accepted inbound without race', async t => {
  let adapter, callbackError;
  const f = await fixture({ onEvent: async event => {
    if (event.kind === 'message.received') try { await adapter.send({ channel: event.channel, text: 'reply', replyTo: event.meta.messageId }); } catch (e) { callbackError = e; }
  } }); adapter = f.adapter; t.after(() => adapter.close());
  f.socket.message(inbound()); await settle(); assert.equal(callbackError, undefined);
  assert.equal(f.requests.filter(r => r.url.endsWith('send_group_msg')).length, 1);
});
test('actual replies to confirmed self messages count as addressed', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  await f.adapter.send({ channel: 'g:20001', text: 'hello' });
  f.socket.message(inbound({ message: [{ type: 'reply', data: { id: '777' } }, { type: 'text', data: { text: 'yes' } }] })); await settle();
  assert.equal(f.events.at(-1).meta.addressed, true);
});
test('send rejects arbitrary local media, admin segments, at-all and unobserved image urls', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  for (const segment of [{ type: 'image', data: { file: '/etc/passwd' } }, { type: 'image', data: { url: 'https://example.com/a' } }, { type: 'at', data: { qq: 'all' } }, { type: 'json', data: { data: '{}' } }]) {
    await assert.rejects(f.adapter.send({ channel: 'g:20001', segments: [segment] }));
  }
});
test('close cancels reconnect and status never exposes credentials', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  assert.equal(f.adapter.status().connected, true); f.socket.emit('close'); assert.equal(f.adapter.status().connected, false);
  assert.equal(f.adapter.status().reconnecting, true); f.adapter.close(); assert.equal(f.adapter.status().reconnecting, false);
  assert.ok(!JSON.stringify(f.adapter.status()).includes('private-token'));
});
test('close during startup cannot resurrect the websocket', async () => {
  let release;
  const before = Socket.instances.length;
  const adapter = createQQAdapter({ httpUrl: 'http://gateway.test', wsUrl: 'ws://gateway.test', WebSocketImpl: Socket,
    fetchImpl: async () => new Promise(resolve => { release = resolve; }) });
  const starting = adapter.start(); adapter.close(); release(response({ user_id: '90001' })); await starting;
  assert.equal(Socket.instances.length, before); assert.equal(adapter.status().started, false);
});
test('websocket reconnect is delayed and capped, close cancels it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = await fixture(); t.after(() => f.adapter.close());
  const before = Socket.instances.length;
  f.socket.emit('close'); t.mock.timers.tick(999); assert.equal(Socket.instances.length, before);
  t.mock.timers.tick(1); assert.equal(Socket.instances.length, before + 1);
  Socket.instances.at(-1).emit('close'); t.mock.timers.tick(2000); assert.equal(Socket.instances.length, before + 2);
  f.adapter.close(); t.mock.timers.tick(60000); assert.equal(Socket.instances.length, before + 2);
});
test('confirmed delivery with failed journal callback never sends twice', async t => {
  const f = await fixture({ onEvent: async () => { throw new Error('disk unavailable'); } }); t.after(() => f.adapter.close());
  const request = { channel: 'g:20001', text: 'x', idempotencyKey: 'confirmed-unrecorded' };
  for (let i = 0; i < 2; i++) await assert.rejects(f.adapter.send(request), error => error.code === 'SEND_CONFIRMED_UNRECORDED');
  assert.equal(f.requests.filter(r => r.url.endsWith('send_group_msg')).length, 1);
});
test('gateway credentials cannot be echoed by the send tool', async t => {
  const f = await fixture(); t.after(() => f.adapter.close());
  await assert.rejects(f.adapter.send({ channel: 'g:20001', text: 'private-token' }), /credential/i);
  assert.equal(f.requests.filter(r => r.url.endsWith('send_group_msg')).length, 0);
});
test('separate HTTP and websocket credentials never cross transports or escape in messages', async t => {
  let authorization;
  const f = await fixture({ token: { http: 'http-secret', ws: 'ws-secret' }, fetchImpl: async (_url, opts) => {
    authorization = opts.headers.authorization; return response({ user_id: '90001' });
  } }); t.after(() => f.adapter.close());
  assert.equal(authorization, 'Bearer http-secret'); assert.equal(f.socket.options.headers.Authorization, 'Bearer ws-secret');
  for (const text of ['http-secret', 'ws-secret']) await assert.rejects(f.adapter.send({ channel: 'g:20001', text }), /credential/i);
});
