// Narrow OneBot converters informed by SurfCore (see notices/surfcore-qq-LICENSE).
const decode = text => String(text).replace(/&#44;/g, ',').replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&amp;/g, '&');
export function segmentsOf(message) {
  if (Array.isArray(message)) return structuredClone(message.filter(s => s && typeof s.type === 'string' && s.data && typeof s.data === 'object'));
  const value = String(message ?? '');
  const result = []; let last = 0;
  for (const match of value.matchAll(/\[CQ:([a-z_]+)((?:,[^\]]*)?)\]/g)) {
    if (match.index > last) result.push({ type: 'text', data: { text: decode(value.slice(last, match.index)) } });
    const data = {};
    for (const arg of match[2].slice(1).split(',')) { const i = arg.indexOf('='); if (i > 0) data[arg.slice(0, i)] = decode(arg.slice(i + 1)); }
    result.push({ type: match[1], data }); last = match.index + match[0].length;
  }
  if (last < value.length) result.push({ type: 'text', data: { text: decode(value.slice(last)) } });
  return result;
}
export function textOf(segments) {
  return segments.map(({ type, data }) => {
    if (type === 'text') return String(data.text ?? '');
    if (type === 'at') return `[@${data.qq}]`;
    if (type === 'reply') return `[引用消息 ${data.id}]`;
    if (type === 'image' || type === 'mface') return `[${type === 'image' ? '图片' : '表情'}${data.summary ? `:${String(data.summary).slice(0, 80)}` : ''}]`;
    if (type === 'forward') return '[合并转发]';
    if (type === 'face') return `[表情 ${data.id}]`;
    return `[${type}]`;
  }).join('');
}
export const imageSegments = segments => segments.filter(s => s.type === 'image' || s.type === 'mface');
export function officialImageUrl(raw) {
  let url; try { url = new URL(raw); } catch { throw new Error('Unsupported QQ image URL'); }
  const hosts = ['qpic.cn', 'qq.com', 'gtimg.cn', 'gtimg.com'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('Unsupported QQ image URL');
  return url.href;
}
