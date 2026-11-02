import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRuntime } from '../host/runtime.mjs';

const incoming = (id, channel, meta = {}) => ({ id, kind: 'message.received', channel, actorId: '10001', text: id, meta: { addressed: true, messageId: id, ...meta } });
async function until(condition) { for (let n = 0; n < 400; n++) { if (condition()) return; await delay(5); } assert.fail('Runtime condition timed out'); }

async function fixture(t, { autoDecide = true, decideKind = 'respond', decidePrompt, timeoutMs = 1000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chopsticks-runtime-'));
  const fishHome = path.join(dir, 'fish'), stateDir = path.join(dir, 'state');
  fs.mkdirSync(path.join(fishHome, 'characters', 'fish'), { recursive: true });
  fs.writeFileSync(path.join(fishHome, 'characters', 'current.json'), JSON.stringify({ id: 'fish' }));
  fs.writeFileSync(path.join(fishHome, 'characters', 'fish', 'persona.md'), 'Fixture fish persona');
  const assessments = [], deliveries = [], sends = [], cancels = [];
  let runtime, adapterOptions;
  const controller = {
    async inspect(sessionId) { return { sessionId }; }, async resolveAgent() {},
    async prompt(input, signal) {
      assert.equal(input.mode, 'queue'); assert.ok(signal instanceof AbortSignal);
      const text = input.content[0].text;
      if (input.sessionId.startsWith('chopsticks-router-')) {
        const events = JSON.parse(text.split('待判断事件：\n')[1]);
        assessments.push({ ...input, text, events, signal });
        if (autoDecide) queueMicrotask(() => runtime.decide(input.sessionId, JSON.stringify(events.map(e => ({ eventId: e.id, kind: decideKind, ...(decidePrompt?{prompt:decidePrompt}:{}) })))));
      } else deliveries.push({ ...input, text, signal });
      return { accepted: true };
    }, async cancel(input) { cancels.push(input); }, async updateQueue() {},
  };
  const adapterFactory = options => {
    adapterOptions = options;
    return { async start() {}, close() {}, hydrateEvents() {},
      async send(input) {
        sends.push(input);
        const result = { id: `qq:${input.channel}:receipt-${sends.length}`, kind: 'message.sent', channel: input.channel, actorId: '90001', text: input.text, meta: { messageId: `receipt-${sends.length}` } };
        await options.onEvent(result); return result;
      },
    };
  };
  runtime = await createRuntime({ config: { stateDir, fishHome, qq: { enabled: false }, bili: { enabled: false }, routerTimeoutMs: timeoutMs }, controller, adapterFactory });
  await runtime.start();
  t.after(async () => { await runtime.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { runtime, assessments, deliveries, sends, cancels, adapterOptions };
}

test('runtime refreshes a group dispatch with self facts confirmed while assessment was running', async t => {
  const f = await fixture(t, { autoDecide: false });
  await f.adapterOptions.onEvent(incoming('question-in-B', 'g:2'));
  await until(() => f.assessments.length === 1);
  await f.runtime.ingest({ id: 'confirmed-in-A', kind: 'message.sent', channel: 'g:1', actorId: '90001', text: 'I already promised Tuesday in A', meta: { messageId: '111' } });
  f.runtime.decide(f.assessments[0].sessionId, JSON.stringify([{ eventId: 'question-in-B', kind: 'respond' }]));
  await until(() => f.deliveries.length === 1);
  assert.match(f.deliveries[0].text, /promised Tuesday in A/);
  assert.equal(f.runtime.caller(f.deliveries[0].sessionId).channel, 'g:2');
  assert.equal(f.runtime.caller(f.deliveries[0].sessionId).admin, false);
  assert.equal(f.sends.length, 0, 'model dispatch alone must never send QQ text');
});

test('runtime blocks stale outgoing text until fresh cross-group context is returned', async t => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('question', 'g:2'));
  await until(() => f.deliveries.length === 1);
  const sessionId = f.deliveries[0].sessionId;
  await f.runtime.ingest({ id: 'late-self', kind: 'message.sent', channel: 'g:1', actorId: '90001', text: 'Correction: Wednesday', meta: { messageId: '222' } });
  const stale = await f.runtime.send(sessionId, { text: 'Tuesday' });
  assert.equal(stale.sent, false);
  assert.equal(stale.reason, 'context_changed');
  assert.match(stale.context, /Correction: Wednesday/);
  assert.equal(f.sends.length, 0);
  const signal = new AbortController().signal;
  const confirmed = await f.runtime.send(sessionId, { text: 'Wednesday' }, signal);
  assert.equal(confirmed.kind, 'message.sent');
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].channel, 'g:2');
  assert.ok(f.sends[0].idempotencyKey);
  assert.equal(f.sends[0].signal, signal);
});

test('runtime separates private model evaluations and excludes passive or migrated evidence from routing', async t => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('PRIVATE_PAYLOAD', 'p:10001'));
  await until(() => f.deliveries.length === 1);
  await f.runtime.ingest(incoming('public-question', 'g:1'));
  await until(() => f.deliveries.length === 2);
  assert.notEqual(f.assessments[0].sessionId, f.assessments[1].sessionId);
  assert.doesNotMatch(f.assessments[1].text, /PRIVATE_PAYLOAD/);
  assert.doesNotMatch(f.deliveries[1].text, /PRIVATE_PAYLOAD/);
  await f.runtime.ingest({ id: 'passive-video', kind: 'task.result', channel: 'bili:public', actorId: 'fish', text: 'public watching evidence', meta: { passive: true, route: false } });
  await f.runtime.ingest(incoming('migrated-public', 'g:1', { migrated: true }));
  await until(() => f.runtime.router.status().counts.observed >= 2);
  assert.equal(f.assessments.length, 2);
  assert.match(f.runtime.store.context({ channel: 'g:2' }).text, /public watching evidence/);
});

test('runtime does not apply a queued request binding until that request is consumed', async t => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('first', 'g:1'));
  await until(() => f.deliveries.length === 1);
  const sessionId = f.deliveries[0].sessionId;
  await f.runtime.ingest(incoming('admin-followup', 'g:1', { admin: true }));
  await until(() => f.deliveries.length === 2);
  assert.equal(f.runtime.caller(sessionId).eventId, 'first');
  assert.equal(f.runtime.caller(sessionId).admin, false);
  f.runtime.event({ id: sessionId }, { type: 'user/message', data: { message: { source: { rpcId: f.deliveries[1].requestId } } } });
  assert.equal(f.runtime.caller(sessionId).eventId, 'admin-followup');
  assert.equal(f.runtime.caller(sessionId).admin, true);
});

test('runtime watchdog cancels a stuck model and ignores its late decision', async t => {
  const f = await fixture(t, { autoDecide: false, timeoutMs: 20 });
  await f.runtime.ingest(incoming('stuck', 'g:1'));
  await until(() => f.runtime.router.status().counts.failed === 1);
  assert.ok(f.cancels.length >= 1);
  for (const assessment of f.assessments) assert.throws(() => f.runtime.decide(assessment.sessionId, JSON.stringify([{ eventId: 'stuck', kind: 'respond' }])), /active/);
  assert.equal(f.deliveries.length, 0);
});

test('runtime rejects an already-cancelled send before transport or send-journal side effects', async t => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('cancel-source', 'g:1'));
  await until(() => f.deliveries.length === 1);
  const signal = AbortSignal.abort(new Error('fixture cancelled'));
  await assert.rejects(f.runtime.send(f.deliveries[0].sessionId, { text: 'must not send' }, signal), /cancelled/);
  assert.equal(f.sends.length, 0);
  assert.equal(f.runtime.store.db.prepare('SELECT COUNT(*) AS count FROM host_sends').get().count, 0);
});

test('runtime can dispatch a long source task when public context is already full', async t => {
  const f = await fixture(t, { decideKind: 'task', decidePrompt: 'TASK_INTENT_MARKER 比较资料中的差异。' + '任务要点'.repeat(2000) });
  for (let n = 0; n < 20; n++) await f.runtime.ingest({ id: `large-context-${n}`, kind: 'message.sent', channel: 'g:2', actorId: '90001', text: `Public fact ${n}: ` + 'x'.repeat(2000), meta: { messageId: String(1000 + n) } });
  const context = f.runtime.store.context({ channel: 'g:1' });
  assert.ok(context.text.length > 10000, 'fixture must fill the real context budget');
  await f.runtime.ingest({ ...incoming('long-task', 'g:1'), text: 'TASK_GOAL_MARKER 请比较这些公开资料。' + '长内容'.repeat(2000) });
  await until(() => {
    const counts = f.runtime.router.status().counts;
    return counts.dispatched + counts.uncertain + counts.failed > 0;
  });
  assert.equal(f.runtime.router.status().counts.dispatched, 1, 'long task must be accepted rather than rejected by coordinator prompt limit');
  const sessionId = f.runtime.mappings['g:1'];
  const tasks = await f.runtime.coordinator.status(f.runtime.caller(sessionId));
  assert.equal(tasks.length, 1);
  await until(() => f.deliveries.some(d => d.sessionId.startsWith('chopsticks-worker-')));
  const worker = f.deliveries.find(d => d.sessionId.startsWith('chopsticks-worker-'));
  assert.match(worker.text, /TASK_GOAL_MARKER/);
  assert.match(worker.text, /TASK_INTENT_MARKER/);
  assert.match(worker.text, /Public fact/);
});
