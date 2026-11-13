import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

let compressForUpload, resolveFfmpeg;
const reducerModule: string = '../src/image-source/compress.mjs';
try { ({ compressForUpload, resolveFfmpeg } = await import(reducerModule)); } catch {}
const ffmpeg = typeof resolveFfmpeg === 'function' ? resolveFfmpeg() : '';
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);

test('image reducer exists and resolves only an existing ffmpeg executable', () => {
  assert.equal(typeof compressForUpload, 'function', 'image reducer must be implemented');
  assert.equal(typeof resolveFfmpeg, 'function', 'ffmpeg lookup must be implemented');
  assert.equal(resolveFfmpeg('', { FFMPEG: '/nonexistent/ffmpeg', PATH: '' }, []), '');
  assert.equal(resolveFfmpeg(process.execPath, { PATH: '' }, []), process.execPath);
});

test('reduction is best effort: a missing tool, unsupported type or undecodable bytes yield null without throwing', async () => {
  assert.equal(await compressForUpload(png, 'image/png', { ffmpeg: '/nonexistent/ffmpeg' }), null);
  assert.equal(await compressForUpload(png, 'text/plain', { ffmpeg: process.execPath }), null);
  assert.equal(await compressForUpload('path.png', 'image/png', { ffmpeg: process.execPath }), null);
  // node is not ffmpeg: it exits without producing a JPEG on stdout.
  assert.equal(await compressForUpload(png, 'image/png', { ffmpeg: process.execPath, timeoutMs: 5000 }), null);
  const aborted = new AbortController(); aborted.abort();
  assert.equal(await compressForUpload(png, 'image/png', { ffmpeg: process.execPath, signal: aborted.signal }), null);
});

test('a real large image is reduced to a bounded JPEG', { skip: ffmpeg ? false : 'ffmpeg not installed' }, async () => {
  const made = spawnSync(ffmpeg, ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=2600x1800','-vf','noise=alls=60:allf=u','-frames:v','1','-q:v','1','-f','mjpeg','pipe:1'], { maxBuffer: 16 * 1024 * 1024, timeout: 20000, windowsHide: true });
  const source = new Uint8Array(made.stdout ?? []);
  assert.ok(source.length > 1024 * 1024, `fixture must exceed 1 MiB, got ${source.length}`);
  const reduced = await compressForUpload(source, 'image/jpeg', { ffmpeg });
  assert.ok(reduced, 'a decodable image must be reduced');
  assert.equal(reduced.mimeType, 'image/jpeg');
  assert.deepEqual([...reduced.bytes.subarray(0, 3)], [255, 216, 255]);
  assert.ok(reduced.bytes.length < 1024 * 1024 && reduced.bytes.length < source.length / 2, `reduced size ${reduced.bytes.length}`);
  // The reduced image stays within the 1600 px edge budget.
  const probe = spawnSync(ffmpeg, ['-hide_banner','-f','jpeg_pipe','-i','pipe:0'], { input: reduced.bytes, encoding: 'utf8', timeout: 20000, windowsHide: true });
  const size = /(\d{2,5})x(\d{2,5})/.exec(String(probe.stderr).split('Stream #0')[1] ?? '');
  assert.ok(size && Math.max(Number(size[1]), Number(size[2])) <= 1600, `dimensions ${size?.[0]}`);
});

test('the decoder is pinned to the declared image type so crafted bytes cannot select another input format', { skip: ffmpeg ? false : 'ffmpeg not installed' }, async () => {
  // A playlist that ffmpeg would otherwise probe and follow; with the pinned PNG decoder it is just undecodable.
  const playlist = new TextEncoder().encode('#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///etc/hostname\n#EXT-X-ENDLIST\n');
  assert.equal(await compressForUpload(playlist, 'image/png', { ffmpeg }), null);
});
