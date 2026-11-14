import test from 'node:test';
import assert from 'node:assert/strict';

let extractAccounts, dominantPersonName, formatReply, dropWeakArtwork, socialNameFromTitle;
try {
  ({ extractAccounts, dominantPersonName, formatReply, dropWeakArtwork, socialNameFromTitle } = await import('../src/image-source/accounts.mjs'));
} catch {}

test('source account extraction keeps only URL-backed social accounts', () => {
  assert.equal(typeof extractAccounts, 'function');
  const accounts = extractAccounts([
    { sourceUrl: 'https://x.com/SuSu_/status/1', title: 'XSuSu_ on X: "hello"', engine: 'lens' },
    { sourceUrl: 'https://weibo.com/u/1234567890', title: '微博', engine: 'lens' },
    { sourceUrl: 'https://space.bilibili.com/12345', title: 'B站', engine: 'lens' },
    { sourceUrl: 'https://www.bilibili.com/video/BV1xx?mid=54321', title: '视频', engine: 'lens' },
    { sourceUrl: 'https://www.instagram.com/abc.def/', title: 'Instagram abc.def(@abc.def)', engine: 'lens' },
    { sourceUrl: 'https://www.pixiv.net/users/98765', title: 'Pixiv', engine: 'lens' },
  ], { max: 6, strictNames: false });
  assert.deepEqual(accounts.map((account?: any) => [account.platform, account.handle, account.url]), [
    ['twitter', '@SuSu_', 'https://x.com/SuSu_'],
    ['weibo', '1234567890', 'https://weibo.com/u/1234567890'],
    ['bilibili', '12345', 'https://space.bilibili.com/12345'],
    ['bilibili', '54321', 'https://space.bilibili.com/54321'],
    ['instagram', '@abc.def', 'https://www.instagram.com/abc.def/'],
    ['pixiv', '98765', 'https://www.pixiv.net/users/98765'],
  ]);
  assert.equal(accounts[0].authorName, 'SuSu_');
});

test('source account extraction refuses reserved paths, look-alikes and unsupported platforms', () => {
  const accounts = extractAccounts([
    { sourceUrl: 'https://x.com/i/status/1', title: 'X' },
    { sourceUrl: 'https://weibo.com/ttarticle/p/show?id=1', title: '微博' },
    { sourceUrl: 'https://www.instagram.com/abc.def/p/xyz/', title: 'Instagram' },
    { sourceUrl: 'https://x.com.evil.test/foo', title: 'X' },
    { sourceUrl: 'https://x.com@127.0.0.1/foo', title: 'X' },
    { sourceUrl: 'https://www.tiktok.com/@abc', title: 'TikTok abc on TikTok' },
    { sourceUrl: 'https://www.facebook.com/abc', title: 'Facebook abc on Facebook' },
    { sourceUrl: 'https://www.threads.net/@abc', title: 'Threads abc on Threads' },
    { sourceUrl: 'https://www.xiaohongshu.com/user/profile/abc12345', title: '小红书' },
    { sourceUrl: 'https://anilist.co/anime/1', title: 'AniList' },
  ], { max: 6, strictNames: false });
  assert.deepEqual(accounts, []);
});

test('strict consensus keeps only accounts whose names match the dominant name', () => {
  const candidates = [
    { sourceUrl: 'https://x.com/alice/status/1', title: 'XAlice on X: "same"', engine: 'lens' },
    { sourceUrl: 'https://x.com/bob/status/2', title: 'XBob on X: "same"', engine: 'lens' },
    { sourceUrl: 'https://x.com/alice/status/3', title: 'XAlice on X: "same2"', engine: 'lens' },
  ];
  const consensus = dominantPersonName(candidates);
  assert.equal(consensus.name, 'Alice');
  const accounts = extractAccounts(candidates, { max: 3, strictNames: true });
  assert.deepEqual(accounts.map((account?: any) => account.handle), ['@alice']);
  assert.equal(socialNameFromTitle('XAlice on X: "same"'), 'Alice');
});

test('strictNames=false returns all URL-backed accounts for the caller to pick', () => {
  const candidates = [
    { sourceUrl: 'https://x.com/alice/status/1', title: 'XAlice on X: "same"' },
    { sourceUrl: 'https://x.com/bob/status/2', title: 'XBob on X: "same"' },
    { sourceUrl: 'https://x.com/alice/status/3', title: 'XAlice on X: "same2"' },
  ];
  const accounts = extractAccounts(candidates, { max: 3, strictNames: false });
  assert.deepEqual(accounts.map((account?: any) => account.handle).sort(), ['@alice', '@bob']);
});

test('formatReply matches the source layout and labels candidate confidence', () => {
  const candidates = [{ sourceUrl: 'https://x.com/susu/status/1', title: 'XSuSu on X: "hi"' }];
  const accounts = [{ platform: 'twitter', handle: '@susu', url: 'https://x.com/susu', authorName: 'SuSu', confidence: 'direct', evidence: { sourceUrl: 'https://x.com/susu/status/1' } }];
  const text = formatReply({ accounts, candidates, enginesUsed: ['lens'], failures: [] });
  assert.match(text, /^🎯 \*\*鱼鱼找鸡结果\*\*\n\n🌐 平台：Twitter\n👤 名字：SuSu\n🆔 账号：@susu · https:\/\/x\.com\/susu$/);
});

test('formatReply distinguishes no engines, similar images and empty results', () => {
  assert.match(formatReply({ accounts: [], candidates: [], enginesUsed: [], failures: [] }), /一个引擎都没跑通/);
  assert.match(formatReply({ accounts: [], candidates: [{ sourceUrl: 'https://x.com/a/status/1' }], enginesUsed: ['lens'], failures: [] }), /没查到账号。谷歌 Lens翻到 1 条相似图/);
  assert.match(formatReply({ accounts: [], candidates: [], enginesUsed: ['lens'], failures: [] }), /都空/);
});

// Regression (2026-11-13): a no-account reply showed one "最接近的图源" cut to
// 120 characters and dropped every other similar result.
test('a no-account reply lists every similar-image link in full', () => {
  const long = `https://example.org/gallery/${'a'.repeat(160)}`;
  const candidates = [
    { engine: 'saucenao', title: 'Pixiv work', sourceUrl: 'https://pixiv.net/artworks/1', similarity: 0.91 },
    { engine: 'lens', title: 'Some blog post', sourceUrl: long, similarity: null },
    { engine: 'lens', title: '', sourceUrl: 'https://danbooru.donmai.us/posts/9', similarity: null },
  ];
  const text = formatReply({ accounts: [], candidates, enginesUsed: ['saucenao', 'lens'], failures: [{ engine: 'iqdb', reason: '上游繁忙' }] });
  assert.match(text, /翻到 3 条相似图/);
  assert.doesNotMatch(text, /最接近的图源/);
  const lines = text.split('\n');
  for (const candidate of candidates) assert.ok(lines.includes(candidate.sourceUrl), `missing full link ${candidate.sourceUrl.slice(0, 40)}`);
  assert.match(text, /1\. \[SauceNAO 91%\] Pixiv work/);
  assert.match(text, /2\. \[谷歌 Lens\] Some blog post/);
  assert.match(text, /3\. \[谷歌 Lens\]\n/);
  assert.doesNotMatch(text, /NaN|null|undefined/);
});

test('similar-image links stay bounded and are never cut mid-URL', () => {
  const huge = `https://example.org/${'b'.repeat(5000)}`;
  const candidates = [
    { engine: 'lens', title: 'first', sourceUrl: 'https://example.org/first' },
    { engine: 'lens', title: 'huge', sourceUrl: huge },
    { engine: 'lens', title: 'last', sourceUrl: 'https://example.org/last' },
  ];
  const text = formatReply({ accounts: [], candidates, enginesUsed: ['lens'], failures: [] });
  assert.ok(text.length <= 3500, `reply too long: ${text.length}`);
  const lines = text.split('\n');
  assert.ok(lines.includes('https://example.org/first'));
  assert.ok(lines.includes('https://example.org/last'));
  assert.doesNotMatch(text, /bbbbbbbb/);
  assert.match(text, /另有 1 条链接过长没列出/);
});

test('a reply with accounts keeps the source layout and does not append the similar-image list', () => {
  const candidates = [
    { engine: 'lens', sourceUrl: 'https://x.com/susu/status/1', title: 'XSuSu on X: "hi"' },
    { engine: 'lens', sourceUrl: 'https://example.org/other', title: 'other' },
  ];
  const accounts = [{ platform: 'twitter', handle: '@susu', url: 'https://x.com/susu', authorName: 'SuSu', confidence: 'direct', evidence: { sourceUrl: 'https://x.com/susu/status/1' } }];
  const text = formatReply({ accounts, candidates, enginesUsed: ['lens'], failures: [] });
  assert.doesNotMatch(text, /相似图：|example\.org/);
});

test('Pixiv-only accounts carry the artwork-platform caveat, and weak artwork can be dropped', () => {
  const accounts = [{ platform: 'pixiv', handle: '123', url: 'https://www.pixiv.net/users/123', authorName: '', confidence: 'weak', evidence: { similarity: 0.4 } }];
  const text = formatReply({ accounts, candidates: [], enginesUsed: ['lens'], failures: [] });
  assert.match(text, /Pixiv（画作平台）/);
  assert.match(text, /Pixiv 是画作平台/);
  assert.match(text, /相似图，未核实/);
  assert.deepEqual(dropWeakArtwork(accounts, 0.8), { accounts: [], dropped: 1 });
});
