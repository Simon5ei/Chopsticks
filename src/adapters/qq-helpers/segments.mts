// Narrow OneBot converters informed by SurfCore (see notices/surfcore-qq-LICENSE).
const decode = (text) => String(text).replace(/&#44;/g, ',').replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&amp;/g, '&');
export function segmentsOf(message?: any) {
  if (Array.isArray(message)) return structuredClone(message.filter((s) => s && typeof s.type === 'string' && s.data && typeof s.data === 'object'));
  const value = String(message ?? '');
  const result = []; let last = 0;
  for (const match of value.matchAll(/\[CQ:([a-z_]+)((?:,[^\]]*)?)\]/g)) {
    if (match.index > last) result.push({ type: 'text', data: { text: decode(value.slice(last, match.index)) } });
    const data: Record<string, any> = {};
    for (const arg of match[2].slice(1).split(',')) { const i = arg.indexOf('='); if (i > 0) data[arg.slice(0, i)] = decode(arg.slice(i + 1)); }
    result.push({ type: match[1], data }); last = match.index + match[0].length;
  }
  if (last < value.length) result.push({ type: 'text', data: { text: decode(value.slice(last)) } });
  return result;
}
const sizeOf = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 && n <= 1024 * 1024 * 1024 ? `:${Math.max(1, Math.round(n / 1024))}KB` : ''; };
const secondsOf = (value) => { const n = Number(value); return Number.isFinite(n) && n > 0 && n <= 3600 ? `:${Math.round(n)}s` : ''; };
export function textOf(segments?: any) {
  return segments.map(({ type, data }: { type?: any; data?: any; [key: string]: any }) => {
    if (type === 'text') return String(data.text ?? '');
    if (type === 'at') return `[@${data.qq}]`;
    if (type === 'reply') return `[引用消息 ${data.id}]`;
    if (type === 'image' || type === 'mface') return `[${type === 'image' ? '图片' : '表情'}${data.summary ? `:${String(data.summary).slice(0, 80)}` : ''}${sizeOf(data.file_size)}]`;
    if (type === 'video') return `[视频${secondsOf(data.duration ?? data.length)}${sizeOf(data.file_size)}]`;
    if (type === 'record') return `[语音${secondsOf(data.duration)}]`;
    if (type === 'json' || type === 'xml') return '[卡片]';
    if (type === 'forward') return `[合并转发${typeof data.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(data.id) ? `:${data.id}` : ''}]`;
    if (type === 'face') return `[表情 ${data.id}]`;
    return `[${type}]`;
  }).join('');
}
export const imageSegments = (segments) => segments.filter((s) => s.type === 'image' || s.type === 'mface');
export function officialImageUrl(raw?: any) {
  let url; try { url = new URL(raw); } catch { throw new Error('Unsupported QQ image URL'); }
  const hosts = ['qpic.cn', 'qq.com', 'nt.qq.com.cn', 'gtimg.cn', 'gtimg.com'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('Unsupported QQ image URL');
  return url.href;
}
