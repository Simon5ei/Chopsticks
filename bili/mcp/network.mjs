// All URLs including redirect targets are checked before fetching. Short links
// are deliberately unsupported; use a canonical /video/BV... link.
export function assertBiliUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['bilibili.com','hdslb.com','bilivideo.com','bilivideo.cn'].some(domain => host === domain || host.endsWith('.' + domain))) throw new Error('Blocked non-Bilibili network destination');
  return url;
}

export function guardedFetch(fetchImpl, { maxBytes = 96*1024*1024 } = {}) {
  const mediaUrl = value => {
    const url = new URL(value);
    // Bili still returns HTTP cover/play URLs. Upgrade known CDNs before any
    // request; never transmit credentials or media over plaintext HTTP.
    if (url.protocol === 'http:' && ['hdslb.com','bilivideo.com','bilivideo.cn'].some(d => url.hostname === d || url.hostname.endsWith('.' + d))) url.protocol='https:';
    return assertBiliUrl(url);
  };
  return async (input, init = {}) => {
    let url = mediaUrl(input instanceof Request ? input.url : input);
    const original = input instanceof Request ? input : null;
    const headers = new Headers(init.headers || original?.headers);
    let method = init.method || original?.method || 'GET';
    let body = init.body;
    for (let hop = 0; hop < 5; hop++) {
      const h = new Headers(headers);
      if (!['api.bilibili.com','api.vc.bilibili.com','passport.bilibili.com'].includes(url.hostname)) { h.delete('cookie'); h.delete('authorization'); }
      const response = await fetchImpl(url,{ ...init,method,body,headers:h,redirect:'manual' });
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const next = mediaUrl(new URL(response.headers.get('location') || '',url));
        if (!['GET','HEAD'].includes(method.toUpperCase()) && next.origin !== url.origin) throw new Error('Blocked cross-origin Bili write redirect');
        url = next;
        if (response.status === 303 || ([301,302].includes(response.status) && method === 'POST')) { method='GET'; body=undefined; }
        continue;
      }
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('Bili download size limit exceeded'); }
      if (!response.body) return response;
      let received = 0;
      const limited = response.body.pipeThrough(new TransformStream({ transform(chunk,controller) {
        received += chunk.byteLength;
        if (received > maxBytes) throw new Error('Bili download size limit exceeded');
        controller.enqueue(chunk);
      } }));
      return new Response(limited,{status:response.status,statusText:response.statusText,headers:response.headers});
    }
    throw new Error('Bili redirect limit exceeded');
  };
}
