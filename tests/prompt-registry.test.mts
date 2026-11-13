import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const modulePath: string = '../src/host/prompt-registry.mjs';
let createPromptRegistry: any;
try { ({createPromptRegistry} = await import(modulePath)); } catch {}
let obs: any = {};
try { obs = await import('../src/host/observability.mjs'); } catch {}

const decision = {
  id: 'router.batch-decision', node: 'router', title: 'Router 批次决策', source: 'src/host/runtime.mts',
  parts: [
    {slot: 'rule', kind: 'static', ref: 'rule.social-reply'},
    {text: '\n结合本批事件调用 chopsticks_decide，元素 {eventId,kind:"observe"|"respond"}。'},
    {slot: 'mood', kind: 'runtime', optional: true},
    {text: '\n上下文：\n'},
    {slot: 'context', kind: 'runtime'},
    {slot: 'tasks', kind: 'runtime', optional: true, prefix: '\n相关任务：'},
    {text: '\n待判断事件：\n'},
    {slot: 'events', kind: 'runtime'},
  ],
};
const instruction = '\n结合本批事件调用 chopsticks_decide，元素 {eventId,kind:"observe"|"respond"}。';
function registry(log?: any) { const r = createPromptRegistry({log}); r.define(decision); return r; }

test('prompt registry exists', () => {
  assert.equal(typeof createPromptRegistry, 'function', 'prompt registry must be implemented');
});

test('render concatenates literal parts and slot values in declared order, braces included', () => {
  const text = registry().render('router.batch-decision', {rule: 'RULE', mood: '心境', context: 'CTX', tasks: '[1]', events: '[]'});
  assert.equal(text, 'RULE' + instruction + '心境\n上下文：\nCTX\n相关任务：[1]\n待判断事件：\n[]');
});

test('an empty optional slot is omitted together with its prefix; a missing required slot is an error', () => {
  const r = registry();
  for (const empty of [undefined, null, '']) {
    assert.equal(r.render('router.batch-decision', {rule: 'R', context: 'C', events: 'E', mood: empty, tasks: empty}), 'R' + instruction + '\n上下文：\nC\n待判断事件：\nE');
  }
  assert.throws(() => r.render('router.batch-decision', {rule: 'R', events: 'E'}), /context/);
  assert.throws(() => r.render('router.batch-decision', {rule: 'R', context: 5, events: 'E'}), /context/);
  assert.throws(() => r.render('router.batch-decision', {rule: 'R', context: 'C', events: 'E', extra: 'x'}), /extra/);
  assert.throws(() => r.render('unknown.prompt', {}), /unknown\.prompt/);
});

test('definitions are validated: unique well-formed ids, known nodes, well-formed parts', () => {
  const r = registry();
  assert.throws(() => r.define(decision), /already/i);
  const invalid = [
    {...decision, id: 'Bad Id'},
    {...decision, id: 'x'},
    {...decision, id: 'a.b', node: 'nowhere'},
    {...decision, id: 'a.c', parts: []},
    {...decision, id: 'a.d', parts: [{slot: 'a', kind: 'runtime'}, {slot: 'a', kind: 'runtime'}]},
    {...decision, id: 'a.e', parts: [{slot: 'a', kind: 'mystery'}]},
    {...decision, id: 'a.f', parts: [{text: 5}]},
    {...decision, id: 'a.g', parts: [{slot: 'a', kind: 'runtime', prefix: 'p'}]},
    {...decision, id: 'a.h', title: ''},
    {id: 'a.i', node: 'router', title: 't', source: 's'},
  ];
  for (const bad of invalid) assert.throws(() => r.define(bad), undefined, 'definition must be rejected: ' + bad.id);
});

test('every render is reported to the log as ordered segments with its correlation ids', () => {
  const calls = [];
  const r = registry({render: (input?: any) => { calls.push(input); }});
  const text = r.render('router.batch-decision', {rule: 'R', context: 'C', events: 'E'}, {eventId: 'qq:g:1:9', requestId: 'eval:1', sessionId: 's', channel: 'g:1'});
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.promptId, 'router.batch-decision');
  assert.equal(call.templateHash, r.get('router.batch-decision').templateHash);
  assert.deepEqual([call.eventId, call.requestId, call.sessionId, call.channel], ['qq:g:1:9', 'eval:1', 's', 'g:1']);
  assert.deepEqual(call.segments.map((s?: any) => [s.slot, s.kind]), [['rule', 'static'], ['literal:1', 'static'], ['literal:3', 'static'], ['context', 'runtime'], ['literal:6', 'static'], ['events', 'runtime']]);
  assert.equal(call.segments.map((s?: any) => s.text).join(''), text);
});

test('a failing log never prevents the prompt from being produced', () => {
  const r = registry({render: () => { throw new Error('store unavailable'); }});
  assert.equal(r.render('router.batch-decision', {rule: 'R', context: 'C', events: 'E'}).startsWith('R\n'), true);
});

test('list exposes each definition with its parts and a template hash that tracks the template', () => {
  const r = registry();
  r.define({id: 'rule.social-reply', node: 'router', title: '社交回复规则', kind: 'static', source: 'src/host/social-policy.mts', text: '每小时最多 10 条评论。'});
  r.define({id: 'persona.file', node: 'session', title: '角色设定', kind: 'config', source: 'fishHome/characters/<id>/persona.md', read: () => '你是大肥鱼。'});
  const listed = r.list();
  assert.deepEqual(listed.map((d?: any) => [d.id, d.kind, d.node]), [['persona.file', 'config', 'session'], ['router.batch-decision', 'assembled', 'router'], ['rule.social-reply', 'static', 'router']]);
  const assembled = listed[1];
  assert.equal(assembled.parts.length, 8);
  assert.deepEqual(assembled.parts[0], {slot: 'rule', kind: 'static', ref: 'rule.social-reply', optional: false});
  assert.deepEqual(assembled.parts[5], {slot: 'tasks', kind: 'runtime', optional: true, prefix: '\n相关任务：'});
  assert.deepEqual(assembled.parts[3], {text: '\n上下文：\n'});
  assert.match(assembled.templateHash, /^[0-9a-f]{64}$/);
  const changed = createPromptRegistry({});
  changed.define({...decision, parts: decision.parts.map((p?: any, i?: any) => i === 3 ? {text: '\n背景：\n'} : p)});
  assert.notEqual(changed.get('router.batch-decision').templateHash, assembled.templateHash);
  // Listing never returns live internals.
  listed[1].parts.length = 0;
  assert.equal(r.list()[1].parts.length, 8);
});

test('static and external texts are described with content, size and hash; read failures are reported, not thrown', () => {
  const r = createPromptRegistry({});
  r.define({id: 'rule.social-reply', node: 'router', title: '社交回复规则', kind: 'static', source: 'src/host/social-policy.mts', text: '每小时最多 10 条评论。'});
  r.define({id: 'persona.file', node: 'session', title: '角色设定', kind: 'config', source: 'persona.md', read: () => '你是大肥鱼。'});
  r.define({id: 'persona.missing', node: 'session', title: '缺失文件', kind: 'config', source: 'missing.md', read: () => { throw new Error('ENOENT /private/path'); }});
  const fixed = r.describe('rule.social-reply');
  assert.equal(fixed.text, '每小时最多 10 条评论。');
  assert.equal(fixed.chars, '每小时最多 10 条评论。'.length);
  assert.match(fixed.hash, /^[0-9a-f]{64}$/);
  assert.equal(r.describe('persona.file').text, '你是大肥鱼。');
  assert.deepEqual(r.describe('persona.missing'), {id: 'persona.missing', error: true});
  assert.throws(() => r.describe('nope'), /nope/);
  assert.throws(() => r.render('rule.social-reply', {}), /assembled/);
});

test('the registry hash changes when any definition changes and is stable across definition order', () => {
  const a = createPromptRegistry({}), b = createPromptRegistry({}), c = createPromptRegistry({});
  const fixed = {id: 'rule.social-reply', node: 'router', title: 't', kind: 'static', source: 's', text: 'one'};
  a.define(decision); a.define(fixed);
  b.define(fixed); b.define(decision);
  c.define(decision); c.define({...fixed, text: 'two'});
  assert.match(a.hash(), /^[0-9a-f]{64}$/);
  assert.equal(a.hash(), b.hash());
  assert.notEqual(a.hash(), c.hash());
});

test('with the real decision log, a rendered prompt can be rebuilt exactly from stored segments', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chop-prompts-'));
  t.after(() => setImmediate(() => fs.rmSync(dir, {recursive: true, force: true, maxRetries: 3, retryDelay: 50})));
  const o = obs.createObservability({stateDir: dir});
  t.after(() => o.close());
  const r = registry(o.decisions);
  const text = r.render('router.batch-decision', {rule: '规则', context: '历史记录', events: '[{"id":"qq:g:1:9"}]'}, {eventId: 'qq:g:1:9'});
  const [row] = o.decisions.renders({eventId: 'qq:g:1:9'}).items;
  assert.equal(row.promptId, 'router.batch-decision');
  assert.equal(row.segments.map((s?: any) => o.decisions.segment(s.hash)).join(''), text);
});
