// End-to-end checks for prompt observability: what the runtime sends to a model
// is recorded segment by segment, the console can list every prompt, and the
// prompts page is served like the other owner-only pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createRuntime} from '../src/host/runtime.mjs';
import {registerConsole} from '../src/host/console.mjs';
import {registerManagement} from '../src/host/management.mjs';
import {liveConversationContext} from '../src/host/conversation-summary.mjs';

const incoming = (id: string, channel: string, text = id) => ({id, kind: 'message.received', channel, actorId: '10001', text, meta: {addressed: true, messageId: id}});
async function until(condition: () => any) { for (let n = 0; n < 400; n++) { if (condition()) return; await delay(5); } assert.fail('Runtime condition timed out'); }

async function fixture(t: any, {persona = 'Fixture fish persona', secret = ''}: {persona?: string; secret?: string} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chopsticks-prompts-'));
  const fishHome = path.join(dir, 'fish'), stateDir = path.join(dir, 'state');
  fs.mkdirSync(path.join(fishHome, 'characters', 'fish'), {recursive: true});
  fs.writeFileSync(path.join(fishHome, 'characters', 'current.json'), JSON.stringify({id: 'fish'}));
  fs.writeFileSync(path.join(fishHome, 'characters', 'fish', 'persona.md'), persona);
  const assessments: any[] = [], deliveries: any[] = [];
  let runtime: any;
  const controller = {
    async selectModel() {}, async inspect(sessionId: any) { return {sessionId}; }, async resolveAgent() {},
    async prompt(input: any) {
      const text = input.content[0].text;
      if (input.sessionId.startsWith('chopsticks-router-')) {
        const events = JSON.parse(text.split('待判断事件：\n')[1]);
        assessments.push({...input, text});
        queueMicrotask(() => runtime.decide(input.sessionId, JSON.stringify(events.map((e: any) => ({eventId: e.id, kind: 'respond'})))));
      } else deliveries.push({...input, text});
      return {accepted: true};
    }, async cancel() {}, async updateQueue() {},
  };
  const adapterFactory = () => ({async start() {}, close() {}, hydrateEvents() {}, async send() { return {}; }});
  runtime = await createRuntime({config: {stateDir, fishHome, qq: {enabled: false, allowUsers: ['10001'], allowGroups: ['1'], ...(secret ? {token: secret} : {})}, bili: {enabled: false}, routerTimeoutMs: 1000}, controller, adapterFactory, archiveRouterSession: async () => {}, releaseRouterSession: async () => {}});
  await runtime.start();
  t.after(async () => { await runtime.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  return {runtime, assessments, deliveries, fishHome};
}
const rebuilt = (runtime: any, render: any) => render.segments.map((s: any) => runtime.telemetry.decisions.segment(s.hash)).join('');

test('the Router decision prompt is recorded with its source ids and can be rebuilt exactly', async (t) => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('m1', 'g:1', '大肥鱼在吗'));
  await until(() => f.deliveries.length === 1);
  const renders = f.runtime.telemetry.decisions.renders({promptId: 'router.decide'}).items;
  assert.equal(renders.length, 1);
  assert.equal(renders[0].eventId, 'm1');
  assert.equal(renders[0].channel, 'g:1');
  assert.equal(renders[0].requestId, f.assessments[0].requestId);
  assert.equal(renders[0].sessionId, f.assessments[0].sessionId);
  assert.equal(rebuilt(f.runtime, renders[0]), f.assessments[0].text);
  assert.equal(renders[0].chars, f.assessments[0].text.length);
  assert.deepEqual(renders[0].segments.filter((s: any) => s.kind === 'runtime').map((s: any) => s.slot), ['context', 'events']);
});

test('the dispatch prompt is recorded with persona as a config segment and literals as static ones', async (t) => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('m1', 'g:1', '大肥鱼在吗'));
  await until(() => f.deliveries.length === 1);
  const renders = f.runtime.telemetry.decisions.renders({promptId: 'dispatch.respond'}).items;
  assert.equal(renders.length, 1);
  assert.equal(renders[0].eventId, 'm1');
  assert.equal(renders[0].requestId, f.deliveries[0].requestId);
  assert.equal(renders[0].sessionId, f.deliveries[0].sessionId);
  assert.equal(rebuilt(f.runtime, renders[0]), f.deliveries[0].text);
  const persona = renders[0].segments.find((s: any) => s.slot === 'persona');
  assert.equal(persona.kind, 'config');
  assert.equal(f.runtime.telemetry.decisions.segment(persona.hash), 'Fixture fish persona');
  assert.ok(renders[0].segments.some((s: any) => s.slot === '@social.reply-rule' && s.kind === 'static'));
  assert.equal(renders[0].snapshotId, f.runtime.telemetry.decisions.currentSnapshot());
});

test('starting the runtime records one snapshot of what shapes processing; an unchanged restart keeps its id', async (t) => {
  const f = await fixture(t);
  const log = f.runtime.telemetry.decisions, id = log.currentSnapshot();
  assert.ok(Number.isSafeInteger(id) && id > 0);
  const value = log.snapshots({limit: 1}).items[0].value;
  for (const key of ['prompts', 'rules', 'persona', 'presets', 'config']) assert.match(value[key], /^[0-9a-f]{64}$/, `snapshot must carry a ${key} hash`);
  assert.equal(value.version, '0.1.0');
  assert.doesNotMatch(JSON.stringify(value), /Fixture fish persona/);
});

test('the snapshot id moves when the persona file changes between starts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chopsticks-prompts-'));
  const fishHome = path.join(dir, 'fish'), stateDir = path.join(dir, 'state'), personaFile = path.join(fishHome, 'characters', 'fish', 'persona.md');
  fs.mkdirSync(path.dirname(personaFile), {recursive: true});
  fs.writeFileSync(path.join(fishHome, 'characters', 'current.json'), JSON.stringify({id: 'fish'}));
  const controller = {async selectModel() {}, async inspect(sessionId: any) { return {sessionId}; }, async resolveAgent() {}, async prompt() { return {accepted: true}; }, async cancel() {}, async updateQueue() {}};
  const open = async (persona: string) => {
    fs.writeFileSync(personaFile, persona);
    const runtime: any = await createRuntime({config: {stateDir, fishHome, qq: {enabled: false}, bili: {enabled: false}}, controller, adapterFactory: () => ({async start() {}, close() {}, hydrateEvents() {}}), archiveRouterSession: async () => {}, releaseRouterSession: async () => {}});
    await runtime.start();
    return runtime;
  };
  let runtime = await open('Original persona');
  t.after(async () => { await runtime.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  const before = runtime.telemetry.decisions.snapshots({limit: 1}).items[0];
  await runtime.close();
  runtime = await open('Original persona');
  assert.equal(runtime.telemetry.decisions.currentSnapshot(), before.id, 'nothing changed, so the snapshot id is reused');
  await runtime.close();
  runtime = await open('Edited persona');
  const after = runtime.telemetry.decisions.snapshots({limit: 1}).items[0];
  assert.ok(after.id > before.id);
  assert.notEqual(after.value.persona, before.value.persona);
  assert.equal(after.value.prompts, before.value.prompts);
});

test('the prompts endpoint lists every registered prompt with its last use', async (t) => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('m1', 'g:1', '大肥鱼在吗'));
  await until(() => f.deliveries.length === 1);
  const view = f.runtime.queryConsole('prompts', {});
  assert.equal(view.snapshotId, f.runtime.telemetry.decisions.currentSnapshot());
  const byId = new Map(view.items.map((item: any) => [item.id, item]));
  for (const id of ['router.decide', 'dispatch.respond', 'social.reply-rule', 'persona.character', 'preset.qq-chat-v2', 'evolution.review'])
    assert.ok(byId.has(id), `prompts list must contain ${id}`);
  const decide: any = byId.get('router.decide');
  assert.equal(decide.node, 'router');
  assert.equal(decide.kind, 'assembled');
  assert.match(decide.lastRenderAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((byId.get('evolution.review') as any).lastRenderAt, null);
  assert.equal((byId.get('persona.character') as any).kind, 'config');
  assert.ok(!('text' in (byId.get('persona.character') as any)), 'the list carries no prompt bodies');
  assert.ok(view.external.length > 0 && view.external.every((row: any) => row.title && row.reason), 'prompt sources the host cannot read are listed, not omitted');
});

test('the prompt endpoint returns one definition with its current text and recent renders', async (t) => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('m1', 'g:1', '大肥鱼在吗'));
  await until(() => f.deliveries.length === 1);
  const persona = f.runtime.queryConsole('prompt', {id: 'persona.character'});
  assert.equal(persona.definition.text, 'Fixture fish persona');
  assert.match(persona.definition.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(persona.renders.items, []);
  const decide = f.runtime.queryConsole('prompt', {id: 'router.decide'});
  assert.ok(decide.definition.parts.some((part: any) => part.include === 'social.reply-rule'));
  assert.equal(decide.renders.items.length, 1);
  assert.equal(decide.renders.items[0].eventId, 'm1');
  assert.ok(!('text' in decide.renders.items[0].segments[0]), 'render rows list segments without bodies');
  const expanded = f.runtime.queryConsole('prompt', {id: 'router.decide', seq: decide.renders.items[0].seq});
  assert.equal(expanded.render.segments.map((s: any) => s.text).join(''), f.assessments[0].text);
  assert.equal(expanded.render.seq, decide.renders.items[0].seq);
  assert.equal(f.runtime.queryConsole('prompt', {id: 'dispatch.respond', seq: decide.renders.items[0].seq}).render, null, 'a render is only returned under its own prompt');
  assert.throws(() => f.runtime.queryConsole('prompt', {id: 'no.such-prompt'}), /Unknown prompt/);
});

test('an expanded render reports an evicted segment instead of inventing its text', async (t) => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('m1', 'g:1', '大肥鱼在吗'));
  await until(() => f.deliveries.length === 1);
  const seq = f.runtime.queryConsole('prompt', {id: 'dispatch.respond'}).renders.items[0].seq;
  const personaHash = f.runtime.telemetry.decisions.renders({promptId: 'dispatch.respond'}).items[0].segments.find((s: any) => s.slot === 'persona').hash;
  const db = new (await import('node:sqlite')).DatabaseSync(path.join(path.dirname(f.fishHome), 'state', 'traces.sqlite'));
  db.prepare('DELETE FROM prompt_segments WHERE hash=?').run(personaHash); db.close();
  const persona = f.runtime.queryConsole('prompt', {id: 'dispatch.respond', seq}).render.segments.find((s: any) => s.slot === 'persona');
  assert.equal(persona.text, null);
  assert.equal(persona.missing, true);
});

test('configured secrets are redacted from external prompt text shown in the console', async (t) => {
  const f = await fixture(t, {persona: '人设里误写了 nested-credential-value 这样的口令', secret: 'nested-credential-value'});
  const text = f.runtime.queryConsole('prompt', {id: 'persona.character'}).definition.text;
  assert.doesNotMatch(text, /nested-credential-value/);
  assert.match(text, /\[REDACTED\]/);
});

test('the live conversation context keeps its text and is produced through the catalog', async (t) => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('m1', 'g:1', '大肥鱼在吗'));
  await until(() => f.deliveries.length === 1);
  f.runtime.state.put('conversation-summary', 'g:1', {channel: 'g:1', text: '之前聊过天气'});
  const fresh = f.runtime.store.context({channel: 'g:1'});
  const live: any = liveConversationContext(f.runtime, 'g:1');
  assert.equal(live.text, `会话摘要（g:1）：\n之前聊过天气\n当前可用经历：\n${fresh.text}`);
  assert.equal(live.revision, fresh.revision);
  assert.equal(live.fragment.id, 'session.live-context');
  assert.equal(live.fragment.text, live.text);
});

test('the live context is recorded once per session until its text changes', async (t) => {
  const f = await fixture(t);
  await f.runtime.ingest(incoming('m1', 'g:1', '大肥鱼在吗'));
  await until(() => f.deliveries.length === 1);
  const sessionId = f.deliveries[0].sessionId, rows = () => f.runtime.telemetry.decisions.renders({promptId: 'session.live-context'}).items;
  const first: any = liveConversationContext(f.runtime, 'g:1');
  f.runtime.recordContext(sessionId, 'g:1', first.fragment);
  f.runtime.recordContext(sessionId, 'g:1', (liveConversationContext(f.runtime, 'g:1') as any).fragment);
  assert.equal(rows().length, 1, 'an unchanged context is not recorded again');
  assert.equal(rows()[0].sessionId, sessionId);
  assert.equal(rows()[0].eventId, 'm1');
  assert.equal(rebuilt(f.runtime, rows()[0]), first.text);
  f.runtime.state.put('conversation-summary', 'g:1', {channel: 'g:1', text: '之前聊过天气'});
  f.runtime.recordContext(sessionId, 'g:1', (liveConversationContext(f.runtime, 'g:1') as any).fragment);
  assert.equal(rows().length, 2);
  assert.doesNotThrow(() => f.runtime.recordContext(sessionId, 'g:1', undefined));
  assert.doesNotThrow(() => f.runtime.recordContext('unbound-session', 'g:1', first.fragment));
});

test('tools registered by the host are listed with their descriptions and change the registry hash', async (t) => {
  const f = await fixture(t), before = f.runtime.prompts.hash();
  assert.equal(f.runtime.listTool({name: 'chopsticks_send', description: '给当前 QQ 会话发送消息。', parameters: {text: {type: 'string'}}, source: 'src/host/index.mts'}), 'tool.chopsticks-send');
  assert.equal(f.runtime.listTool({name: 'chopsticks_send', description: '重复', source: 'src/host/index.mts'}), null);
  const item = f.runtime.queryConsole('prompts', {}).items.find((row: any) => row.id === 'tool.chopsticks-send');
  assert.equal(item.node, 'act');
  assert.equal(f.runtime.queryConsole('prompt', {id: 'tool.chopsticks-send'}).definition.text, '给当前 QQ 会话发送消息。');
  assert.notEqual(f.runtime.prompts.hash(), before);
});

const capture = (register: any) => { const routes: any[] = []; register({inject(_deps: any, fn: any) { return fn({connection: {fetch: {register(route: any) { routes.push(route); return () => {}; }}}}); }}); return routes; };
const envelope = (endpoint: string, payload: any) => new Request('http://localhost/api/chopsticks-console', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({type: 'client-request', rpcId: 'p', method: 'chopsticks-console', payload: {endpoint, payload}})});

test('prompt RPC endpoints accept only bounded read queries', async () => {
  const calls: any[] = [];
  const route = capture((ctx: any) => registerConsole(ctx, {queryConsole(endpoint: any, payload: any) { calls.push({endpoint, payload}); return {items: []}; }}))[0];
  const ok = async (endpoint: string, payload: any) => (await (await route.fetch(envelope(endpoint, payload))).json()).result.ok;
  assert.equal(await ok('prompts', {}), true);
  for (const payload of [{id: 'router.decide'}, {id: 'router.decide', limit: 20, beforeSeq: 9}, {id: 'router.decide', seq: 4}]) assert.equal(await ok('prompt', payload), true);
  assert.equal(calls.length, 4);
  for (const payload of [{id: 'x'}, {limit: 5}]) assert.equal(await ok('prompts', payload), false);
  for (const payload of [{}, {id: 7}, {id: 'Router.Decide'}, {id: 'a.' + 'b'.repeat(90)}, {id: 'router.decide', limit: 101}, {id: 'router.decide', limit: 0}, {id: 'router.decide', beforeSeq: -1}, {id: 'router.decide', seq: 1.5}, {id: 'router.decide', seq: 0}, {id: 'router.decide', action: 'delete'}, {id: 'router.decide', text: 'new prompt'}])
    assert.equal(await ok('prompt', payload), false);
  assert.equal(calls.length, 4, 'rejected queries never reach the runtime');
});

test('the prompts page is served on exact owner-only routes and linked from the other pages', async () => {
  const routes = capture(registerManagement);
  for (const suffix of ['prompts', 'prompts.js', 'prompts.css']) {
    const route = routes.find((r: any) => r.path === '/api/chopsticks/' + suffix);
    assert.ok(route, `missing route ${suffix}`);
    assert.deepEqual(route.methods, ['GET']);
    const response = await route.fetch();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Security-Policy'), /script-src 'self'; style-src 'self'/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const body = await response.text();
    if (suffix === 'prompts') {
      assert.doesNotMatch(body, /<script(?![^>]*src=)|<style|\son\w+=|https?:\/\//);
      for (const href of ['/api/chopsticks', '/api/chopsticks/mood', '/api/chopsticks/pipeline']) assert.match(body, new RegExp(`href="${href}"`));
    }
    if (suffix === 'prompts.js') assert.doesNotMatch(body, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/, 'prompt text is untrusted and must only be set as text');
  }
  for (const page of ['/api/chopsticks', '/api/chopsticks/mood', '/api/chopsticks/pipeline'])
    assert.match(await (await routes.find((r: any) => r.path === page).fetch()).text(), /href="\/api\/chopsticks\/prompts"/);
});
