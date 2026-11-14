// Account extraction and reply formatting ported from coser-image-search 1.0.0
// (src/fish-find-chicken.js, Copyright (c) 2026 小鲸鱼, MIT).
// Source SHA-256: 440a4ecc12e0bd251f63994a038ec36af3d51cd6b40904adaa644bea1501c3a6
// The rules, strict-consensus filtering and reply layout below are the
// upstream implementation; only imports and the bounding of exported helpers
// were adapted for this runtime. One deliberate difference: a no-account reply
// lists every similar result link (similarLinks) instead of upstream's single
// "最接近的图源" line.

const PLATFORM_RULES = [
  {
    platform: 'twitter',
    re: /^https?:\/\/(?:www\.|mobile\.|m\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{2,20})(?:\/|$|\?)/i,
    clean: (m?: any) => ({
      handle: '@' + m[1],
      handleKey: m[1].toLowerCase(),
      url: `https://x.com/${m[1]}`
    })
  },
  {
    platform: 'weibo',
    re: /^https?:\/\/(?:www\.|m\.)?weibo\.(?:com|cn)\/(?:u\/|n\/)?(\d{6,}|[A-Za-z0-9_\-]{3,40})(?:\/|$|\?)/i,
    clean: (m?: any) => ({ handle: m[1], handleKey: m[1].toLowerCase() })
  },
  {
    platform: 'bilibili',
    re: /^https?:\/\/(?:space\.bilibili\.com|www\.bilibili\.com\/space)\/(\d{3,})(?:\/|$|\?)/i,
    clean: (m?: any) => ({ handle: m[1], handleKey: m[1] })
  },
  {
    platform: 'instagram',
    re: /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})\/?(?:\?|$)/i,
    clean: (m?: any) => ({ handle: '@' + m[1], handleKey: m[1].toLowerCase() })
  },
  {
    platform: 'pixiv',
    re: /^https?:\/\/(?:www\.)?pixiv\.net\/(?:(?:en\/)?users\/(\d{2,})|member\.php\?(?:[^#]*&)?id=(\d{2,}))/i,
    clean: (m?: any) => {
      const id = m[1] ?? m[2];
      return { handle: id, handleKey: id, url: `https://www.pixiv.net/users/${id}` };
    }
  }
];

const BILIBILI_AUTHOR_RE = /\/(?:opus|video|read)\/.*?(?:mid=|space\.bilibili\.com\/)(\d{3,})/i;

const PLATFORM_WEIGHT = { twitter: 1, weibo: 2, bilibili: 3, instagram: 4, pixiv: 9 };

const ARTWORK_PLATFORMS = new Set<any>(['pixiv']);

const PATH_DENY = {
  weibo: ['ttarticle', 'p', 'show', 'status', 'detail', 'photo', 'video', 'article', 'fav', 'like', 'comment', 'search', 'hot', 'topic', 'tv', 'page', 's', 'weibo', 'login', 'signup', 'reg'],
  twitter: ['i', 'intent', 'share', 'home', 'search', 'hashtag', 'status', 'explore', 'notifications', 'messages', 'settings', 'login', 'signup', 'tos', 'privacy', 'account'],
  instagram: ['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'about', 'legal', 'directory'],
  bilibili: ['video', 'read', 'opus', 'bangumi', 'search', 'account'],
  pixiv: ['artworks', 'i', 'en', 'tags', 'search', 'ranking', 'novel', 'ajax']
};

function matchPlatform(url?: any) {
  for (const rule of PLATFORM_RULES) {
    const m = String(url ?? '').match(rule.re);
    if (!m) continue;
    const handle = String(m[1] ?? '');
    const deny = PATH_DENY[rule.platform] ?? [];
    if (deny.includes(handle.toLowerCase())) continue;
    if (rule.platform === 'weibo') {
      if (!/^\d+$/.test(handle) && !/^[A-Za-z0-9_\-]{3,}$/.test(handle)) continue;
    }
    if (rule.platform === 'instagram' && /^(p|reel|explore|accounts|stories)$/i.test(handle)) continue;
    if (rule.platform === 'twitter' && /^(i|intent|share|home|search)$/i.test(handle)) continue;
    const cleaned: any = rule.clean(m);
    return { platform: rule.platform, ...cleaned, url: cleaned.url || String(url) };
  }
  return null;
}

export function looksLikePersonName(value?: any) {
  const text = String(value ?? '').trim();
  if (text.length < 2 || text.length > 24) return false;
  if (/["':：/|]/.test(text)) return false;
  if (/\b(on|via|by)\s+(x|twitter|instagram|ig|weibo|bilibili|tiktok|facebook|threads)\b/i.test(text)) return false;
  return true;
}

export function normalizePersonName(value?: any) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s\-_·・.,，。:：;；!！?？'"“”‘’()（）\[\]【】{}<>《》|/\\~—–]+/g, '');
}

export function dominantPersonName(candidates?: any, { minHits = 1, minPrefix = 4 }: { minHits?: number; minPrefix?: number; [key: string]: any } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const titles = list
    .map((candidate?: any) => normalizePersonName(`${candidate?.title ?? ''} ${candidate?.snippet ?? ''}`))
    .filter((text?: any) => text.length >= minPrefix);
  if (!titles.length) return { name: '', prefix: '', hits: 0 };
  const names = new Map();
  const add = (raw?: any) => {
    const key = normalizePersonName(raw);
    if (key.length < minPrefix || names.has(key)) return;
    names.set(key, String(raw ?? '').trim());
  };
  for (const candidate of list) {
    add(candidate?.authorName);
    add(profileTitleName(String(candidate?.title ?? '')).name);
    add(socialNameFromTitle(String(candidate?.title ?? '')));
    add(nameFromTitleMention(String(candidate?.title ?? '')));
  }
  let best = { name: '', prefix: '', hits: 0 };
  const keys = [...names.keys()].sort((a?: any, b?: any) => a.length - b.length);
  for (const key of keys) {
    for (let len = Math.min(key.length, 12); len >= minPrefix; len -= 1) {
      const head = key.slice(0, len);
      const hits = titles.filter((text?: any) => text.includes(head)).length - 1;
      if (hits < minHits) continue;
      if (hits > best.hits) best = { name: names.get(key) ?? key, prefix: head, hits };
      break;
    }
  }
  return best;
}

export function extractAccounts(candidates?: any, { max = 3, onDrop = null, strictNames = true }: { max?: number; onDrop?: any; strictNames?: boolean; [key: string]: any } = {}) {
  const out = [];
  const seen = new Set<any>();
  const list = Array.isArray(candidates) ? candidates : [];
  for (const candidate of list) {
    const authorHit = candidate?.authorUrl ? matchPlatform(candidate.authorUrl) : null;
    const authorKey = authorHit ? authorHit.platform + '|' + authorHit.handleKey : '';
    const urls = [];
    for (const value of [candidate?.authorUrl, candidate?.sourceUrl, candidate?.url, ...(candidate?.links ?? [])]) {
      if (value) urls.push(value);
    }
    for (const text of [candidate?.title, candidate?.snippet]) {
      const found = String(text ?? '').match(/https?:\/\/[^\s"'<>）)]+/g);
      if (found) urls.push(...found);
    }
    for (const url of urls) {
      const hit = matchPlatform(url);
      if (!hit) continue;
      const dedupe = hit.platform + '|' + hit.handleKey;
      const profileName = profileTitleName(candidate?.title);
      const fallbackName = authorNameFromTitle(candidate?.title);
      const ownName =
        profileName.name ||
        socialNameFromTitle(candidate?.title) ||
        String(candidate?.authorName ?? '') ||
        (dedupe === authorKey || !looksLikePersonName(fallbackName) ? '' : fallbackName);
      if (seen.has(dedupe)) {
        const existing = out.find((item?: any) => item.platform + '|' + String(item.handle ?? '').replace(/^@/, '').toLowerCase() === dedupe);
        if (existing && !existing.authorName && ownName) existing.authorName = ownName;
        continue;
      }
      seen.add(dedupe);
      out.push({
        platform: hit.platform,
        handle: hit.handle,
        url: hit.url,
        authorName: ownName,
        confidence: candidate.weak ? 'weak' : 'direct',
        evidence: {
          engine: candidate.engine ?? '',
          similarity: candidate.similarity ?? null,
          sourceUrl: candidate.sourceUrl ?? ''
        }
      });
    }
    const bili = String(candidate?.sourceUrl ?? '').match(BILIBILI_AUTHOR_RE);
    if (bili) {
      const dedupe = 'bilibili|' + bili[1];
      if (!seen.has(dedupe)) {
        seen.add(dedupe);
        out.push({
          platform: 'bilibili',
          handle: bili[1],
          url: `https://space.bilibili.com/${bili[1]}`,
          confidence: candidate.weak ? 'weak' : 'direct',
          evidence: {
            engine: candidate.engine ?? '',
            similarity: candidate.similarity ?? null,
            sourceUrl: candidate.sourceUrl ?? ''
          }
        });
      }
    }
  }
  const canonicalScore = (account?: any) => {
    const url = String(account.url ?? '');
    if (/\/u\/\d{3,}/.test(url)) return 3;
    if (/space\.bilibili\.com\/\d+/.test(url)) return 3;
    if (/members?\.php\?|pixiv\.net\/users\/\d+/.test(url)) return 3;
    if (/\/(?:n|profile)\//.test(url)) return 1;
    return 2;
  };
  const bySource = new Map();
  const rank = (account?: any) => (account.confidence === 'direct' ? 0 : account.confidence === 'weak' ? 1 : 2);
  for (const account of out) {
    const group = `${account.platform}|${account.evidence?.sourceUrl || account.url || ''}`;
    const prev = bySource.get(group);
    if (!prev) { bySource.set(group, account); continue; }
    if (rank(account) < rank(prev)) { bySource.set(group, account); continue; }
    if (rank(account) === rank(prev) && canonicalScore(account) > canonicalScore(prev)) bySource.set(group, account);
  }
  const deduped = [...new Set<any>(bySource.values())];
  const consensus = dominantPersonName(list);
  const artworkOnly = deduped.length > 0 && deduped.every((account?: any) => ARTWORK_PLATFORMS.has(account.platform));
  const nameOf = (account?: any) => normalizePersonName(account?.authorName);
  const namedMatch = consensus.prefix && !artworkOnly
    ? deduped.filter((account?: any) => {
      const name = nameOf(account);
      if (!name) return false;
      return name.startsWith(consensus.prefix) || consensus.prefix.startsWith(name);
    })
    : [];
  const strictName = strictNames !== false && Boolean(consensus.prefix) && !artworkOnly;
  const keptList = strictName ? namedMatch : deduped;
  if (strictName && typeof onDrop === 'function') {
    for (const account of deduped) {
      if (namedMatch.includes(account)) continue;
      try { onDrop({ account, consensus }); } catch {}
    }
  }
  keptList.sort((a?: any, b?: any) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const sa = a.evidence?.similarity ?? -1;
    const sb = b.evidence?.similarity ?? -1;
    if (sb !== sa) return sb - sa;
    return (PLATFORM_WEIGHT[a.platform] ?? 9) - (PLATFORM_WEIGHT[b.platform] ?? 9);
  });
  return keptList.slice(0, Math.max(1, Number(max) || 3));
}

export function dropWeakArtwork(accounts?: any, minSimilarity: number = 0.8) {
  const min = Number(minSimilarity);
  const limit = Number.isFinite(min) && min > 0 ? min : 0.8;
  const kept = [];
  let dropped = 0;
  for (const account of Array.isArray(accounts) ? accounts : []) {
    if (!ARTWORK_PLATFORMS.has(account?.platform)) { kept.push(account); continue; }
    const similarity = Number(account?.evidence?.similarity ?? 0);
    if (Number.isFinite(similarity) && similarity >= limit) kept.push(account);
    else dropped += 1;
  }
  return { accounts: kept, dropped };
}

function platformLabel(platform?: any) {
  const name = ({ twitter: 'Twitter', weibo: '微博', bilibili: 'B站', instagram: 'Instagram', pixiv: 'Pixiv' })[platform] ?? platform;
  return ARTWORK_PLATFORMS.has(platform) ? `${name}（画作平台）` : name;
}

export function authorNameFromTitle(title?: any) {
  const text = trimText(stripTags(String(title ?? '')), 120);
  if (!text) return '';
  const cleaned = text
    .replace(/【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const candidate = cleaned || text;
  return candidate.length >= 2 && candidate.length <= 24 ? candidate : '';
}

export function nameFromTitleMention(title?: any) {
  const text = String(title ?? '');
  if (!text) return '';
  const patterns = [
    /CN\s*[:：]\s*([\p{L}\p{N}_@.]{2,24})/iu,
    /(?:coser|cosplayer|cos)\s*[:：\-_]\s*([\p{L}\p{N}_@.]{2,24})/iu,
    /(?:博主|coser|cosplayer)(?![吧网站群])([\u4e00-\u9fff][\p{L}\p{N}_@.]{1,23})/iu
  ];
  for (const pattern of patterns) {
    const hit = text.match(pattern);
    if (!hit) continue;
    const name = String(hit[1] ?? '').replace(/^(?:吧|网|站|群|们|的)+/, '').trim();
    if (name && looksLikePersonName(name)) return name;
  }
  return '';
}

export function socialNameFromTitle(title?: any) {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const m = text.match(
    /^(?:X|Twitter|推特|Instagram|IG|Ins|TikTok|抖音|微博|Weibo|Bilibili|哔哩哔哩|Facebook|Threads)\s*(.{1,32}?)\s*on\s*(?:X|Twitter|Instagram|TikTok|Facebook|Threads|微博|Bilibili)\b/i
  );
  if (!m) return '';
  return m[1].trim().replace(/[:："'“”]+$/, '').slice(0, 40);
}

export function profileTitleName(title?: any) {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { name: '', handle: '' };
  const m = text.match(
    /^(?:X|Twitter|推特|Instagram|IG|Ins|TikTok|抖音|微博|Weibo|Bilibili|哔哩哔哩|Facebook|Threads)\s*(.{1,40}?)\s*[（(]\s*@?([A-Za-z0-9_.\-]{2,30})\s*[)）]/i
  );
  if (!m) return { name: '', handle: '' };
  const name = m[1].trim().replace(/[:：]+$/, '');
  return { name, handle: m[2] };
}

export function accountNameOf(account?: any, candidates: any[] = []) {
  const url = String(account?.url ?? '');
  const nick = url.match(/weibo\.com\/n\/([^/?#]+)/i);
  if (nick) {
    try { return decodeURIComponent(nick[1]); } catch { return nick[1]; }
  }
  const handle = String(account?.handle ?? '').replace(/^@/, '');
  const own = String(account?.authorName ?? '').trim();
  if (own) return own;
  const source = account?.evidence?.sourceUrl ?? '';
  const list = Array.isArray(candidates) ? candidates : [];
  const same = list.find((c?: any) => c?.sourceUrl && source && c.sourceUrl === source)
    ?? list.find((c?: any) => c?.sourceUrl && c.title);
  const fromTitle = same
    ? profileTitleName(same.title).name || authorNameFromTitle(same.title)
    : '';
  if (fromTitle) return fromTitle;
  if (handle && !/^\d+$/.test(handle)) return handle;
  return '未知';
}

function displayHandle(account?: any) {
  const handle = String(account?.handle ?? '').replace(/^@/, '').trim();
  if (!handle) return '未知';
  return /^\d+$/.test(handle) ? handle : `@${handle}`;
}

export function formatReply({ accounts = [], candidates = [], enginesUsed = [], failures = [], cached = false, withImage = false, artworkDropped = 0, nameDropped = 0, consensusName = '', droppedHandles = [] }: { accounts?: any[]; candidates?: any[]; enginesUsed?: any[]; failures?: any[]; cached?: boolean; withImage?: boolean; artworkDropped?: number; nameDropped?: number; consensusName?: string; droppedHandles?: any[]; [key: string]: any } = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  const pool = (Array.isArray(candidates) ? candidates : []).filter((c?: any) => c?.sourceUrl);
  const consensusKey = normalizePersonName(consensusName);
  const decode = (value?: any) => {
    try { return decodeURIComponent(String(value ?? '')); }
    catch { return String(value ?? ''); }
  };
  const top = (consensusKey
    ? pool.find((candidate?: any) => normalizePersonName(`${candidate?.title ?? ''} ${decode(candidate?.sourceUrl)}`).includes(consensusKey))
    : null) ?? pool[0] ?? null;
  if (list.length) {
    const blocks = list.map((account?: any) => {
      const url = String(account?.url ?? '').trim();
      const guess = account.confidence === 'inferred'
        ? '（推断，未核实）'
        : account.confidence === 'weak' ? '（相似图，未核实）' : '';
      const handle = `${displayHandle(account)}${url ? ` · ${url}` : ''}`;
      return [
        `🌐 平台：${platformLabel(account.platform)}`,
        `👤 名字：${accountNameOf(account, candidates)}`,
        `🆔 账号：${handle}${guess}`
      ].join('\n');
    });
    const head = `🎯 **鱼鱼找鸡结果**${cached ? '（缓存）' : ''}`;
    let text = [head, '', blocks.join('\n\n')].join('\n');
    if (list.every((account?: any) => ARTWORK_PLATFORMS.has(account?.platform))) {
      text += '\n\n· Pixiv 是画作平台（画师的作品页），不是 coser 本人的账号；真人号一般在推特';
    }
    if (text.length > 900) text = text.slice(0, 897) + '…';
    return text;
  }
  const tried = enginesUsed.length ? engineLabels(enginesUsed).join(' / ') : '';
  const why = failures.length ? `（${failures.map((f?: any) => `${f.engine}:${trimText(f.reason, 30)}`).join('；')}）` : '';
  const cacheTag = cached ? '（缓存）' : '';
  const head = !enginesUsed.length
    ? `❌ 这次没查成，一个引擎都没跑通${why ? ' ' + why : ''}`
    : Number(candidates?.length ?? 0) > 0
      ? `❌ 没查到账号。${tried}${cacheTag}翻到 ${candidates.length} 条相似图，但没有能确认的账号${why ? ' ' + why : ''}`
      : `❌ 没查到账号。${tried}${cacheTag}，都空——这种一般是私图、新图，或者裁过${why ? ' ' + why : ''}`;
  const lines = [`🎯 **鱼鱼找鸡结果**`, '', head];
  if (Number(artworkDropped) > 0) {
    lines.push(`只翻到 ${Number(artworkDropped)} 张相似画作（相似度不够，没当成图源）；真人 coser 的号一般在推特`);
  }
  if (Number(nameDropped) > 0) {
    const handles = (Array.isArray(droppedHandles) ? droppedHandles : [])
      .map((handle?: any) => String(handle ?? '').trim())
      .filter(Boolean)
      .slice(0, 3);
    const shown = handles.length ? `（${handles.join('、')}）` : '';
    lines.push(`翻到 ${Number(nameDropped)} 个别人的号${shown}，名字对不上${consensusName ? `「${trimText(consensusName, 24)}」` : '主轴'}，没当成这个人报`);
  }
  let text = lines.join('\n');
  if (text.length > 900) text = text.slice(0, 897) + '…';
  // Chopsticks change (not upstream): list every similar result instead of one
  // truncated "最接近的图源". The consensus pick, when there is one, stays first.
  const ordered = top ? [top, ...pool.filter((candidate?: any) => candidate !== top)] : pool;
  return text + similarLinks(ordered, REPLY_LIMIT - text.length);
}

const REPLY_LIMIT = 3000;
const LINK_LIMIT = 600;

/**
 * Numbered "engine + title / full URL" entries for a no-account reply. A link
 * is listed whole or not at all: a cut URL cannot be opened, so entries that do
 * not fit the remaining budget are counted instead of truncated.
 */
function similarLinks(pool?: any, budget: number = REPLY_LIMIT) {
  const heading = '\n相似图：';
  const skippedNote = (count: number) => `\n另有 ${count} 条链接过长没列出`;
  const reserve = skippedNote(99).length;
  const seen = new Set<any>();
  const entries = [];
  let used = heading.length;
  let skipped = 0;
  for (const candidate of Array.isArray(pool) ? pool : []) {
    const url = String(candidate?.sourceUrl ?? '').trim();
    if (!url || /\s/.test(url) || seen.has(url)) continue;
    seen.add(url);
    const similarity = Number(candidate?.similarity);
    const percent = candidate?.similarity != null && Number.isFinite(similarity) && similarity > 0 && similarity <= 1
      ? `${Math.round(similarity * 100)}%` : '';
    const tag = [ENGINE_LABELS[candidate?.engine] ?? '', percent].filter(Boolean).join(' ');
    const described = [tag ? `[${tag}]` : '', trimText(stripTags(candidate?.title), 60)].filter(Boolean).join(' ');
    const entry = `\n${entries.length + 1}.${described ? ' ' + described : ''}\n${url}`;
    if (url.length > LINK_LIMIT || used + entry.length + reserve > budget) { skipped += 1; continue; }
    entries.push(entry);
    used += entry.length;
  }
  return (entries.length ? heading + entries.join('') : '') + (skipped ? skippedNote(skipped) : '');
}

const ENGINE_LABELS = {
  saucenao: 'SauceNAO',
  lens: '谷歌 Lens',
  tracemoe: '动漫截图溯源',
  iqdb: 'IQDB',
  baidu: '百度识图',
  bing: '必应',
  yandex: 'Yandex',
  google: '谷歌识图'
};

export function engineLabels(engines?: any) {
  const list = Array.isArray(engines) ? engines : [];
  return list.map((id?: any) => ENGINE_LABELS[id] ?? String(id)).filter(Boolean);
}

function decodeEntities(s?: any) {
  return String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_?: any, d?: any) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_?: any, h?: any) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(s?: any) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function trimText(s?: any, max?: any) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
