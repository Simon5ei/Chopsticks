// Best-effort reduction of a large image before it is uploaded to the search
// engines. Original Chopsticks code (GPL-3.0-only); not derived from the
// upstream tool recorded in PROVENANCE.json.
//
// A multi-megabyte original timed out on every engine from the server's uplink
// (2026-11-13: 4.9 MB, all engines TIMEOUT at 30 s; reduced, 14 s all ok).
// Reverse-image engines match on a downscaled copy anyway, so a 1600 px JPEG
// keeps the result quality while cutting the upload by an order of magnitude.

import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const MAX_EDGE = 1600;
const MAX_OUTPUT = 2 * 1024 * 1024;
const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const FIXED_CANDIDATES = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
// The decoder is pinned to the declared type. Without it ffmpeg probes the
// bytes and a crafted "image" could select a playlist or concat demuxer.
const DEMUXERS: Record<string, string> = Object.freeze({
  'image/jpeg': 'jpeg_pipe',
  'image/png': 'png_pipe',
  'image/webp': 'webp_pipe',
  'image/gif': 'gif',
});

const isFile = (file?: any) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/** Locate ffmpeg: explicit path, $FFMPEG, PATH, then fixed system locations. Returns '' when absent. */
export function resolveFfmpeg(explicit: any = '', env: any = process.env, fixed: string[] = FIXED_CANDIDATES) {
  const onPath = String(env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, EXE));
  for (const candidate of [explicit, env.FFMPEG, ...onPath, ...fixed]) {
    if (typeof candidate === 'string' && candidate && isFile(candidate)) return candidate;
  }
  return '';
}

/**
 * Re-encode an image as a JPEG no larger than 1600 px on its long edge.
 * Never throws: returns null when ffmpeg is missing, the type is unsupported,
 * the bytes cannot be decoded, the deadline passes, the search is cancelled or
 * the result would not be smaller. The caller then uploads the original.
 */
export function compressForUpload(bytes?: any, mimeType?: any, {signal, ffmpeg = '', timeoutMs = 10_000}: { signal?: any; ffmpeg?: string; timeoutMs?: number; [key: string]: any } = {}): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  return new Promise((resolve) => {
    const demuxer = DEMUXERS[String(mimeType)];
    if (!(bytes instanceof Uint8Array) || !bytes.length || !demuxer || signal?.aborted) { resolve(null); return; }
    const executable = resolveFfmpeg(ffmpeg);
    if (!executable) { resolve(null); return; }
    let proc;
    let done = false;
    let size = 0;
    const chunks = [];
    const finish = (value: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (value === null) { try { proc?.kill('SIGKILL'); } catch {} }
      resolve(value);
    };
    const cancel = () => finish(null);
    const timer = setTimeout(cancel, timeoutMs);
    signal?.addEventListener('abort', cancel, {once: true});
    try {
      // Fixed argv, no shell, no file paths: bytes in on stdin, JPEG out on stdout.
      proc = spawn(executable, [
        '-hide_banner', '-loglevel', 'error', '-nostats',
        '-protocol_whitelist', 'pipe', '-f', demuxer, '-i', 'pipe:0',
        '-frames:v', '1',
        '-vf', `scale=w='min(${MAX_EDGE},iw)':h='min(${MAX_EDGE},ih)':force_original_aspect_ratio=decrease`,
        '-pix_fmt', 'yuvj420p', '-q:v', '4',
        '-f', 'mjpeg', 'pipe:1',
      ], {stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true});
    } catch { finish(null); return; }
    proc.on('error', () => finish(null));
    proc.stdin.on('error', () => {});
    proc.stdout.on('error', () => finish(null));
    proc.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) { finish(null); return; }
      chunks.push(chunk);
    });
    proc.on('close', (code) => {
      if (code !== 0 || size >= bytes.length) { finish(null); return; }
      const out = new Uint8Array(Buffer.concat(chunks, size));
      const jpeg = out.length >= 4 && out[0] === 255 && out[1] === 216 && out[2] === 255;
      finish(jpeg ? {bytes: out, mimeType: 'image/jpeg'} : null);
    });
    proc.stdin.end(bytes);
  });
}
