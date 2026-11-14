import test from 'node:test';
import assert from 'node:assert/strict';

let mapLensRows, lensFailureCode, raced, gotoRequestAction;
try { ({ mapLensRows, lensFailureCode, raced, gotoRequestAction } = await import('../src/image-source/lens.mjs') as any); } catch {}

// Regression (2026-11-13): a /goto card that rendered a Google page instead of
// redirecting had its first gstatic script request reported as the image source
// ("最接近的图源：https://www.gstatic.com/_/mss/search-next/_/js/…").
test('resolving a Lens card accepts only a top-level navigation to a non-Google site', () => {
  assert.equal(typeof gotoRequestAction, 'function', 'lens must expose its /goto request classifier');
  assert.equal(gotoRequestAction({ url: 'https://www.google.com/goto?url=abc', resourceType: 'Document' }), 'continue');
  assert.equal(gotoRequestAction({ url: 'https://www.google.com.hk/search?q=1', resourceType: 'Document' }), 'continue');
  assert.equal(gotoRequestAction({ url: 'https://x.com/someone/status/1', resourceType: 'Document' }), 'target');
  assert.equal(gotoRequestAction({ url: 'https://x.com/someone/status/1' }), 'target');
  assert.equal(gotoRequestAction({ url: 'https://www.gstatic.com/_/mss/search-next/_/js/k=search-next.aim.zh_CN.x/ck=y', resourceType: 'Script' }), 'miss');
  assert.equal(gotoRequestAction({ url: 'https://www.gstatic.com/some/page', resourceType: 'Document' }), 'miss');
  assert.equal(gotoRequestAction({ url: 'https://lh3.googleusercontent.com/abc', resourceType: 'Image' }), 'miss');
  assert.equal(gotoRequestAction({ url: 'https://cdn.example.com/app.js', resourceType: 'Script' }), 'miss');
  // A look-alike host is a foreign site: its navigation is stopped, never loaded.
  assert.equal(gotoRequestAction({ url: 'https://google.evil.example/x', resourceType: 'Document' }), 'target');
  assert.equal(gotoRequestAction({ url: 'not a url', resourceType: 'Document' }), 'continue');
});

test('lens never reports Google or its asset hosts as an image source', () => {
  const mapped = mapLensRows([
    { url: 'https://www.gstatic.com/_/mss/search-next/_/js/k=search-next.aim.zh_CN.x/ck=y', title: 'card' },
    { url: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:abc', title: 'thumbnail' },
    { url: 'https://lh3.googleusercontent.com/abc', title: 'asset' },
    { url: 'https://www.google.com/search?q=1', title: 'google' },
    { url: 'https://notgstatic.com/post/1', title: 'look-alike is a normal site' },
    { url: 'https://x.com/foo/status/1', title: 'XFoo on X: "hi"' },
  ]);
  assert.deepEqual(mapped.map((m?: any) => m.sourceUrl), ['https://notgstatic.com/post/1', 'https://x.com/foo/status/1']);
});

// Regression (2026-11-13): after a Lens deadline or cancellation the next CDP
// call was still dispatched, its promise was dropped, and its later rejection
// (CDP error or the 25 s command timer) terminated the whole host process.
test('a CDP call issued after cancellation never leaves an unhandled rejection', async () => {
  assert.equal(typeof raced, 'function', 'lens must expose its cancellation race helper');
  const unhandled = [];
  const record = (error?: any) => { unhandled.push(error); };
  process.on('unhandledRejection', record);
  try {
    const controller = new AbortController();
    controller.abort(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' }));
    let failLater;
    const command = new Promise<any | void>((_?: any, reject?: any) => { failLater = reject; });
    await assert.rejects(raced(command, controller.signal), { code: 'TIMEOUT' });
    failLater(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' }));
    await new Promise<any | void>((resolve) => { setTimeout(resolve, 20); });
  } finally {
    process.off('unhandledRejection', record);
  }
  assert.deepEqual(unhandled, []);
});

test('the cancellation race still settles with the command result or a later abort', async () => {
  const live = new AbortController();
  assert.equal(await raced(Promise.resolve('value'), live.signal), 'value');
  await assert.rejects(raced(Promise.reject(Object.assign(new Error('REQUEST_FAILED'), { code: 'REQUEST_FAILED' })), live.signal), { code: 'REQUEST_FAILED' });
  const pending = raced(new Promise<any | void>(() => {}), live.signal);
  live.abort(Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' }));
  await assert.rejects(pending, { code: 'TIMEOUT' });
});

test('lens module exposes bounded row mapping and stable failure codes', () => {
  assert.equal(typeof mapLensRows, 'function', 'lens row mapping must be implemented');
  assert.equal(typeof lensFailureCode, 'function', 'lens failure mapping must be implemented');
});

test('lens maps bounded https candidates and annotates social card names', () => {
  const rows = [
    { url: 'https://www.pixiv.net/artworks/123?tracking=x#profile', title: '  Pixiv   work  ' },
    { url: 'https://pixiv.net/artworks/123', title: 'duplicate' },
    { url: 'https://x.com/someone/status/1', title: 'XSomeone on X: "hello"' },
    { url: 'https://danbooru.donmai.us/posts/9', title: 'Danbooru' },
    { url: 'http://anilist.co/anime/5', title: 'insecure' },
    { url: 'https://anilist.co/anime/5', title: 'AniList' },
    { url: 'https://pixiv.net@127.0.0.1/artworks/7', title: 'spoof' },
    ...Array.from({ length: 12 }, (_?: any, i?: any) => ({ url: `https://yande.re/post/show/${100 + i}`, title: `yande ${i}` })),
  ];
  const mapped = mapLensRows(rows);
  assert.equal(mapped.length, 8);
  assert.deepEqual(mapped.slice(0, 5).map((m?: any) => m.sourceUrl), [
    'https://www.pixiv.net/artworks/123?tracking=x#profile',
    'https://pixiv.net/artworks/123',
    'https://x.com/someone/status/1',
    'https://danbooru.donmai.us/posts/9',
    'https://anilist.co/anime/5',
  ]);
  assert.equal(mapped[0].title, 'Pixiv work');
  assert.equal(mapped[2].authorName, 'Someone');
  assert.equal(mapped.every((m?: any) => m.engine === 'lens' && m.similarity === null), true);
});

test('lens rejects non-https, credential and port URLs', () => {
  const mapped = mapLensRows([
    { url: 'http://x.com/foo', title: 'X' },
    { url: 'https://x.com:444/foo', title: 'X' },
    { url: 'https://x.com@127.0.0.1/foo', title: 'X' },
    { url: 'https://x.com/foo/status/1', title: 'XFoo on X: "hi"' },
  ]);
  assert.deepEqual(mapped.map((m?: any) => m.sourceUrl), ['https://x.com/foo/status/1']);
});

test('lens failure codes distinguish captcha, unreachable Google, missing browser and timeout', () => {
  assert.equal(lensFailureCode(Object.assign(new Error('GOOGLE_CAPTCHA：谷歌要求验证'), { code: 'GOOGLE_CAPTCHA' })), 'GOOGLE_CAPTCHA');
  assert.equal(lensFailureCode(new Error('net::ERR_CONNECTION_REFUSED at https://google.com')), 'GOOGLE_UNREACHABLE');
  assert.equal(lensFailureCode(new Error('找不到 Chrome 可执行文件')), 'BROWSER_UNAVAILABLE');
  assert.equal(lensFailureCode(Object.assign(new Error('NO_BROWSER'), { code: 'NO_BROWSER' })), 'BROWSER_UNAVAILABLE');
  assert.equal(lensFailureCode(new Error('CDP 超时：Page.navigate')), 'TIMEOUT');
  assert.equal(lensFailureCode(new Error('private upstream text https://secret.invalid')), 'REQUEST_FAILED');
});

test('lens failure codes do not echo arbitrary upstream text', () => {
  const code = lensFailureCode(new Error('SECRET token at https://private.invalid/x'));
  assert.match(code, /^[A-Z_]+$/);
  assert.doesNotMatch(code, /SECRET|private/);
});
