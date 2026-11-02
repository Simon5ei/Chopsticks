// Extracted from SurfCore src/fish-guard.js (MIT; see notices/surfcore-qq-LICENSE).
// Host owns direct-address bypass, cooldown persistence and send enforcement.
/**
 * QQ 群「鱼群保护」——纯函数层（可单测，不碰网络/状态）。
 *
 * 目标：同一批同类 bot 被拉进同一个群时，不要集体刷屏。
 * 规则（默认值，设置页可改）：
 *   ① 最近 10 分钟里，名字以「肥鱼 / fish」结尾的**不同**发送者 ≥ 5 → 本鱼不参与；
 *   ② 最近连续 5 条普通消息都来自鱼 → 本鱼不参与；
 *   ③ 最近消息里鱼消息 ≥ 8 条且占比 ≥ 60% → 本鱼不参与（补充规则，防"5 条鱼各刷 1 条"漏网）。
 * 被直接 @ / 引用 / 管理员点名时默认放行（可在设置里关掉）。
 *
 * 注意：这里只做判定；冷却计时、落盘和硬拦发送由 bridge.js 负责。
 */

export const DEFAULT_QQ_FISH_GUARD = Object.freeze({
  enabled: true,
  windowMs: 10 * 60 * 1000,
  cooldownMs: 10 * 60 * 1000,
  // 不同鱼的数量阈值
  maxFish: 5,
  // 连续多少条消息全是鱼（中间有真人/自己说话就断开）
  maxConsecutiveFish: 5,
  // 只有一只鱼时，连续多少条才拦（避免一个鱼朋友正常连发 5 条也被误判）
  singleFishMaxConsecutive: 5,
  // 补充：鱼消息条数与占比
  maxFishMessages: 8,
  maxFishRatio: 0.6,
  minSample: 8,
  minFishSendersForRatio: 2,
  // 群名本身像鱼窝时，把「不同鱼」阈值收紧到 3（人还是人，不会因为群名被算成鱼）
  groupNestMaxFish: 3,
  groupNestIds: [],
  // 2026-10-23 用户定：名字**最后一个字是「鱼」**也算鱼（咸鱼/摸鱼/鱿鱼…），
  // 名字里**只要包含「肥鱼」**就算（肥鱼观察员 / 大肥鱼研究员…）；
  // 用户还可以自己加「开头词 / 中间包含词 / 结尾词」，任一命中就算鱼。
  // 宁可极小概率把真人认成鱼，也别漏掉同类 bot。群名判断仍只用 肥鱼/fish，不跟着放宽。
  namePrefixes: [],
  nameContains: ['肥鱼'],
  nameSuffixes: ['肥鱼', 'fish', '鱼'],
  groupNameSuffixes: ['肥鱼', 'fish'],
  exemptNames: [],
  exemptIds: [],
  fishIds: [],
  bypassDirectAddress: true,
  blockSends: true,
});

const asBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const clampInt = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const clampNumber = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const cleanList = (value, max = 50) => {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/);
  return [...new Set(list.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, max);
};

export function normalizeQqFishGuard(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const windowMs = clampInt(src.windowMs, DEFAULT_QQ_FISH_GUARD.windowMs, 60_000, 24 * 60 * 60 * 1000);
  return {
    ...DEFAULT_QQ_FISH_GUARD,
    ...src,
    enabled: asBool(src.enabled, DEFAULT_QQ_FISH_GUARD.enabled),
    windowMs,
    cooldownMs: clampInt(src.cooldownMs, Math.max(windowMs, DEFAULT_QQ_FISH_GUARD.cooldownMs), 60_000, 24 * 60 * 60 * 1000),
    maxFish: clampInt(src.maxFish, DEFAULT_QQ_FISH_GUARD.maxFish, 2, 20),
    maxConsecutiveFish: clampInt(src.maxConsecutiveFish, DEFAULT_QQ_FISH_GUARD.maxConsecutiveFish, 2, 30),
    singleFishMaxConsecutive: clampInt(src.singleFishMaxConsecutive, DEFAULT_QQ_FISH_GUARD.singleFishMaxConsecutive, 2, 50),
    maxFishMessages: clampInt(src.maxFishMessages, DEFAULT_QQ_FISH_GUARD.maxFishMessages, 2, 100),
    maxFishRatio: clampNumber(src.maxFishRatio, DEFAULT_QQ_FISH_GUARD.maxFishRatio, 0, 1),
    minSample: clampInt(src.minSample, DEFAULT_QQ_FISH_GUARD.minSample, 2, 200),
    minFishSendersForRatio: clampInt(src.minFishSendersForRatio, DEFAULT_QQ_FISH_GUARD.minFishSendersForRatio, 1, 20),
    groupNestMaxFish: clampInt(src.groupNestMaxFish, DEFAULT_QQ_FISH_GUARD.groupNestMaxFish, 2, 20),
    groupNestIds: cleanList(src.groupNestIds, 200).filter((x) => /^\d{4,15}$/.test(x)),
    namePrefixes: cleanList(src.namePrefixes ?? DEFAULT_QQ_FISH_GUARD.namePrefixes),
    nameSuffixes: cleanList(src.nameSuffixes ?? DEFAULT_QQ_FISH_GUARD.nameSuffixes),
    nameContains: cleanList(src.nameContains ?? DEFAULT_QQ_FISH_GUARD.nameContains),
    groupNameSuffixes: cleanList(src.groupNameSuffixes ?? DEFAULT_QQ_FISH_GUARD.groupNameSuffixes),
    exemptNames: cleanList(src.exemptNames, 200),
    exemptIds: cleanList(src.exemptIds, 200).filter((x) => /^\d{4,15}$/.test(x)),
    fishIds: cleanList(src.fishIds, 200).filter((x) => /^\d{4,15}$/.test(x)),
    bypassDirectAddress: asBool(src.bypassDirectAddress, DEFAULT_QQ_FISH_GUARD.bypassDirectAddress),
    blockSends: asBool(src.blockSends, DEFAULT_QQ_FISH_GUARD.blockSends),
  };
}

function normalizeName(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // 同类 bot 名字带 2 / _2 / ✨ 仍应认出：去掉尾部数字与装饰符
    .replace(/[\s_\-—·.。,，!！?？~～]+$/g, '')
    .replace(/[0-9０-９]+$/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function suffixHit(name, suffixes) {
  const n = normalizeName(name);
  if (!n) return false;
  return suffixes.some((suffix) => {
    const s = normalizeName(suffix);
    return s && n.endsWith(s);
  });
}

export function isFishName(name, guard = DEFAULT_QQ_FISH_GUARD) {
  const cfg = normalizeQqFishGuard(guard);
  const n = normalizeName(name);
  if (!n) return false;
  if (cfg.exemptNames.some((x) => normalizeName(x) === n)) return false;
  // 2026-10-23 用户定：开头词 / 中间包含词 / 结尾词，任一命中就算鱼。
  const prefix = cfg.namePrefixes.some((keyword) => {
    const k = normalizeName(keyword);
    return k && n.startsWith(k);
  });
  const contains = cfg.nameContains.some((keyword) => {
    const k = normalizeName(keyword);
    return k && n.includes(k);
  });
  return prefix || contains || suffixHit(name, cfg.nameSuffixes);
}

export function isFishGroupName(name, guard = DEFAULT_QQ_FISH_GUARD) {
  const cfg = normalizeQqFishGuard(guard);
  const n = normalizeName(name);
  if (!n) return false;
  // 群名用“包含”而不是“结尾”：鱼窝群常叫「摸鱼后援会」「摸鱼肥鱼窝」，
  // 它只用于收紧阈值，不会把群里的真人算成鱼。
  return cfg.groupNameSuffixes.some((keyword) => {
    const k = normalizeName(keyword);
    return k && n.includes(k);
  });
}

function senderFish(msg, cfg) {
  if (!msg || msg.isSelf || msg.isOwner) return false;
  const uid = msg.userId != null ? String(msg.userId) : '';
  if (uid && cfg.exemptIds.includes(uid)) return false;
  if (uid && cfg.fishIds.includes(uid)) return true;
  return msg.fish === true || isFishName(msg.sender, cfg);
}

/**
 * 统计一个群最近窗口里的鱼密度。
 *
 * @param {Array<{sender?:string,userId?:string|number,isSelf?:boolean,isOwner?:boolean,time?:number,kind?:string,fish?:boolean}>} messages
 * @param {{now?:number, guard?:object, groupName?:string}} opts
 */
export function assessFishDensity(messages, { now = Date.now(), guard = DEFAULT_QQ_FISH_GUARD, groupName = '', groupId = '' } = {}) {
  const cfg = normalizeQqFishGuard(guard);
  const empty = {
    enabled: cfg.enabled,
    blocked: false,
    reason: '',
    fishCount: 0,
    fishMessages: 0,
    totalMessages: 0,
    fishRatio: 0,
    consecutiveFish: 0,
    consecutiveFishSenders: 0,
    groupIsFishNest: false,
    effectiveMaxFish: cfg.maxFish,
    windowMs: cfg.windowMs,
    fishNames: [],
  };
  if (!cfg.enabled) return empty;

  const all = Array.isArray(messages) ? messages : [];
  const cutoff = Number(now) - cfg.windowMs;
  const recentAll = all.filter((m) => m && m.kind !== 'poke' && Number(m.time || 0) > cutoff);
  const recentOthers = recentAll.filter((m) => !m.isSelf);
  const groupIsFishNest = Boolean(
    isFishGroupName(groupName, cfg)
    || (groupId && cfg.groupNestIds.includes(String(groupId)))
  );
  const effectiveMaxFish = groupIsFishNest
    ? Math.min(cfg.maxFish, cfg.groupNestMaxFish)
    : cfg.maxFish;

  const fishList = recentOthers.filter((m) => senderFish(m, cfg));
  const fishIds = new Set(fishList.map((m) => (m.userId != null ? `id:${m.userId}` : `name:${normalizeName(m.sender)}`)));
  const fishNames = [...new Set(fishList.map((m) => String(m.sender ?? '').trim()).filter(Boolean))].slice(0, 10);
  let consecutiveFish = 0;
  const consecutiveSenders = new Set();
  for (let i = recentAll.length - 1; i >= 0; i -= 1) {
    const msg = recentAll[i];
    if (senderFish(msg, cfg)) {
      consecutiveFish += 1;
      consecutiveSenders.add(msg.userId != null ? `id:${msg.userId}` : `name:${normalizeName(msg.sender)}`);
    } else break;
  }
  const totalMessages = recentOthers.length;
  const fishMessages = fishList.length;
  const fishRatio = totalMessages > 0 ? fishMessages / totalMessages : 0;
  const fishCount = fishIds.size;

  let reason = '';
  if (fishCount >= effectiveMaxFish) reason = 'fish-count';
  else if (consecutiveFish >= cfg.maxConsecutiveFish && consecutiveSenders.size >= 2) reason = 'fish-streak';
  else if (consecutiveFish >= cfg.singleFishMaxConsecutive) reason = 'fish-streak-single';
  else if (totalMessages >= cfg.minSample && fishMessages >= cfg.maxFishMessages
    && fishRatio >= cfg.maxFishRatio && fishCount >= cfg.minFishSendersForRatio) reason = 'fish-ratio';

  return {
    enabled: true,
    blocked: Boolean(reason),
    reason,
    fishCount,
    fishMessages,
    totalMessages,
    fishRatio,
    consecutiveFish,
    consecutiveFishSenders: consecutiveSenders.size,
    groupIsFishNest,
    effectiveMaxFish,
    windowMs: cfg.windowMs,
    fishNames,
  };
}
