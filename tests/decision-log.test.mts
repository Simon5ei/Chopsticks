import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let obs: any = {};
try { obs = await import('../src/host/observability.mjs'); } catch {}
function fixture(t?: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chop-decisions-'));
  t.after(() => setImmediate(() => fs.rmSync(dir, {recursive: true, force: true, maxRetries: 3, retryDelay: 50})));
  return dir;
}
function open(t: any, options: Record<string, any> = {}) {
  const o = obs.createObservability({stateDir: fixture(t), secrets: ['configured-secret'], ...options});
  t.after(() => o.close());
  return o;
}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

test('the trace store exposes a decision log without changing existing trace queries', (t) => {
  const o = open(t);
  assert.equal(typeof o.decisions?.decide, 'function', 'decision log must be attached to the observability store');
  o.record({kind: 'router.decision', eventId: 'e1'});
  o.decisions.decide({node: 'gate', ruleId: 'wake.gap', outcome: 'allow', eventId: 'e1'});
  assert.equal(o.query({eventId: 'e1'}).items.length, 1);
  assert.equal(o.decisions.decisions({eventId: 'e1'}).items.length, 1);
});

test('a decision keeps its node, rule, outcome, reason and correlation ids and is found by each of them', (t) => {
  const log = open(t).decisions;
  const first = log.decide({node: 'act', ruleId: 'qq.fish-cooldown', outcome: 'deny', reason: 'fish_cooldown', eventId: 'qq:g:1:9', requestId: 'dispatch:abc', callId: 'call-1', sessionId: 's1', channel: 'g:1', detail: {remainingMs: 252000}});
  log.decide({node: 'gate', ruleId: 'wake.gap', outcome: 'allow', eventId: 'qq:g:1:9', detail: {gapMs: 46000, requiredMs: 10000}});
  log.decide({node: 'gate', ruleId: 'wake.gap', outcome: 'deny', eventId: 'qq:g:1:10'});
  assert.equal(Number.isSafeInteger(first), true);
  const byEvent = log.decisions({eventId: 'qq:g:1:9'}).items;
  assert.deepEqual(byEvent.map((d?: any) => [d.node, d.ruleId, d.outcome]), [['gate', 'wake.gap', 'allow'], ['act', 'qq.fish-cooldown', 'deny']]);
  assert.deepEqual(byEvent[1].detail, {remainingMs: 252000});
  assert.equal(byEvent[1].reason, 'fish_cooldown');
  assert.match(byEvent[1].at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(log.decisions({ruleId: 'wake.gap'}).items.length, 2);
  assert.equal(log.decisions({callId: 'call-1'}).items.length, 1);
  assert.equal(log.decisions({requestId: 'dispatch:abc'}).items.length, 1);
  assert.equal(log.decisions({ruleId: 'wake.gap', outcome: 'deny'}).items[0].eventId, 'qq:g:1:10');
});

test('decision queries are bounded and page backwards by sequence', (t) => {
  const log = open(t).decisions;
  for (let i = 0; i < 7; i++) log.decide({node: 'gate', ruleId: 'r', outcome: 'allow', eventId: `e${i}`});
  const page = log.decisions({ruleId: 'r', limit: 3});
  assert.deepEqual(page.items.map((d?: any) => d.eventId), ['e6', 'e5', 'e4']);
  const next = log.decisions({ruleId: 'r', limit: 3, beforeSeq: page.nextBeforeSeq});
  assert.deepEqual(next.items.map((d?: any) => d.eventId), ['e3', 'e2', 'e1']);
  assert.equal(log.decisions({ruleId: 'r', limit: 100000}).items.length, 7);
  assert.equal(log.decisions({ruleId: 'r', limit: -5}).items.length, 1);
});

test('invalid decisions are dropped and never throw into the message path', (t) => {
  const log = open(t).decisions;
  for (const bad of [null, {}, {node: 'gate'}, {outcome: 'allow'}, {node: 'gate', outcome: 'maybe'}, {node: 'x'.repeat(200), outcome: 'allow'}]) {
    assert.doesNotThrow(() => log.decide(bad));
    assert.equal(log.decide(bad), undefined);
  }
  assert.equal(log.decisions({}).items.length, 0);
});

test('decision text is redacted and oversized detail is replaced, not stored', (t) => {
  const log = open(t).decisions;
  log.decide({node: 'act', outcome: 'deny', reason: 'configured-secret leaked', eventId: 'e', detail: {token: 'abc', note: 'has configured-secret inside'}});
  log.decide({node: 'act', outcome: 'deny', eventId: 'big', detail: {blob: 'word '.repeat(1400)}});
  const [row] = log.decisions({eventId: 'e'}).items;
  assert.doesNotMatch(JSON.stringify(row), /configured-secret|"abc"/);
  assert.deepEqual(log.decisions({eventId: 'big'}).items[0].detail, {truncated: true});
});

test('decision rows are pruned by count on insert and by age when the store opens', (t) => {
  const dir = fixture(t);
  let now = Date.parse('2026-11-13T00:00:00Z');
  const first = obs.createObservability({stateDir: dir, decisions: {maxRows: 5, maxAgeMs: 30 * 86400000, now: () => now}});
  for (let i = 0; i < 8; i++) first.decisions.decide({node: 'gate', outcome: 'allow', eventId: `e${i}`});
  assert.deepEqual(first.decisions.decisions({}).items.map((d?: any) => d.eventId), ['e7', 'e6', 'e5', 'e4', 'e3']);
  first.close();
  now += 31 * 86400000;
  const later = obs.createObservability({stateDir: dir, decisions: {maxRows: 5, maxAgeMs: 30 * 86400000, now: () => now}});
  t.after(() => later.close());
  assert.equal(later.decisions.decisions({}).items.length, 0);
});

test('a rendered prompt is stored as ordered content-addressed segments and can be rebuilt exactly', (t) => {
  const log = open(t).decisions;
  const persona = '你是大肥鱼。'.repeat(3400);
  const events = JSON.stringify(Array.from({length: 40}, (_?: any, i?: any) => ({id: `qq:g:1:${i}`, text: `第 ${i} 条`})));
  assert.ok(persona.length > 20000);
  const segments = [{slot: 'persona', kind: 'config', text: persona}, {slot: 'literal:1', kind: 'static', text: '\n【事件】'}, {slot: 'events', kind: 'runtime', text: events}];
  const made = log.render({promptId: 'dispatch.platform', templateHash: 'tpl-1', segments, eventId: 'qq:g:1:9', requestId: 'dispatch:abc', sessionId: 's1', channel: 'g:1'});
  assert.equal(made.chars, persona.length + 5 + events.length);
  const [row] = log.renders({eventId: 'qq:g:1:9'}).items;
  assert.equal(row.promptId, 'dispatch.platform');
  assert.equal(row.templateHash, 'tpl-1');
  assert.equal(row.chars, made.chars);
  assert.deepEqual(row.segments.map((s?: any) => [s.slot, s.kind, s.chars]), [['persona', 'config', persona.length], ['literal:1', 'static', 5], ['events', 'runtime', events.length]]);
  assert.equal(row.segments[0].hash, sha(persona));
  // Long text is kept whole and JSON-looking text is kept verbatim, unlike trace rows.
  assert.equal(row.segments.map((s?: any) => log.segment(s.hash)).join(''), persona + '\n【事件】' + events);
  assert.equal(log.renders({promptId: 'dispatch.platform'}).items.length, 1);
  assert.equal(log.renders({requestId: 'dispatch:abc'}).items.length, 1);
});

test('identical segments are stored once across renders', (t) => {
  const o = open(t), log = o.decisions;
  const persona = 'persona text '.repeat(100);
  for (const eventId of ['e1', 'e2', 'e3']) log.render({promptId: 'dispatch.platform', segments: [{slot: 'persona', kind: 'config', text: persona}, {slot: 'event', kind: 'runtime', text: eventId}], eventId});
  const stats = log.stats();
  assert.equal(stats.segments, 4);
  assert.equal(stats.renders, 3);
  assert.equal(stats.segmentBytes, Buffer.byteLength(persona) + 6);
});

test('prompt segments are redacted, and a segment over the size cap is truncated and flagged', (t) => {
  const log = open(t, {decisions: {maxSegmentChars: 1000}}).decisions;
  log.render({promptId: 'p', eventId: 'e', segments: [{slot: 'a', kind: 'runtime', text: 'key configured-secret and Authorization: Bearer abcdef123456'}, {slot: 'b', kind: 'runtime', text: 'yes '.repeat(1250)}]});
  const [row] = log.renders({eventId: 'e'}).items;
  const first = log.segment(row.segments[0].hash);
  assert.doesNotMatch(first, /configured-secret|abcdef123456/);
  assert.equal(row.segments[1].truncated, true);
  assert.equal(row.segments[1].chars, 5000);
  assert.equal(log.segment(row.segments[1].hash).length, 1000);
  assert.equal(row.chars, 'key configured-secret and Authorization: Bearer abcdef123456'.length + 5000);
});

test('segment storage is capped by bytes and evicts the least recently used text first', (t) => {
  let now = Date.parse('2026-11-13T00:00:00Z');
  const log = open(t, {decisions: {maxSegmentBytes: 2500, now: () => now}}).decisions;
  const text = (letter: string) => (letter + ' ').repeat(500); // spaced: an unbroken run of letters would be redacted as binary
  const put = (eventId: string, letter: string) => { now += 1000; return log.render({promptId: 'p', eventId, segments: [{slot: 's', kind: 'runtime', text: text(letter)}]}); };
  put('e1', 'a'); put('e2', 'b'); put('e3', 'a'); put('e4', 'c');
  // 'a' was reused after 'b', so 'b' is the least recently used and goes first.
  assert.equal(log.segment(sha(text('b'))), null);
  assert.equal(log.segment(sha(text('a'))), text('a'));
  assert.equal(log.segment(sha(text('c'))), text('c'));
  assert.ok(log.stats().segmentBytes <= 2500);
  // The render row survives; its segment simply reports as expired.
  assert.equal(log.renders({eventId: 'e2'}).items[0].segments[0].hash, sha(text('b')));
});

test('invalid renders are dropped without throwing', (t) => {
  const log = open(t).decisions;
  for (const bad of [null, {}, {promptId: 'p'}, {promptId: 'p', segments: 'text'}, {promptId: 'p', segments: [{slot: 's', text: 5}]}, {segments: [{slot: 's', kind: 'runtime', text: 'x'}]}]) {
    assert.doesNotThrow(() => log.render(bad));
    assert.equal(log.render(bad), undefined);
  }
  assert.equal(log.stats().renders, 0);
});

test('a runtime snapshot gets a new id only when its content changes and stamps later records', (t) => {
  const dir = fixture(t);
  const first = obs.createObservability({stateDir: dir, secrets: ['configured-secret']});
  const log = first.decisions;
  assert.equal(log.currentSnapshot(), null);
  log.decide({node: 'gate', outcome: 'allow', eventId: 'before'});
  const a = log.snapshot({build: '9d83374', presets: 'h1', persona: 'h2', note: 'configured-secret'});
  assert.equal(log.snapshot({persona: 'h2', presets: 'h1', build: '9d83374', note: 'configured-secret'}), a, 'key order must not create a new snapshot');
  log.decide({node: 'gate', outcome: 'allow', eventId: 'after'});
  log.render({promptId: 'p', eventId: 'after', segments: [{slot: 's', kind: 'static', text: 'x'}]});
  const b = log.snapshot({build: '9d83374', presets: 'h1-changed', persona: 'h2'});
  assert.notEqual(b, a);
  assert.equal(log.currentSnapshot(), b);
  assert.equal(log.decisions({eventId: 'before'}).items[0].snapshotId, null);
  assert.equal(log.decisions({eventId: 'after'}).items[0].snapshotId, a);
  assert.equal(log.renders({eventId: 'after'}).items[0].snapshotId, a);
  const stored = log.snapshots({});
  assert.deepEqual(stored.items.map((s?: any) => s.id), [b, a]);
  assert.equal(stored.items[1].value.build, '9d83374');
  assert.doesNotMatch(JSON.stringify(stored), /configured-secret/);
  first.close();
  // A restart with unchanged content returns to the same snapshot id.
  const again = obs.createObservability({stateDir: dir});
  t.after(() => again.close());
  assert.equal(again.decisions.currentSnapshot(), null);
  assert.equal(again.decisions.snapshot({build: '9d83374', presets: 'h1-changed', persona: 'h2'}), b);
});

test('an unavailable store degrades to empty answers', (t) => {
  const dead = obs.createObservability({stateDir: path.join(fixture(t), 'missing', 'bad\0')});
  const log = dead.decisions;
  assert.equal(log.decide({node: 'gate', outcome: 'allow'}), undefined);
  assert.equal(log.render({promptId: 'p', segments: [{slot: 's', kind: 'static', text: 'x'}]}), undefined);
  assert.equal(log.snapshot({build: 'x'}), null);
  assert.equal(log.segment('0'.repeat(64)), null);
  assert.deepEqual(log.decisions({}), {items: [], nextBeforeSeq: null});
  assert.deepEqual(log.renders({}), {items: [], nextBeforeSeq: null});
  assert.deepEqual(log.snapshots({}), {items: [], nextBeforeSeq: null});
  assert.deepEqual(log.stats(), {decisions: 0, renders: 0, segments: 0, segmentBytes: 0, snapshots: 0});
  dead.close();
});

test('records after close are ignored', (t) => {
  const o = obs.createObservability({stateDir: fixture(t)});
  o.close();
  assert.doesNotThrow(() => o.decisions.decide({node: 'gate', outcome: 'allow'}));
  assert.deepEqual(o.decisions.decisions({}), {items: [], nextBeforeSeq: null});
});
