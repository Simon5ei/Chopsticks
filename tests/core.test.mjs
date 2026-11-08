import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createEventStore } from '../core/events.mjs';
import { createRouter } from '../core/router.mjs';

const event = (id, channel = 'g:1', extra = {}) => ({ id, channel, kind: 'message.received', actorId: '42', text: id, ...extra });
function fixture(t) {
  const stateDir = mkdtempSync(join(tmpdir(), 'chopsticks-core-'));
  let store = createEventStore({ stateDir });
  const routers = [];
  t.after(async () => { for (const router of routers) await router.close(); store.close(); rmSync(stateDir, { recursive: true, force: true }); });
  return { get store() { return store; }, restart() { store.close(); return store = createEventStore({ stateDir }); }, router(options) { const router = createRouter({ store, ...options }); routers.push(router); return router; } };
}
async function until(predicate, message = 'condition timed out') {
  for (let n = 0; n < 200; n++) { if (predicate()) return; await delay(5); }
  assert.fail(message);
}

test('confirmed self facts remain in bounded cross-group context, private records never cross scopes', t => {
  const { store } = fixture(t);
  store.append(event('secret', 'p:7', { text: 'PRIVATE FACT' }));
  store.append(event('operator', 'operator:root', { text: 'OPERATOR FACT' }));
  const sent = store.append(event('self', 'g:1', { kind: 'message.sent', text: 'I promised Tuesday', meta: { messageId: 'receipt-1' } }));
  for (let n = 0; n < 30; n++) store.append(event(`noise-${n}`, 'g:2'));
  const context = store.context({ channel: 'g:2', limit: 4, maxChars: 1000 });
  assert.equal(context.revision, store.latestSeq());
  assert.ok(context.events.some(e => e.id === sent.id));
  assert.match(context.text, /I promised Tuesday/);
  assert.doesNotMatch(context.text, /PRIVATE FACT|OPERATOR FACT/);
  assert.ok(context.text.length <= 1000);
  assert.deepEqual(store.recent({ channel: 'p:7' }).map(e => e.id), ['secret']);
  assert.deepEqual(store.recent({ channel: 'g:1', groups: false }).map(e => e.id), ['self']);
  assert.deepEqual(store.recent({ channel: 'g:2', limit: 2 }).map(e => e.id), ['noise-28', 'noise-29']);
  assert.equal(store.recent({ channel: 'g:2', query: 'promised' })[0].id, 'self');
  assert.ok(store.recent({ channel: 'g:2', beforeSeq: sent.seq }).every(e => e.seq < sent.seq));
});

test('stable IDs deduplicate across restart and unconfirmed outgoing records are rejected', t => {
  const f = fixture(t);
  const first = f.store.append(event('network-id'));
  assert.equal(f.store.append(event('network-id', 'g:9', { text: 'replacement' })).seq, first.seq);
  assert.equal(f.store.latestSeq(), first.seq);
  assert.throws(() => f.store.append(event('bad', 'g:1', { kind: 'message.sent' })), /messageId/);
  assert.throws(() => f.store.append(event('bad-channel', 'unknown')), /channel/);
  assert.equal(f.restart().get('network-id').text, 'network-id');
  assert.equal(f.store.append(event('network-id')).seq, first.seq);
});

test('credential metadata and recognizable credential text never enter persisted context', t => {
  const { store } = fixture(t);
  store.append(event('credentials', 'g:1', { text: 'Authorization: Bearer example-secret-value\napi_key=abcdefghi', meta: { token: 'secret-token', nested: { password: 'secret-password' }, messageId: 'ok' } }));
  const encoded = JSON.stringify(store.get('credentials'));
  assert.doesNotMatch(encoded, /example-secret-value|abcdefghi|secret-token|secret-password/);
  assert.match(store.context({ channel: 'g:1' }).text, /带来源/);
});

test('router persists promptly, dispatches once and resumes without duplicate dispatch after restart', async t => {
  const f = fixture(t);
  const deliveries = [];
  const options = { assess: async ({ events }) => ({ actions: events.map(e => ({ eventId: e.id, kind: 'respond' })) }), dispatch: async (action, e) => deliveries.push({ action, id: e.id }) };
  const router = f.router(options);
  await router.ingest(event('incoming'));
  assert.ok(f.store.get('incoming'));
  await until(() => router.status().counts.dispatched === 1);
  await router.ingest(event('incoming'));
  await router.close();
  f.restart();
  const resumed = f.router(options);
  resumed.tick();
  await delay(30);
  assert.deepEqual(deliveries.map(d => d.id), ['incoming']);
  assert.ok(deliveries[0].action.dispatchId);
});

test('fresh confirmed self-message reaches dispatch context and sent feedback never triggers another reply', async t => {
  const f = fixture(t);
  let release;
  const started = [];
  const dispatched = [];
  const router = f.router({ assess: async ({ events }) => { started.push(events[0].id); await new Promise(resolve => { release = resolve; }); return { actions: [{ eventId: events[0].id, kind: 'respond' }] }; }, dispatch: async (action, e, context) => dispatched.push(context) });
  await router.ingest(event('question', 'g:2'));
  await until(() => release);
  await router.ingest(event('self-live', 'g:1', { kind: 'message.sent', text: 'Confirmed in A', meta: { messageId: 'receipt' } }));
  release();
  await until(() => router.status().counts.dispatched === 1);
  assert.match(dispatched[0].text, /Confirmed in A/);
  assert.deepEqual(started, ['question']);
});

test('assessor timeout cannot permanently block another channel and late result cannot dispatch', async t => {
  const f = fixture(t);
  let late;
  const delivered = [];
  const router = f.router({ timeoutMs: 20, policy: { maxAttempts: 1 }, assess: async ({ events }) => events[0].id === 'slow' ? new Promise(resolve => { late = resolve; }) : { actions: [{ eventId: events[0].id, kind: 'respond' }] }, dispatch: async (a, e) => delivered.push(e.id) });
  await router.ingest(event('slow', 'g:1'));
  await until(() => late);
  await router.ingest(event('fast', 'g:2'));
  await until(() => delivered.includes('fast'));
  late({ actions: [{ eventId: 'slow', kind: 'respond' }] });
  await delay(30);
  assert.deepEqual(delivered, ['fast']);
  assert.equal(router.status().counts.failed, 1);
  assert.ok(router.status().errors.some(e => e.code === 'assessment_timeout'));
});

test('assessment errors retry boundedly, preserving later events and bounded diagnostics', async t => {
  const f = fixture(t);
  const router = f.router({ timeoutMs: 100, policy: { maxAttempts: 2, retryDelayMs: 1 }, assess: async () => { throw new Error('token=DO_NOT_LOG_ME'); }, dispatch: async () => assert.fail('must not dispatch') });
  await router.ingest(event('fail'));
  await until(() => router.status().counts.failed === 1);
  assert.equal(f.store.db.prepare('SELECT attempts FROM core_router WHERE event_id = ?').get('fail').attempts, 2);
  assert.doesNotMatch(JSON.stringify(router.status()), /DO_NOT_LOG_ME/);
});

test('untrusted foreign action IDs and duplicate actions are rejected; private batches remain isolated', async t => {
  const f = fixture(t);
  const seen = [];
  const deliveries = [];
  const router = f.router({ assess: async ({ events, context }) => { seen.push({ events, context }); return { actions: [{ eventId: 'foreign', kind: 'respond' }, ...events.flatMap(e => [{ eventId: e.id, kind: 'respond' }, { eventId: e.id, kind: 'task' }])] }; }, dispatch: async (a, e) => deliveries.push(e.id) });
  await router.ingest(event('private-input', 'p:7', { text: 'PRIVATE UNIQUE' }));
  await router.ingest(event('group-input', 'g:1'));
  await until(() => router.status().counts.dispatched === 2);
  assert.deepEqual(deliveries.sort(), ['group-input', 'private-input']);
  assert.ok(seen.every(s => new Set(s.events.map(e => e.channel)).size === 1));
  assert.doesNotMatch(seen.find(s => s.events[0].channel === 'g:1').context.text, /PRIVATE UNIQUE/);
});

test('task results reenter assessment while dispatch uncertainty survives restart without retry', async t => {
  const f = fixture(t);
  const deliveries = [];
  const assess = async ({ events }) => ({ actions: events.map(e => ({ eventId: e.id, kind: e.kind === 'task.result' ? 'observe' : 'task' })) });
  const router = f.router({ timeoutMs: 20, assess, dispatch: async (a, e) => { deliveries.push(e.id); if (e.id === 'uncertain') return new Promise(() => {}); await router.ingest(event('result', e.channel, { kind: 'task.result', text: 'work complete' })); } });
  await router.ingest(event('job'));
  await until(() => router.status().counts.observed === 1);
  await router.ingest(event('uncertain'));
  await until(() => router.status().counts.uncertain === 1);
  await router.close();
  f.restart();
  const resumed = f.router({ assess, dispatch: async (a, e) => deliveries.push(e.id) });
  resumed.tick();
  await delay(30);
  assert.deepEqual(deliveries, ['job', 'uncertain']);
  assert.equal(resumed.status().counts.uncertain, 1);
});

test('policy preserves blocked evidence without dispatch and shutdown aborts pending assessment', async t => {
  const f = fixture(t);
  let signal;
  const router = f.router({ policy: { allowChannels: ['g:1'] }, assess: async input => { signal = input.signal; return new Promise(() => {}); }, dispatch: async () => assert.fail('must not dispatch') });
  await router.ingest(event('blocked', 'g:9'));
  assert.ok(f.store.get('blocked'));
  await router.ingest(event('active', 'g:1'));
  await until(() => signal);
  await router.close();
  assert.equal(signal.aborted, true);
  assert.equal(router.status().closed, true);
  await assert.rejects(router.ingest(event('after-close')), /closed/);
});

test('restart resumes undispatched decisions but quarantines a crash during external dispatch', async t => {
  const f = fixture(t);
  const router = f.router({ assess: async () => ({ actions: [] }), dispatch: async () => {} });
  await router.close();
  for (const [id, state] of [['not-started', 'decided'], ['crashed-send', 'dispatching'], ['interrupted-assessment', 'assessing']]) {
    const e = f.store.append(event(id));
    f.store.db.prepare('INSERT INTO core_router(event_id,seq,state,action,updated_at) VALUES(?,?,?,?,?)').run(id, e.seq, state, JSON.stringify({ eventId: id, kind: 'respond', dispatchId: `stable:${id}` }), Date.now());
  }
  f.restart();
  const delivered = [];
  const resumed = f.router({ assess: async ({ events }) => ({ actions: events.map(e => ({ eventId: e.id, kind: 'observe' })) }), dispatch: async (a, e) => delivered.push({ id: e.id, key: a.dispatchId }) });
  await until(() => resumed.status().counts.observed === 1 && resumed.status().counts.dispatched === 1);
  assert.deepEqual(delivered, [{ id: 'not-started', key: 'stable:not-started' }]);
  assert.equal(resumed.status().counts.uncertain, 1);
});

test('single-channel batches stay bounded and contexts enforce character budget including quotes', async t => {
  const f = fixture(t);
  for (let n = 0; n < 9; n++) f.store.append(event(`queued-${n}`, 'g:1', { text: '\\"\n'.repeat(2000) }));
  const context = f.store.context({ channel: 'g:1', maxChars: 512 });
  assert.ok(context.text.length <= 512);
  assert.ok(context.events.length > 0);
  const batches = [];
  let active = 0;
  const router = f.router({ policy: { maxBatch: 3 }, assess: async ({ events }) => { assert.equal(active++, 0); batches.push(events.length); await delay(5); active--; return { actions: [] }; }, dispatch: async () => assert.fail('no actions') });
  await until(() => router.status().counts.observed === 9);
  assert.deepEqual(batches, [3, 3, 3]);
});

test('priority context truncates large self messages fairly so current group question remains visible', t => {
  const { store } = fixture(t);
  store.append(event('large-self', 'g:1', { kind: 'message.sent', text: 'A'.repeat(5000), meta: { messageId: 'receipt-long' } }));
  store.append(event('current-question', 'g:2', { text: 'What should happen now?' }));
  const context = store.context({ channel: 'g:2', maxChars: 1200 });
  assert.match(context.text, /What should happen now/);
  assert.ok(context.events.some(e => e.id === 'large-self'));
});

test('busy group traffic cannot evict the latest confirmed self fact from recall', t => {
  const { store } = fixture(t);
  store.append(event('important-self', 'g:1', { kind: 'message.sent', text: 'The agreed date is Tuesday', meta: { messageId: 'receipt-priority' } }));
  for (let n = 0; n < 205; n++) store.append(event(`busy-${n}`, 'g:2'));
  assert.match(store.context({ channel: 'g:2', limit: 4 }).text, /agreed date is Tuesday/);
});

test('Bili public events share group recall while private and operator channels remain isolated', t => {
  const { store } = fixture(t);
  store.append(event('private-only', 'p:7'));
  store.append(event('operator-only', 'operator:root'));
  store.append(event('group-fact', 'g:1'));
  store.append(event('watched-video', 'bili:public', { kind: 'task.result', text: 'Watched a public video about Saturn' }));
  store.append(event('bili-comment', 'bili:public', { kind: 'message.sent', text: 'Confirmed a comment about Saturn', meta: { messageId: 'rpid:321' } }));
  assert.deepEqual(store.recent({ channel: 'g:2' }).map(e => e.id), ['group-fact', 'watched-video', 'bili-comment']);
  assert.deepEqual(store.recent({ channel: 'bili:public' }).map(e => e.id), ['group-fact', 'watched-video', 'bili-comment']);
  assert.deepEqual(store.recent({ channel: 'bili:public', groups: false }).map(e => e.id), ['watched-video', 'bili-comment']);
  assert.deepEqual(store.recent({ channel: 'g:1', groups: false }).map(e => e.id), ['group-fact']);
  for (const channel of ['g:2', 'bili:public']) {
    const context = store.context({ channel });
    assert.match(context.text, /Saturn/);
    assert.match(context.text, /group-fact/);
    assert.doesNotMatch(context.text, /private-only|operator-only/);
  }
  assert.deepEqual(store.context({ channel: 'p:7' }).events.map(e => e.id), ['private-only']);
  assert.deepEqual(store.context({ channel: 'operator:root' }).events.map(e => e.id), ['operator-only']);
  assert.throws(() => store.append(event('other-bili', 'bili:private')), /channel/);
});

test('Bili confirmed publishing is prioritized across public scopes without self-triggering dispatch', async t => {
  const f = fixture(t);
  f.store.append(event('bili-confirmed', 'bili:public', { kind: 'message.sent', text: 'Posted a public dynamic', meta: { messageId: 'dynamic:99' } }));
  for (let n = 0; n < 205; n++) f.store.append(event(`public-noise-${n}`, 'g:1'));
  assert.match(f.store.context({ channel: 'g:2', limit: 2 }).text, /Posted a public dynamic/);
  assert.match(f.store.context({ channel: 'bili:public', limit: 2 }).text, /Posted a public dynamic/);
  const assessed = [];
  const router = f.router({ assess: async ({ events }) => { assessed.push(...events.map(e => e.id)); return { actions: [] }; }, dispatch: async () => assert.fail('observe only') });
  await router.ingest(event('bili-observation', 'bili:public', { kind: 'task.result' }));
  await until(() => router.status().counts.observed === 207);
  assert.ok(assessed.includes('bili-observation'));
  assert.ok(!assessed.includes('bili-confirmed'));
});

test('Bili DMs keep received and confirmed sent events within the exact platform and peer', t => {
  const f = fixture(t);
  for (const [id, channel] of [['dm-one', 'bili:dm:7'], ['dm-two', 'bili:dm:8'], ['qq-private', 'p:7'], ['group', 'g:1'], ['public-bili', 'bili:public']]) {
    f.store.append(event(id, channel));
    f.store.append(event(id + '-sent', channel, {kind:'message.sent', meta:{messageId:id + '-receipt'}}));
  }
  f.restart();
  for (const [channel, expected] of [
    ['bili:dm:7', ['dm-one', 'dm-one-sent']], ['bili:dm:8', ['dm-two', 'dm-two-sent']],
    ['p:7', ['qq-private', 'qq-private-sent']],
    ['g:2', ['group', 'group-sent', 'public-bili', 'public-bili-sent']],
    ['bili:public', ['group', 'group-sent', 'public-bili', 'public-bili-sent']],
  ]) {
    assert.deepEqual(f.store.recent({channel}).map(e => e.id), expected, channel);
    assert.deepEqual(f.store.context({channel}).events.map(e => e.id), expected, channel);
  }
  for (const channel of ['bili:dm:', 'bili:dm:abc', 'bili:dm:7:8', 'bili:private']) {
    assert.throws(() => f.store.append(event('invalid-' + channel, channel)), /channel/);
  }
});
