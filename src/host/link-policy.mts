// Public channels must not receive links to adult/high-risk image boards. The
// link itself is the reversible-damage vector, so it is removed before send;
// the rest of the message (what was found, why) is kept.
export const HIGH_RISK_HOSTS = Object.freeze([
 'e-hentai.org','exhentai.org','nhentai.net','hitomi.la','rule34.xxx','rule34.paheal.net',
 'danbooru.donmai.us','gelbooru.com','yande.re','konachan.com','konachan.net','sankakucomplex.com',
 'chan.sankakucomplex.com','tbib.org','xbooru.com','realbooru.com','hypnohub.net',
]);
const URL_PATTERN = /https?:\/\/[^\s<>"'）)\]，。；]+/gi;
export function isHighRiskUrl(value?: any){try{const host=new URL(String(value)).hostname.replace(/^www\./,'').toLowerCase();return HIGH_RISK_HOSTS.some((domain)=>host===domain||host.endsWith('.'+domain));}catch{return false;}}
export function highRiskHostsIn(text?: any){const out=[];for(const match of String(text??'').matchAll(URL_PATTERN)){if(isHighRiskUrl(match[0])){try{out.push(new URL(match[0]).hostname.replace(/^www\./,''))}catch{}}}return [...new Set(out)];}
export function stripHighRiskLinks(text?: any){return String(text??'').replace(URL_PATTERN,(url)=>isHighRiskUrl(url)?'（链接已省略）':url);}
