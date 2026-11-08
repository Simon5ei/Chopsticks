// Narrow, modified parser extraction from coser-image-search 1.0.0.
// Copyright (c) 2026 小鲸鱼. MIT: ../notices/image-source-MIT-LICENSE
// Source: src/fish-find-chicken.js, SHA-256:
// 440a4ecc12e0bd251f63994a038ec36af3d51cd6b40904adaa644bea1501c3a6
// Account inference, browser code and all non-anime engines are excluded.

const textOnly = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ')
  .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, (entity) => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[entity.toLowerCase()])
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

export function artworkUrl(value?: any) {
  if (typeof value !== 'string') return null;
  const raw = value.replace(/&amp;/gi, '&');
  if (/[\\\s%]/.test(raw) || /\/\.{1,2}(?:\/|[?#]|$)/.test(raw)) return null;
  let url;
  try { url = new URL(raw.startsWith('//') ? `https:${raw}` : raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname === 'www.pixiv.net' ? 'pixiv.net' : url.hostname;
  const paths = {
    'pixiv.net': /^\/artworks\/[1-9]\d*\/?$/,
    'danbooru.donmai.us': /^\/posts\/[1-9]\d*\/?$/,
    'yande.re': /^\/post\/show\/[1-9]\d*\/?$/,
    'konachan.com': /^\/post\/show\/[1-9]\d*\/?$/,
    'anilist.co': /^\/anime\/[1-9]\d*\/?$/,
    'myanimelist.net': /^\/anime\/[1-9]\d*\/?$/,
    'anime-pictures.net': /^\/posts\/[1-9]\d*\/?$/,
    'zerochan.net': /^\/[1-9]\d*\/?$/,
    'e-shuushuu.net': /^\/image\/[1-9]\d*\/?$/,
  };
  if (host === 'gelbooru.com' && url.pathname === '/index.php') {
    if (url.searchParams.get('page') !== 'post' || url.searchParams.get('s') !== 'view' || !/^[1-9]\d*$/.test(url.searchParams.get('id') ?? '')) return null;
    return `https://gelbooru.com/index.php?page=post&s=view&id=${url.searchParams.get('id')}`;
  }
  if (!Object.hasOwn(paths, host) || !paths[host].test(url.pathname)) return null;
  return `https://${host}${url.pathname.replace(/\/$/, '')}`;
}

function candidate(engine?: any, similarity?: any, title?: any, sourceUrl?: any) {
  const url = artworkUrl(sourceUrl);
  if (!url || !Number.isFinite(similarity) || similarity > 1 || similarity < (engine === 'tracemoe' ? .87 : .6)) return null;
  return {engine, similarity, title: textOnly(title), sourceUrl: url, links: [url]};
}

function links(block?: any) {
  return [...block.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({url: match[1], title: textOnly(match[2])}));
}

export function parseSaucenao(html?: any) {
  const text = String(html ?? '');
  const starts = [...text.matchAll(/<div\b[^>]*\bclass\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .filter((match) => match[1].split(/\s+/).includes('result')).map((match) => match.index);
  if (!starts.length && !/No (?:results|matches)(?: found)?/i.test(text)) throw new Error('INVALID_FORMAT');
  const out = [];
  for (let i = 0; i < starts.length; i++) {
    const block = text.slice(starts[i], starts[i + 1] ?? text.length);
    const score = block.match(/(?:resultsimilarityinfo|similarity-info)[^>]*>\s*(\d+(?:\.\d+)?)%/i);
    if (!score) continue;
    const title = block.match(/class\s*=\s*["']resulttitle["'][\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '';
    for (const link of links(block)) {
      const item = candidate('saucenao', Number(score[1]) / 100, title || link.title, link.url);
      if (item) out.push(item);
    }
  }
  return out;
}

export function parseIqdb(html?: any) {
  const text = String(html ?? '');
  if (/Place in queue|under high load/i.test(text)) throw new Error('UPSTREAM_BUSY');
  if (/No relevant matches/i.test(text)) return [];
  const tables = [...text.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  // A score belongs to exactly one result table, never to every link in the page.
  if (!tables.some((table) => /(?:Best|Additional|Possible) match|\d+(?:\.\d+)?%\s*similarity/i.test(table))) throw new Error('INVALID_FORMAT');
  const out = [];
  for (const table of tables) {
    const scores = [...table.matchAll(/(?:^|>)\s*(\d+(?:\.\d+)?)%\s*similarity(?=\s|<|$)/gi)];
    if (scores.length !== 1 || /<table\b/i.test(table.slice(table.indexOf('>') + 1))) continue;
    for (const link of links(table)) {
      const item = candidate('iqdb', Number(scores[0][1]) / 100, link.title, link.url);
      if (item) out.push(item);
    }
  }
  return out;
}

export function parseTracemoe(payload?: any) {
  if (!payload || !Array.isArray(payload.result) || (payload.error !== undefined && payload.error !== '')) throw new Error('INVALID_FORMAT');
  const out = [];
  for (const item of payload.result) {
    const id = item?.anilist?.id ?? item?.anilist?.anime_id;
    if (!/^[1-9]\d*$/.test(String(id ?? ''))) continue;
    const title = item?.anilist?.title;
    const name = title?.native || title?.romaji || title?.english || '';
    const episode = Number.isFinite(item?.episode) ? ` 第${item.episode}集` : '';
    const match = candidate('tracemoe', item?.similarity, `${name}${episode}`, `https://anilist.co/anime/${id}`);
    if (match) out.push(match);
  }
  return out;
}
