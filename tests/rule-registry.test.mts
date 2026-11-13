import test from 'node:test';
import assert from 'node:assert/strict';

const modulePath: string = '../src/host/rule-registry.mjs';
let createRuleRegistry: any;
try { ({createRuleRegistry} = await import(modulePath)); } catch {}

const cap = {
  id: 'social.comment-hourly-cap', node: 'act', title: '内容平台评论每小时上限',
  description: '滚动一小时内每个内容平台最多 10 条评论。', source: 'src/host/social-policy.mts',
  params: () => ({limit: {value: 10, from: 'hardcoded'}, windowMs: {value: 3600000, from: 'hardcoded'}}),
};
function registry(log?: any) { const r = createRuleRegistry({log}); r.define(cap); return r; }

test('rule registry exists', () => {
  assert.equal(typeof createRuleRegistry, 'function', 'rule registry must be implemented');
});

test('definitions are validated: unique well-formed ids, known nodes, required text', () => {
  const r = registry();
  assert.throws(() => r.define(cap), /already/i);
  const invalid = [{...cap, id: 'Bad Id'}, {...cap, id: 'a.b', node: 'nowhere'}, {...cap, id: 'a.c', title: ''}, {...cap, id: 'a.d', description: ''}, {...cap, id: 'a.e', source: ''}, {...cap, id: 'a.f', params: 'ten'}, {...cap, id: 'a.g', counters: 5}];
  for (const bad of invalid) assert.throws(() => r.define(bad), undefined, 'definition must be rejected: ' + bad.id);
});

test('a decision is written with the rule id and its node plus the caller correlation ids', () => {
  const calls = [];
  const r = registry({decide: (input?: any) => { calls.push(input); return calls.length; }});
  const seq = r.decide('social.comment-hourly-cap', 'deny', {reason: 'hourly_cap', eventId: 'e1', requestId: 'dispatch:1', callId: 'c1', sessionId: 's', channel: 'heybox:public', detail: {used: 10, limit: 10}});
  assert.equal(seq, 1);
  assert.deepEqual(calls[0], {node: 'act', ruleId: 'social.comment-hourly-cap', outcome: 'deny', reason: 'hourly_cap', eventId: 'e1', requestId: 'dispatch:1', callId: 'c1', sessionId: 's', channel: 'heybox:public', detail: {used: 10, limit: 10}});
  r.decide('social.comment-hourly-cap', 'allow');
  assert.deepEqual([calls[1].outcome, calls[1].reason], ['allow', undefined]);
});

test('deciding never throws into the message path: an unregistered rule or bad outcome is recorded as such', () => {
  const calls = [];
  const r = registry({decide: (input?: any) => { calls.push(input); }});
  assert.doesNotThrow(() => r.decide('typo.rule', 'deny', {eventId: 'e1'}));
  assert.doesNotThrow(() => r.decide('social.comment-hourly-cap', 'maybe', {eventId: 'e2'}));
  assert.deepEqual(calls.map((c?: any) => [c.node, c.ruleId, c.outcome, c.reason, c.eventId]), [
    ['unregistered', 'typo.rule', 'info', 'unregistered_rule', 'e1'],
    ['act', 'social.comment-hourly-cap', 'info', 'invalid_outcome', 'e2'],
  ]);
  const failing = registry({decide: () => { throw new Error('store unavailable'); }});
  assert.doesNotThrow(() => failing.decide('social.comment-hourly-cap', 'allow'));
  assert.doesNotThrow(() => createRuleRegistry({}).decide('anything', 'allow'));
});

test('list resolves current parameters and counters with their sources and survives a failing reader', () => {
  const r = registry();
  r.define({id: 'wake.gap', node: 'gate', title: '唤醒间隔', description: '两次唤醒之间的最短间隔。', source: 'src/host/runtime.mts',
    params: () => ({gapMs: {value: 10000, from: 'config', key: 'wakeGapMs'}}), counters: () => ({asleep: false})});
  r.define({id: 'broken.rule', node: 'gate', title: '坏规则', description: '读取参数会失败。', source: 'x.mts', params: () => { throw new Error('secret path'); }, counters: () => { throw new Error('boom'); }});
  const listed = r.list();
  assert.deepEqual(listed.map((d?: any) => d.id), ['broken.rule', 'social.comment-hourly-cap', 'wake.gap']);
  assert.deepEqual(listed[2], {id: 'wake.gap', node: 'gate', title: '唤醒间隔', description: '两次唤醒之间的最短间隔。', source: 'src/host/runtime.mts', params: {gapMs: {value: 10000, from: 'config', key: 'wakeGapMs'}}, counters: {asleep: false}});
  assert.deepEqual(listed[1].params, {limit: {value: 10, from: 'hardcoded'}, windowMs: {value: 3600000, from: 'hardcoded'}});
  assert.equal(listed[1].counters, null);
  assert.deepEqual([listed[0].params, listed[0].counters], [{error: true}, {error: true}]);
  assert.doesNotMatch(JSON.stringify(listed), /secret path|boom/);
  assert.equal(r.get('wake.gap').title, '唤醒间隔');
  assert.equal(r.get('nope'), null);
});

test('the registry hash covers definitions and current parameter values, independent of definition order', () => {
  const make = (limit: number, reverse: boolean = false) => {
    const r = createRuleRegistry({});
    const defs = [{...cap, params: () => ({limit: {value: limit, from: 'hardcoded'}})}, {id: 'wake.gap', node: 'gate', title: 't', description: 'd', source: 's'}];
    for (const def of reverse ? defs.reverse() : defs) r.define(def);
    return r.hash();
  };
  assert.match(make(10), /^[0-9a-f]{64}$/);
  assert.equal(make(10), make(10, true));
  assert.notEqual(make(10), make(12));
});
