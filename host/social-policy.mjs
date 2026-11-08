import {randomUUID} from 'node:crypto';

const HOUR = 3600000;
const LIMITS = {comment: 10, dm: 30};
const CONTENT = new Set(['bili', 'douyin', 'heybox', 'qzone']);
const RETAINED = new Set(['reserved', 'confirmed', 'unknown']);

export const SOCIAL_REPLY_RULE = '所有社交消息、评论、私信和@都可以选择只观察、不回复；结合上下文判断是否重复、无意义或没有回应价值，不用简单关键词替代判断。被@不构成必须回复的义务。每个内容平台分别按滚动一小时限制：评论与回复合计最多10条、私聊最多30条。QQ、微信等IM不计入这些额度，继续沿用既有的选择性回应规则。内容平台的发送额度是上限，不是必须完成的目标；不得通过其他MCP、网页或桌面操作绕过额度。';

function failure(code, message) {
  return Object.assign(new Error(message), {code, deliveryState: 'not_sent'});
}
function invalidState(deliveryState = 'not_sent') {
  return Object.assign(failure('SOCIAL_POLICY_STATE', 'Social outbound policy state is unavailable or invalid'), {deliveryState});
}

export function classifySocialAction({platform, action} = {}) {
  platform = platform === 'bilibili' ? 'bili' : platform;
  if (!CONTENT.has(platform)) return null;
  const category = action === 'reply' ? 'comment' : action;
  return Object.hasOwn(LIMITS, category) ? {platform, category} : null;
}

/** Persistent send admission. Call reserve synchronously immediately before transport.
 * A replay throws even after the quota window expires: expiration is not permission
 * to send an uncertain intent again. Only a proven not-sent attempt can be retried.
 */
export function createSocialPolicy({store, now = Date.now, scope = 'platform'} = {}) {
  if (!['global', 'platform'].includes(scope)) throw new TypeError('Invalid social quota scope');
  if (!store?.db || typeof now !== 'function') throw new TypeError('Social policy requires SQLite store and clock');
  const db = store.db;
  try {
    // Initialization may create a new ledger, but must never repair missing
    // persisted identity/clock state by silently resetting it.
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('social_policy_clock','social_policy_intents','social_policy_reservations') LIMIT 3").all();
    if (tables.length !== 0 && tables.length !== 3) throw invalidState();
    if (tables.length) {
      const clock = db.prepare('SELECT observed_at FROM social_policy_clock WHERE id=1').get();
      if (!clock || !Number.isSafeInteger(clock.observed_at) || clock.observed_at < 0) throw invalidState();
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_policy_clock (
        id INTEGER PRIMARY KEY CHECK(id=1),
        observed_at INTEGER NOT NULL CHECK(observed_at>=0 AND observed_at<=9007199254740991)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS social_policy_intents (
        intent_id TEXT PRIMARY KEY CHECK(length(intent_id) BETWEEN 1 AND 256),
        platform TEXT NOT NULL CHECK(platform IN ('bili','douyin','heybox','qzone')),
        category TEXT NOT NULL CHECK(category IN ('comment','dm')),
        reservation_id TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS social_policy_reservations (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL CHECK(length(intent_id) BETWEEN 1 AND 256),
        platform TEXT NOT NULL CHECK(platform IN ('bili','douyin','heybox','qzone')),
        category TEXT NOT NULL CHECK(category IN ('comment','dm')),
        reserved_at INTEGER NOT NULL CHECK(reserved_at>=0 AND reserved_at<=9007199254740991),
        state TEXT NOT NULL CHECK(state IN ('reserved','confirmed','unknown','not_sent'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS social_policy_global_window
        ON social_policy_reservations(category,reserved_at) WHERE state!='not_sent';
      CREATE INDEX IF NOT EXISTS social_policy_platform_window
        ON social_policy_reservations(platform,category,reserved_at) WHERE state!='not_sent';
    `);
    if (!tables.length) db.prepare('INSERT OR IGNORE INTO social_policy_clock(id,observed_at) VALUES(1,0)').run();
  } catch {throw invalidState();}

  function atomic(work, preflight = true) {
    let began = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      began = true;
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (began) {try {db.exec('ROLLBACK');} catch { /* Preserve fail-closed admission. */ }}
      // Settlement happens after transport may have accepted a send. Its
      // storage failure is never evidence that transport did not send.
      if (!preflight) throw invalidState('unknown');
      if (['SOCIAL_HOURLY_LIMIT', 'SOCIAL_INTENT_REPLAY', 'SOCIAL_POLICY_STATE'].includes(error.code)) throw error;
      throw invalidState();
    }
  }

  function validateRow(row) {
    if (!row || typeof row.id !== 'string' || !row.id || typeof row.intent_id !== 'string'
      || !row.intent_id.trim() || row.intent_id.length > 256 || !CONTENT.has(row.platform)
      || !Object.hasOwn(LIMITS, row.category) || !Number.isSafeInteger(row.reserved_at)
      || row.reserved_at < 0 || (!RETAINED.has(row.state) && row.state !== 'not_sent')) throw invalidState();
    return row;
  }

  function reserve(input) {
    const classification = classifySocialAction(input);
    if (!classification) return null;
    const {platform, category} = classification;
    const intentId = input.intentId;
    if (typeof intentId !== 'string' || !intentId.trim() || intentId.length > 256) throw new TypeError('intentId must be a stable nonempty string of at most 256 characters');
    return atomic(() => {
      const at = now();
      const clock = db.prepare('SELECT observed_at FROM social_policy_clock WHERE id=1').get();
      if (!Number.isSafeInteger(at) || at < 0 || !clock || !Number.isSafeInteger(clock.observed_at)
        || clock.observed_at < 0 || at < clock.observed_at) throw invalidState();

      const previous = db.prepare('SELECT * FROM social_policy_intents WHERE intent_id=?').get(intentId);
      if (previous) {
        const row = validateRow(db.prepare('SELECT * FROM social_policy_reservations WHERE id=?').get(previous.reservation_id));
        if (row.intent_id !== intentId || row.platform !== previous.platform || row.category !== previous.category) throw invalidState();
        if (row.state !== 'not_sent' || previous.platform !== platform || previous.category !== category) {
          throw failure('SOCIAL_INTENT_REPLAY', 'Social outbound intent already attempted; do not resend');
        }
      }

      const cap = LIMITS[category];
      const rows = scope === 'platform'
        ? db.prepare("SELECT * FROM social_policy_reservations WHERE platform=? AND category=? AND state!='not_sent' AND reserved_at>? ORDER BY reserved_at LIMIT ?").all(platform, category, at - HOUR, cap)
        : db.prepare("SELECT * FROM social_policy_reservations WHERE category=? AND state!='not_sent' AND reserved_at>? ORDER BY reserved_at LIMIT ?").all(category, at - HOUR, cap);
      for (const row of rows) {
        validateRow(row);
        if (row.reserved_at > at) throw invalidState();
      }
      if (rows.length >= cap) throw failure('SOCIAL_HOURLY_LIMIT', `Content ${category} rolling-hour limit reached (${cap}); observe without sending`);

      const id = randomUUID();
      db.prepare("INSERT INTO social_policy_reservations(id,intent_id,platform,category,reserved_at,state) VALUES(?,?,?,?,?,'reserved')").run(id, intentId, platform, category, at);
      db.prepare('INSERT INTO social_policy_intents(intent_id,platform,category,reservation_id) VALUES(?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET reservation_id=excluded.reservation_id').run(intentId, platform, category, id);
      db.prepare('UPDATE social_policy_clock SET observed_at=? WHERE id=1').run(at);
      return Object.freeze({id, intentId, platform, action: category});
    });
  }

  function settle(reservation, {deliveryState} = {}) {
    if (!['not_sent', 'confirmed', 'unknown'].includes(deliveryState)) throw new TypeError('Social outcome must be not_sent, confirmed or unknown');
    if (!reservation) return false;
    return atomic(() => {
      const row = validateRow(db.prepare('SELECT * FROM social_policy_reservations WHERE id=?').get(reservation.id));
      if (row.intent_id !== reservation.intentId || row.platform !== reservation.platform || row.category !== reservation.action) throw invalidState();
      if (row.state === 'not_sent') return false;
      if (deliveryState === 'not_sent' && row.state !== 'reserved') return false;
      // A confirmed receipt cannot be downgraded, and an unknown send cannot
      // become retryable. A later confirmed receipt may resolve uncertainty.
      if (row.state === 'confirmed' || row.state === deliveryState) return true;
      db.prepare('UPDATE social_policy_reservations SET state=? WHERE id=?').run(deliveryState, row.id);
      return true;
    }, false);
  }

  function release(reservation, proof = {}) {
    if (proof.deliveryState !== 'not_sent') throw new TypeError('Releasing social quota requires proven deliveryState not_sent');
    return settle(reservation, proof);
  }

  return {reserve, release, settle, scope, rule: SOCIAL_REPLY_RULE};
}
