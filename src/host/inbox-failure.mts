// Classify an inbox/read transport failure into a stable, non-private code.
// Only the category leaves this module; raw errors, cookies and bodies never do.
export function inboxFailureCode(error?: any): string {
 const name = String(error?.name || ''), code = String(error?.code || ''), message = String(error?.message || '');
 const text = `${code} ${message}`;
 if (name === 'AbortError' || /abort/i.test(text)) return 'inbox_aborted';
 if (/401|403|unauthor|forbidden|not\s*logged|login|credential|cookie|token|risk/i.test(text)) return 'inbox_auth_required';
 if (/429|rate.?limit|too many requests/i.test(text)) return 'inbox_rate_limited';
 if (/timed?\s?out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(text)) return 'inbox_timeout';
 if (/ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|socket hang up|network|fetch failed/i.test(text)) return 'inbox_network_error';
 if (/\b5\d\d\b|bad gateway|service unavailable|internal server/i.test(text)) return 'inbox_platform_unavailable';
 return 'inbox_unavailable';
}
