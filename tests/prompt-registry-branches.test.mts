// Prompt registry features used by the host prompt catalog: branches chosen by
// name, embedded static prompts, affixes on optional slots, nested fragments
// and per-definition details.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPromptRegistry} from '../src/host/prompt-registry.mjs';

const review = {
  id: 'evolution.review', node: 'background', title: '进化回顾', source: 'src/host/evolution.mts',
  parts: [
    {include: 'social.rule'},
    {text: '\n你是'},
    {slot: 'role', kind: 'static'},
    {slot: 'recovery', options: {yes: '上一轮没有报告。'}, optional: true},
    {slot: 'focus', options: {social: '看人际。', watchdog: '看健康。'}},
    {slot: 'mood', kind: 'runtime', optional: true, prefix: '\n心境：', suffix: '\n（完）'},
    {text: '\n来源：'},
    {slot: 'sources', kind: 'runtime'},
  ],
};
const rule = {id: 'social.rule', node: 'router', title: '社交规则', source: 'src/host/social-policy.mts', kind: 'static', text: '可以不回复。'};
function branching(log?: any) { const r: any = createPromptRegistry({log}); r.define(rule); r.define(review); return r; }
const fresh = (log?: any): any => createPromptRegistry({log});

test('a choice slot takes its text from the definition; the caller only names the branch', () => {
  const r = branching();
  assert.equal(r.render('evolution.review', {role: '看门狗', focus: 'watchdog', sources: '[]'}), '可以不回复。\n你是看门狗看健康。\n来源：[]');
  assert.equal(r.render('evolution.review', {role: '看门狗', recovery: 'yes', focus: 'social', sources: '[]'}), '可以不回复。\n你是看门狗上一轮没有报告。看人际。\n来源：[]');
  assert.throws(() => r.render('evolution.review', {role: 'x', focus: 'other', sources: '[]'}), /option/i);
  assert.throws(() => r.render('evolution.review', {role: 'x', sources: '[]'}), /Missing slot focus/);
});

test('an optional slot may carry a suffix, dropped together with the slot when it is empty', () => {
  const r = branching();
  assert.equal(r.render('evolution.review', {role: 'r', focus: 'social', mood: '平静', sources: 's'}), '可以不回复。\n你是r看人际。\n心境：平静\n（完）\n来源：s');
  assert.throws(() => fresh().define({...review, id: 'a.b', parts: [{slot: 'x', kind: 'runtime', suffix: '。'}]}), /optional/i);
});

test('an include embeds a registered static prompt and fails loudly when it is not one', () => {
  const r = fresh();
  r.define(review);
  assert.throws(() => r.render('evolution.review', {role: 'r', focus: 'social', sources: 's'}), /social\.rule/);
  r.define({id: 'social.rule', node: 'router', title: 't', source: 's', kind: 'config', read: () => 'x'});
  assert.throws(() => r.render('evolution.review', {role: 'r', focus: 'social', sources: 's'}), /static/i);
  assert.throws(() => fresh().define({...review, id: 'a.b', parts: [{include: 'Not An Id'}]}), /include/i);
});

test('branch, include and affix texts are reported as static segments with distinguishable names', () => {
  const calls: any[] = [];
  const r = branching({render: (entry: any) => { calls.push(entry); }});
  r.render('evolution.review', {role: '看门狗', recovery: 'yes', focus: 'watchdog', mood: '平静', sources: '[]'}, {eventId: 'e1'});
  assert.equal(calls[0].eventId, 'e1');
  assert.deepEqual(calls[0].segments.map((s: any) => [s.slot, s.kind, s.text]), [
    ['@social.rule', 'static', '可以不回复。'],
    ['literal:1', 'static', '\n你是'],
    ['role', 'static', '看门狗'],
    ['recovery=yes', 'static', '上一轮没有报告。'],
    ['focus=watchdog', 'static', '看健康。'],
    ['mood:prefix', 'static', '\n心境：'],
    ['mood', 'runtime', '平静'],
    ['mood:suffix', 'static', '\n（完）'],
    ['literal:6', 'static', '\n来源：'],
    ['sources', 'runtime', '[]'],
  ]);
});

test('a fragment is produced without being logged and keeps its segments when embedded in a parent prompt', () => {
  const calls: any[] = [];
  const r = fresh({render: (entry: any) => { calls.push(entry); }});
  r.define({id: 'mood.expression', node: 'session', title: '心境表达', source: 'src/host/mood.mts', parts: [{text: '心境参考：'}, {slot: 'label', kind: 'runtime'}, {text: '。'}]});
  r.define({id: 'dispatch.respond', node: 'session', title: '派发', source: 'src/host/runtime.mts', parts: [{text: '【角色】'}, {slot: 'mood', kind: 'runtime', optional: true, ref: 'mood.expression', suffix: '\n'}, {text: '【事件】'}, {slot: 'event', kind: 'runtime'}]});
  const fragment = r.fragment('mood.expression', {label: '平静'});
  assert.equal(fragment.text, '心境参考：平静。');
  assert.equal(fragment.id, 'mood.expression');
  assert.equal(calls.length, 0, 'a fragment alone is not a prompt sent to a model');
  assert.equal(r.render('dispatch.respond', {mood: fragment, event: '{}'}), '【角色】心境参考：平静。\n【事件】{}');
  assert.deepEqual(calls[0].segments.map((s: any) => [s.slot, s.kind, s.text]), [
    ['literal:0', 'static', '【角色】'],
    ['mood/literal:0', 'static', '心境参考：'],
    ['mood/label', 'runtime', '平静'],
    ['mood/literal:2', 'static', '。'],
    ['mood:suffix', 'static', '\n'],
    ['literal:2', 'static', '【事件】'],
    ['event', 'runtime', '{}'],
  ]);
  assert.throws(() => r.fragment('nope.x', {}), /Unknown prompt/);
  assert.throws(() => r.render('dispatch.respond', {mood: {text: 'forged'}, event: '{}'}), /must be text/);
});

test('an empty fragment counts as an empty slot', () => {
  const r = fresh();
  r.define({id: 'inner.x', node: 'router', title: 't', source: 's', parts: [{slot: 'a', kind: 'runtime', optional: true}]});
  r.define({id: 'outer.x', node: 'router', title: 't', source: 's', parts: [{text: 'A'}, {slot: 'inner', kind: 'runtime', optional: true, prefix: '['}, {text: 'B'}]});
  assert.equal(r.fragment('inner.x', {}).text, '');
  assert.equal(r.render('outer.x', {inner: r.fragment('inner.x', {})}), 'AB');
});

test('a required slot must be supplied but may be empty text, as in the template it replaces', () => {
  const r = branching();
  assert.equal(r.render('evolution.review', {role: '', focus: 'social', sources: ''}), '可以不回复。\n你是看人际。\n来源：');
  assert.throws(() => r.render('evolution.review', {role: 'r', focus: 'social'}), /Missing slot sources/);
  assert.throws(() => r.render('evolution.review', {role: 'r', focus: '', sources: 's'}), /Missing slot focus/);
});

test('segment names stay within the log limit even for long nested names', () => {
  const calls: any[] = [];
  const r = fresh({render: (entry: any) => { calls.push(entry); }});
  const long = 'a' + '-very-long-name'.repeat(4) + '.x';
  r.define({id: long, node: 'router', title: 't', source: 's', kind: 'static', text: 'T'});
  r.define({id: 'inner.x', node: 'router', title: 't', source: 's', parts: [{include: long}]});
  r.define({id: 'outer.x', node: 'router', title: 't', source: 's', parts: [{slot: 'aSlotWithQuiteALongNameForNestingTests', kind: 'runtime'}]});
  assert.equal(r.render('outer.x', {aSlotWithQuiteALongNameForNestingTests: r.fragment('inner.x')}), 'T');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].segments.every((s: any) => s.slot.length <= 80));
});

test('details are listed with the definition and tracked by the registry hash', () => {
  const r = fresh();
  const details = {parameters: {text: {type: 'string', description: '正文'}}};
  r.define({id: 'tool.send', node: 'act', title: 'chopsticks_send', source: 'src/host/index.mts', kind: 'static', text: '发送消息。', details});
  assert.deepEqual(r.get('tool.send').details, details);
  assert.deepEqual(r.describe('tool.send').details, details);
  details.parameters.text.description = 'changed after define';
  assert.equal(r.get('tool.send').details.parameters.text.description, '正文', 'details are copied at definition time');
  const other = fresh();
  other.define({id: 'tool.send', node: 'act', title: 'chopsticks_send', source: 'src/host/index.mts', kind: 'static', text: '发送消息。'});
  assert.notEqual(r.hash(), other.hash());
  assert.throws(() => fresh().define({id: 'tool.x', node: 'act', title: 't', source: 's', kind: 'static', text: 'T', details: 'not an object'}), /details/i);
});

test('choice and include parts are listed for the console and change the template hash', () => {
  const r = branching();
  const listed = r.get('evolution.review');
  assert.deepEqual(listed.parts[0], {include: 'social.rule'});
  assert.deepEqual(listed.parts[4], {slot: 'focus', optional: false, options: {social: '看人际。', watchdog: '看健康。'}});
  const changed = fresh();
  changed.define(rule);
  changed.define({...review, parts: review.parts.map((part: any) => part.slot === 'focus' ? {...part, options: {...part.options, social: '改了。'}} : part)});
  assert.notEqual(changed.get('evolution.review').templateHash, listed.templateHash);
});

test('has reports whether an id is already defined, so late registrations can skip duplicates', () => {
  const r = branching();
  assert.equal(r.has('social.rule'), true);
  assert.equal(r.has('social.other'), false);
});

test('a fragment that is itself what the model receives can be recorded as a render', () => {
  const calls: any[] = [];
  const r = fresh({render: (entry: any) => { calls.push(entry); }});
  r.define({id: 'session.live-context', node: 'session', title: 't', source: 's', parts: [{text: '当前可用经历：\n'}, {slot: 'experience', kind: 'runtime', optional: true}]});
  const fragment = r.fragment('session.live-context', {experience: '最近的事'});
  r.record(fragment, {sessionId: 's1', channel: 'g:1', eventId: 'e1', requestId: 'r1'});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].promptId, 'session.live-context');
  assert.equal(calls[0].templateHash, r.get('session.live-context').templateHash);
  assert.deepEqual([calls[0].sessionId, calls[0].channel, calls[0].eventId, calls[0].requestId], ['s1', 'g:1', 'e1', 'r1']);
  assert.deepEqual(calls[0].segments.map((x: any) => [x.slot, x.kind, x.text]), [['literal:0', 'static', '当前可用经历：\n'], ['experience', 'runtime', '最近的事']]);
  r.record({id: 'session.live-context', text: 'forged', segments: []}, {});
  r.record(null, {});
  assert.equal(calls.length, 1, 'only fragments produced by a registry are recorded');
  const failing = fresh({render() { throw new Error('disk full'); }});
  failing.define({id: 'a.b', node: 'router', title: 't', source: 's', parts: [{text: 'x'}]});
  assert.doesNotThrow(() => failing.record(failing.fragment('a.b'), {}));
});
