import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQqFishGuard, isFishName, assessFishDensity } from '../adapters/fish-guard.mjs';

const now = 1700000000000;
const human = (id, extra = {}) => ({ userId: String(id), sender: '普通朋友', time: now - 1000, ...extra });
const fish = (id, extra = {}) => human(id, { sender: '快乐肥鱼', ...extra });

test('ordinary human conversation and a short fish exchange remain allowed', () => {
  const humans = Array.from({ length: 20 }, (_, n) => human(10000 + n));
  assert.equal(assessFishDensity(humans, { now }).blocked, false);
  const mixed = [...humans, fish(20001), human(10000), fish(20002), human(10001)];
  const result = assessFishDensity(mixed, { now });
  assert.equal(result.blocked, false);
  assert.equal(result.fishCount, 2);
  assert.equal(result.consecutiveFish, 0);
});

test('continuous fish chatter blocks by single-sender or multi-sender streak', () => {
  const single = assessFishDensity(Array.from({ length: 5 }, () => fish(20001)), { now });
  assert.equal(single.blocked, true);
  assert.equal(single.reason, 'fish-streak-single');
  const multiple = assessFishDensity(Array.from({ length: 5 }, (_, n) => fish(20001 + n % 2)), { now });
  assert.equal(multiple.reason, 'fish-streak');
  assert.equal(multiple.consecutiveFishSenders, 2);
});

test('distinct fish and sustained fish ratio retain the upstream density thresholds', () => {
  const distinct = Array.from({ length: 5 }, (_, n) => fish(20001 + n));
  assert.equal(assessFishDensity(distinct, { now }).reason, 'fish-count');
  const ratio = [fish(20001), fish(20002), fish(20001), fish(20002), human(10000), fish(20001), fish(20002), fish(20001), fish(20002), human(10000)];
  assert.equal(assessFishDensity(ratio, { now }).reason, 'fish-ratio');
  const nest = assessFishDensity(distinct.slice(0, 3), { now, groupName: '肥鱼后援会' });
  assert.equal(nest.reason, 'fish-count');
  assert.equal(nest.effectiveMaxFish, 3);
  assert.equal(assessFishDensity(Array.from({ length: 8 }, (_, n) => human(10000 + n)), { now, groupName: '肥鱼后援会' }).blocked, false);
});

test('owner, self, exemptions, expired messages and pokes cannot inflate fish density', () => {
  const messages = [
    ...Array.from({ length: 5 }, () => fish(20001, { time: now - 700000 })),
    ...Array.from({ length: 5 }, () => fish(20002, { kind: 'poke' })),
    fish(20003, { isOwner: true }), fish(20004, { isSelf: true }),
    fish(20005), fish(20006, { sender: '指定豁免鱼' }),
  ];
  const result = assessFishDensity(messages, { now, guard: { exemptIds: ['20005'], exemptNames: ['指定豁免鱼'] } });
  assert.equal(result.blocked, false);
  assert.equal(result.fishMessages, 0);
  assert.equal(assessFishDensity(Array.from({ length: 5 }, () => fish(20001)), { now, guard: { enabled: false } }).blocked, false);
});

test('configured name patterns are retained and direct-address bypass remains a host decision', () => {
  assert.equal(isFishName('普通朋友'), false);
  assert.equal(isFishName('大肥鱼观察员'), true);
  assert.equal(isFishName('HappyFish2'), true);
  assert.equal(isFishName('小鱼'), true);
  assert.equal(isFishName('BOT助手', { namePrefixes: ['bot'] }), true);
  assert.equal(isFishName('小鱼', { exemptNames: ['小鱼'] }), false);
  const config = normalizeQqFishGuard({ bypassDirectAddress: false, maxFish: 999, fishIds: '12345,invalid,23456' });
  assert.equal(config.bypassDirectAddress, false);
  assert.equal(config.maxFish, 20);
  assert.deepEqual(config.fishIds, ['12345', '23456']);
  const messages = Array.from({ length: 5 }, () => fish(20001, { addressed: true }));
  assert.equal(assessFishDensity(messages, { now }).blocked, true);
});
