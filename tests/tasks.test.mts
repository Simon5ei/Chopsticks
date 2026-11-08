import test from 'node:test';
test('restored background sessions adopt the configured model without recreating their history',async()=>{
 const selected=[];const executor=createDshExecutor({controller:{inspect:async()=>({events:[]}),create:async()=>{throw Error('must not recreate');},selectModel:async (value?: any) =>selected.push(value)},workerRoot:'unused',model:{provider:'deepseek-official',model:'deepseek-flash'}});
 await executor.ensureSession({sessionId:'existing-worker'});
 assert.deepEqual(selected,[{sessionId:'existing-worker',provider:'deepseek-official',model:'deepseek-flash'}]);
});
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCoordinator } from '../src/tasks/coordinator.mjs';
import { createDshExecutor } from '../src/tasks/dsh-executor.mjs';

const origin = { role: 'qq', sessionId: 'fish-session', chatKey: 'g:20001', characterId: 'fish' };
function setup(t?: any, overrides: Record<string, any> = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chopsticks-task-test-'));
  const prompts = [], results = [], launched = [], aborted = [];
  const options = { stateDir, autoStart: false, executor: {
    ensureSession: async (r?: any) => launched.push(r), prompt: async (r?: any) => { prompts.push(r); return { accepted: true }; },
    abort: async (r?: any) => aborted.push(r), inspect: async () => ({ status: 'unknown' }), ...overrides.executor },
    deliverResult: async (r?: any) => { results.push(r); return { accepted: true }; }, ...overrides };
  const coordinator = createCoordinator(options);
  t.after(async () => { await coordinator.close(); fs.rmSync(stateDir, { recursive: true, force: true }); });
  return { coordinator, options, stateDir, prompts, results, launched, aborted };
}
test('tasks persist request idempotency and accepted worker delivery through restart', async (t?: any) => {
  const f = setup(t); const first = await f.coordinator.submit(origin, { requestId: 'stable', prompt: 'Read public sources' });
  await f.coordinator.flush(); assert.equal(f.prompts.length, 1); assert.match(f.prompts[0].sessionId, /^chopsticks-worker-/);
  await f.coordinator.close(); const reopened = createCoordinator(f.options); t.after(() => reopened.close());
  const same = await reopened.submit(origin, { requestId: 'stable', prompt: 'Read public sources' });
  assert.equal(same.id, first.id); await reopened.flush(); assert.equal(f.prompts.length, 1);
  await assert.rejects(reopened.submit(origin, { requestId: 'stable', prompt: 'Changed instruction' }), /conflict/);
  await reopened.close();
});
test('only bound worker can report and final result is delivered once to origin', async (t?: any) => {
  const f = setup(t); const task = await f.coordinator.submit(origin, { requestId: 'report', prompt: 'Find information' });
  await f.coordinator.flush(); const worker = f.coordinator.getWorkerContext(f.prompts[0].sessionId);
  assert.equal(worker.chatKey, origin.chatKey); assert.equal(worker.canWrite, false);
  const result = { ticketId: task.id, state: 'ready', summary: 'Verified finding', deliveryId: f.prompts[0].deliveryId };
  await assert.rejects(f.coordinator.report(origin, result), /Worker/);
  await f.coordinator.report(worker, result); await f.coordinator.flush();
  assert.equal(f.results.length, 1); assert.equal(f.results[0].sessionId, origin.sessionId);
  await f.coordinator.report(worker, result); await f.coordinator.flush(); assert.equal(f.results.length, 1);
});
test('task scopes block other groups and workers cannot delegate', async (t?: any) => {
  const f = setup(t); const task = await f.coordinator.submit(origin, { requestId: 'scope', prompt: 'Read' }); await f.coordinator.flush();
  const other = { ...origin, chatKey: 'g:20002', sessionId: 'other' };
  assert.deepEqual(await f.coordinator.status(other), []); await assert.rejects(f.coordinator.status(other, task.id), /scope/);
  const worker = f.coordinator.getWorkerContext(f.prompts[0].sessionId);
  await assert.rejects(f.coordinator.submit(worker, { requestId: 'nested', prompt: 'More' }), /cannot delegate/);
});
test('uncertain task delivery survives restart without replay until receipt proves not-found', async (t?: any) => {
  let attempts = 0, receipt = 'unknown';
  const executor = { ensureSession: async () => {}, abort: async () => {}, prompt: async () => { attempts++; throw new Error('lost acknowledgement'); }, inspect: async () => ({ status: receipt }) };
  const f = setup(t, { executor }); const task = await f.coordinator.submit(origin, { requestId: 'uncertain', prompt: 'Read' });
  await f.coordinator.flush(); assert.equal(attempts, 1); assert.equal((await f.coordinator.status(origin, task.id)).deliveryState, 'uncertain');
  await f.coordinator.close(); const reopened = createCoordinator(f.options); t.after(() => reopened.close());
  await reopened.flush(); assert.equal(attempts, 1); receipt = 'accepted'; await reopened.flush(); assert.equal(attempts, 1);
  assert.equal((await reopened.status(origin, task.id)).deliveryState, 'settled'); await reopened.close();
});
test('cancellation stops pending task and prevents delivery', async (t?: any) => {
  const f = setup(t); const task = await f.coordinator.submit(origin, { requestId: 'stop', prompt: 'Read' });
  await f.coordinator.stop(origin, task.id); await f.coordinator.flush(); assert.equal(f.prompts.length, 0);
  assert.equal((await f.coordinator.status(origin, task.id)).state, 'stopped');
  await assert.rejects(f.coordinator.follow(origin, task.id, 'continue'), /stopped/);
});
test('single-owner task journal rejects a second active coordinator', async (t?: any) => {
  const f = setup(t); assert.throws(() => createCoordinator(f.options), /active owner/);
});
test('completed worker without report becomes waiting and keeps task resumable', async (t?: any) => {
  const f = setup(t); const task = await f.coordinator.submit(origin, { requestId: 'ended', prompt: 'Read' }); await f.coordinator.flush();
  await f.coordinator.workerEnded(f.prompts[0].sessionId); await f.coordinator.flush();
  assert.equal((await f.coordinator.status(origin, task.id)).state, 'waiting'); assert.equal(f.results.length, 1);
  await f.coordinator.follow(origin, task.id, 'Use a second source'); await f.coordinator.flush(); assert.equal(f.prompts.length, 2);
});
test('DSH executor selects research preset and preserves task input', async (t?: any) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chopsticks-executor-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const creates = [], prompts = [];
  const executor = createDshExecutor({ workerRoot: root, controller: { inspect: async () => { throw Object.assign(new Error('absent'), { code: 'session/not-found' }); },
    create: async (r?: any) => { creates.push(r); return { sessionId: r.sessionId }; }, prompt: async (r?: any) => { prompts.push(r); return { accepted: true }; } } });
  await executor.ensureSession({ sessionId: 'chopsticks-worker-test' }); assert.equal(creates[0].agentPreset, 'chopsticks-research-worker');
  await executor.prompt({ sessionId: 'chopsticks-worker-test', deliveryId: 'prompt:1', text: 'Task' });
  assert.match(prompts[0].content[0].text, /Task/); assert.equal(prompts[0].requestId, "prompt:1");
  assert.doesNotMatch(prompts[0].content[0].text, /surfcore/i);
});
test('DSH executor result callback replaces direct prompt and retains authorization guard', async () => {
  const callbacks = [], prompts = [];
  const executor = createDshExecutor({ controller: { prompt: async (r?: any) => prompts.push(r) }, onResult: async (r?: any) => { callbacks.push(r); return { accepted: true }; } });
  const data = { sessionId: 'origin', text: 'Result', deliveryId: 'result:1', isStillAuthorized: () => true };
  assert.deepEqual(await executor.deliverResult(data), { accepted: true }); assert.equal(callbacks.length, 1); assert.equal(callbacks[0].deliveryId, 'result:1'); assert.equal(prompts.length, 0);
  assert.deepEqual(await executor.deliverResult({ ...data, isStillAuthorized: () => false }), { accepted: false }); assert.equal(callbacks.length, 1);
});
test('DSH executor keeps default delivery and rechecks authorization after cold activation', async () => {
  let allowed = true; const prompts = [];
  const executor = createDshExecutor({ controller: { resolveAgent: async () => { allowed = false; }, prompt: async (r?: any) => prompts.push(r) } });
  assert.deepEqual(await executor.deliverResult({ sessionId: 'origin', text: 'Result', deliveryId: 'result:2', isStillAuthorized: () => allowed }), { accepted: false });
  assert.equal(prompts.length, 0);
  const defaultExecutor = createDshExecutor({ controller: { prompt: async (r?: any) => { prompts.push(r); return { accepted: true }; } } });
  await defaultExecutor.deliverResult({ sessionId: 'origin', text: 'Result', deliveryId: 'result:3' }); assert.equal(prompts.length, 1);
});

test('shared sessions deliver each ticket with its persisted origin through the result callback', async (t?: any) => {
  const callbacks = [], nativePrompts = [];
  const dsh = createDshExecutor({ controller: { prompt: async (r?: any) => nativePrompts.push(r) }, onResult: async (r?: any) => { callbacks.push(r); return { accepted: true }; } });
  const f = setup(t, { deliverResult: dsh.deliverResult });
  const firstCaller = { role: 'qq', sessionId: 'shared', chatKey: 'p:1', characterId: 'fish' };
  const secondCaller = { role: 'qq', sessionId: 'shared', chatKey: 'p:2', characterId: 'fish' };
  const first = await f.coordinator.submit(firstCaller, { requestId: 'one', prompt: 'First' });
  const second = await f.coordinator.submit(secondCaller, { requestId: 'two', prompt: 'Second' });
  firstCaller.chatKey = 'p:changed'; secondCaller.chatKey = 'p:changed';
  await f.coordinator.flush();
  for (const [task, prompt] of [[first, f.prompts[0]], [second, f.prompts[1]]]) {
    const worker = f.coordinator.getWorkerContext(prompt.sessionId);
    await f.coordinator.report(worker, { ticketId: task.id, state: 'ready', summary: 'Done', deliveryId: prompt.deliveryId });
  }
  await f.coordinator.flush();
  assert.deepEqual(callbacks.map(({ ticketId, origin }: { ticketId?: any; origin?: any; [key: string]: any }) => ({ ticketId, origin })), [
    { ticketId: first.id, origin: { sessionId: 'shared', chatKey: 'p:1', characterId: 'fish', role: 'qq' } },
    { ticketId: second.id, origin: { sessionId: 'shared', chatKey: 'p:2', characterId: 'fish', role: 'qq' } },
  ]);
  assert.ok(callbacks.every((r) => r.sessionId === 'shared' && r.deliveryId && r.text && r.signal && r.isStillAuthorized()));
  assert.equal(nativePrompts.length, 0);
  assert.deepEqual(await dsh.deliverResult({ ...callbacks[0], isStillAuthorized: () => false }), { accepted: false });
  assert.equal(callbacks.length, 2);
});
