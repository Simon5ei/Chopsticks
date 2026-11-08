import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const {createSocialPolicy} = await import('../src/host/social-policy.mjs');
const HOUR = 3600000;
function fixture(t?: any, options: Record<string, any> = {}) {
  assert.equal(typeof createSocialPolicy, 'function', 'shared rolling social policy must exist');
  const dir = mkdtempSync(join(tmpdir(), 'social-policy-'));
  let db;
  let time = 10000000;
  const open = () => {
    db = new DatabaseSync(join(dir, 'ledger.sqlite'));
    return createSocialPolicy({store: {db}, now: () => time, ...options});
  };
  let policy = open();
  t.after(() => {db.close(); rmSync(dir, {recursive: true, force: true});});
  return {get policy() {return policy;}, get db() {return db;},
    setTime(value?: any) {time = value;},
    reopen() {db.close(); policy = open(); return policy;}};
}
const reserve = (policy?: any, id?: any, platform: string = 'bili', action: string = 'comment') => policy.reserve({platform, action, intentId: id});
const full = (error) => error.code === 'SOCIAL_HOURLY_LIMIT' && error.deliveryState === 'not_sent';
const replay = (error) => error.code === 'SOCIAL_INTENT_REPLAY' && error.deliveryState === 'not_sent';

test('explicit global scope shares ten comment and reply slots across every content platform', (t) => {
  const f = fixture(t, {scope: 'global'}), platforms = ['bili', 'bilibili', 'douyin', 'heybox', 'qzone'];
  for (let i = 0; i < 10; i++) assert.ok(reserve(f.policy, `c${i}`, platforms[i % 5], i % 2 ? 'reply' : 'comment'));
  assert.throws(() => reserve(f.policy, 'overflow', 'qzone', 'reply'), full);
});

test('thirty content DMs have a separate budget from comments', (t) => {
  const f = fixture(t, {scope: 'global'});
  for (let i = 0; i < 30; i++) reserve(f.policy, `dm${i}`, ['bili', 'douyin', 'heybox'][i % 3], 'dm');
  assert.throws(() => reserve(f.policy, 'dm-overflow', 'bilibili', 'dm'), full);
  assert.ok(reserve(f.policy, 'comment'));
});

test('IM, likes and posts do not consume or require content reservation identity', (t) => {
  const f = fixture(t);
  for (const [platform, action] of [['qq', 'dm'], ['wechat', 'comment'], ['bili', 'like'], ['qzone', 'post']]) {
    assert.equal(f.policy.reserve({platform, action}), null);
  }
  for (let i = 0; i < 10; i++) reserve(f.policy, `c${i}`);
});

test('rolling boundary expires only the oldest slots exactly one hour later', (t) => {
  const f = fixture(t);
  reserve(f.policy, 'oldest');
  f.setTime(10000001);
  for (let i = 1; i < 10; i++) reserve(f.policy, `c${i}`);
  f.setTime(10000000 + HOUR - 1);
  assert.throws(() => reserve(f.policy, 'early'), full);
  f.setTime(10000000 + HOUR);
  assert.ok(reserve(f.policy, 'just-in-time'));
  assert.throws(() => reserve(f.policy, 'still-full'), full);
});

test('multiple policy instances reserve synchronously before asynchronous sends', async (t?: any) => {
  const f = fixture(t);
  const second = createSocialPolicy({store: {db: f.db}, now: () => 10000000});
  const results = await Promise.allSettled(Array.from({length: 12}, async (_?: any, i?: any) => {
    const token = reserve(i % 2 ? second : f.policy, `concurrent-${i}`);
    await Promise.resolve();
    return token;
  }));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 10);
  assert.equal(results.filter((result) => result.status === 'rejected' && full(result.reason)).length, 2);
});

test('restart preserves both consumed budget and replay protection', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 10; i++) reserve(f.policy, `c${i}`);
  f.reopen();
  assert.throws(() => reserve(f.policy, 'new'), full);
  assert.throws(() => reserve(f.policy, 'c0'), replay);
  f.setTime(10000000 + HOUR);
  assert.throws(() => reserve(f.policy, 'c0'), replay);
  assert.ok(reserve(f.policy, 'fresh'));
});

test('only proven not-sent releases a reservation and permits an intentional retry', (t) => {
  const f = fixture(t), token = reserve(f.policy, 'retry');
  for (let i = 1; i < 10; i++) reserve(f.policy, `c${i}`);
  assert.throws(() => f.policy.release(token), /not_sent/);
  assert.throws(() => reserve(f.policy, 'overflow'), full);
  assert.equal(f.policy.release(token, {deliveryState: 'not_sent'}), true);
  const retry = reserve(f.policy, 'retry');
  assert.notEqual(retry.id, token.id);
  assert.equal(f.policy.release(token, {deliveryState: 'not_sent'}), false);
  assert.throws(() => reserve(f.policy, 'overflow'), full);
});

test('unknown and confirmed outcomes retain quota and cannot later be released', (t) => {
  const f = fixture(t);
  for (let i = 0; i < 10; i++) {
    const token = reserve(f.policy, `c${i}`);
    f.policy.settle(token, {deliveryState: i % 2 ? 'confirmed' : 'unknown'});
    assert.equal(f.policy.release(token, {deliveryState: 'not_sent'}), false);
  }
  assert.throws(() => reserve(f.policy, 'overflow'), full);
});

test('stable identity cannot bypass replay by changing action or platform', (t) => {
  const f = fixture(t);
  reserve(f.policy, 'one');
  assert.throws(() => reserve(f.policy, 'one', 'douyin', 'dm'), replay);
});

test('default scope gives each platform ten comments and thirty DMs while aliases share budget', (t) => {
  const f = fixture(t);
  for (const platform of ['bili', 'douyin', 'heybox', 'qzone']) {
    for (let i = 0; i < 10; i++) reserve(f.policy, `${platform}-c${i}`, platform, i % 2 ? 'reply' : 'comment');
    assert.throws(() => reserve(f.policy, `${platform}-comment-full`, platform), full);
    for (let i = 0; i < 30; i++) reserve(f.policy, `${platform}-dm${i}`, platform, 'dm');
    assert.throws(() => reserve(f.policy, `${platform}-dm-full`, platform, 'dm'), full);
  }
  assert.throws(() => reserve(f.policy, 'alias', 'bilibili'), full);
  assert.throws(() => reserve(f.policy, 'alias-dm', 'bilibili', 'dm'), full);
});

test('invalid clocks and clock rollback fail closed including after restart', (t) => {
  const f = fixture(t);
  reserve(f.policy, 'baseline');
  for (const value of [9999999, NaN, Infinity, -1]) {
    f.setTime(value);
    assert.throws(() => reserve(f.policy, `bad-${value}`), (error: any) => error.code === 'SOCIAL_POLICY_STATE' && error.deliveryState === 'not_sent');
  }
  f.reopen();
  f.setTime(9999999);
  assert.throws(() => reserve(f.policy, 'restart-rollback'), (error: any) => error.code === 'SOCIAL_POLICY_STATE');
  f.setTime(10000000);
  assert.ok(reserve(f.policy, 'clock-restored'));
});

test('invalid scope, missing stable identity and closed persistence cannot authorize sends', (t) => {
  const f = fixture(t);
  assert.throws(() => createSocialPolicy({store: {db: f.db}, scope: 'unexpected'}), /scope/);
  assert.throws(() => f.policy.reserve({platform: 'bili', action: 'dm'}), /intentId/);
  assert.throws(() => reserve(f.policy, 'x'.repeat(257)), /intentId/);
  const db = new DatabaseSync(':memory:');
  const policy = createSocialPolicy({store: {db}, now: () => 10000000});
  db.close();
  assert.throws(() => reserve(policy, 'closed'), (error: any) => error.code === 'SOCIAL_POLICY_STATE' && error.deliveryState === 'not_sent');
});

test('reopening a ledger with a missing clock cannot reset replay and rollback protection', (t) => {
  const f = fixture(t);
  reserve(f.policy, 'before-clock-loss');
  f.db.exec('DELETE FROM social_policy_clock WHERE id=1');
  assert.throws(() => createSocialPolicy({store: {db: f.db}, now: () => 1}), (error: any) => error.code === 'SOCIAL_POLICY_STATE');
});

test('corrupt persisted reservation state fails closed instead of freeing its slot', (t) => {
  const f = fixture(t);
  const token = reserve(f.policy, 'before-corruption');
  f.db.exec('PRAGMA ignore_check_constraints=ON');
  f.db.prepare('UPDATE social_policy_reservations SET state=? WHERE id=?').run('corrupt-state', token.id);
  f.db.exec('PRAGMA ignore_check_constraints=OFF');
  assert.throws(() => reserve(f.policy, 'after-corruption'), (error: any) => error.code === 'SOCIAL_POLICY_STATE' && error.deliveryState === 'not_sent');
});

test('settlement persistence failure never claims transport did not send or frees quota', (t) => {
  const f = fixture(t), token = reserve(f.policy, 'already-sent');
  for (let i = 1; i < 10; i++) reserve(f.policy, `c${i}`);
  f.db.exec("CREATE TRIGGER reject_social_settlement BEFORE UPDATE ON social_policy_reservations BEGIN SELECT RAISE(ABORT, 'settlement unavailable'); END");
  const uncertain = (error) => error.code === 'SOCIAL_POLICY_STATE' && error.deliveryState !== 'not_sent';
  assert.throws(() => f.policy.settle(token, {deliveryState: 'confirmed'}), uncertain);
  assert.throws(() => f.policy.release(token, {deliveryState: 'not_sent'}), uncertain);
  assert.throws(() => reserve(f.policy, 'quota-retained'), full);
});

test('settling after database closure cannot be mistaken for proof of no send', () => {
  assert.equal(typeof createSocialPolicy, 'function');
  const db = new DatabaseSync(':memory:');
  const policy = createSocialPolicy({store: {db}, now: () => 10000000});
  const token = reserve(policy, 'transport-completed');
  db.close();
  assert.throws(() => policy.settle(token, {deliveryState: 'confirmed'}), (error: any) => error.code === 'SOCIAL_POLICY_STATE' && error.deliveryState !== 'not_sent');
});
