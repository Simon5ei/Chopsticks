import test from 'node:test';
import assert from 'node:assert/strict';

let mapLensRows, lensFailureCode;
try { ({ mapLensRows, lensFailureCode } = await import('../src/image-source/lens.mjs')); } catch {}

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
