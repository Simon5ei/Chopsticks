// One-shot dynamic (动态) test: post -> list -> remove. Same boundary as the
// comment tool: credentials come from the local drop box, nothing is echoed.
//
//   node bili-dynamic.mjs list
//   node bili-dynamic.mjs post --text "..." --dry | --go
//   node bili-dynamic.mjs rm --id <dyn_id> --dry | --go
import { accountBili, biliState, biliStateDir } from '../lib/state-paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
// 2026-10-21 补：line 99 用到 gate 却没 import，发动态会 ReferenceError
import { gate, record } from '../lib/quota-gate.mjs'
import { confirmReceipt } from '../lib/receipt.mjs'
import { assertOutboundIdentitySafe } from '../lib/outbound-guard.mjs'

const argv = process.argv.slice(2)
const mode = argv[0]
const args = new Map()
for (let i = 1; i < argv.length; i += 1) {
  const a = argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true)
}
const isDry = args.has('dry')
const isGo = args.has('go')
const text = args.get('text')
const dynId = args.get('id')

const credPath = accountBili('credentials.json')
if (!fs.existsSync(credPath)) { console.error(`缺少凭据文件: ${credPath}`); process.exit(3) }
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'))
for (const k of ['sessdata', 'bili_jct', 'buvid3']) {
  if (!cred[k] || String(cred[k]).trim() === '') { console.error(`凭据文件缺少 ${k}`); process.exit(3) }
}
const cookieHeader = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REF = 'https://t.bilibili.com/'

const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
const keyOf = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
async function wbi(params) {
  const d = await (await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
  })).json()
  const img = d?.data?.wbi_img?.img_url, sub = d?.data?.wbi_img?.sub_url
  if (!img || !sub) return ''
  const mixin = MIXIN_TAB.map((i) => (keyOf(img) + keyOf(sub))[i]).join('').slice(0, 32)
  const wts = Math.round(Date.now() / 1000)
  const clean = (v) => String(v).replace(/[!'()*]/g, '')
  const q = Object.keys({ ...params, wts }).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean(k === 'wts' ? wts : params[k]))}`).join('&')
  return `${q}&w_rid=${crypto.createHash('md5').update(q + mixin).digest('hex')}`
}

async function whoami() {
  const d = await (await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
  })).json()
  if (d.code !== 0) { console.log(`  登录态无效: code=${d.code} ${d.message}`); process.exit(4) }
  console.log(`  账号: ${d.data.uname} (mid ${d.data.mid})  手机绑定=${d.data.mobile_verified ? '是' : '否'}`)
  return d.data.mid
}

if (mode === 'post') {
  if (!text) { console.error('post 需要 --text'); process.exit(2) }
  if (!isDry && !isGo) { console.error('必须显式 --dry 或 --go'); process.exit(2) }
  console.log('=== 登录态 ===')
  const mid = await whoami()
  const body = JSON.stringify({
    dyn_req: {
      content: { contents: [{ raw_text: text, type: 1, biz_id: '' }] },
      scene: 1,
      meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
    },
  })
  const qs = await wbi({ csrf: String(cred.bili_jct) })
  const url = `https://api.bilibili.com/x/dynamic/feed/create/dyn?${qs}`
  console.log('\n=== 将要发布 ===')
  console.log(`  POST ${url.replace(encodeURIComponent(String(cred.bili_jct)), '***csrf***').slice(0, 120)}…`)
  console.log(`  content-type: application/json    cookie: SESSDATA=***; bili_jct=***; buvid3=***`)
  console.log(`  正文(${text.length} 字): ${text}`)
  console.log(`  报文: ${body}`)
  if (isDry) { console.log('\n[dry] 未发布。'); process.exit(0) }
// P0-5（Kimi 评审 #5）：写通道也要过限额闸；不通过就停手
if (!gate({ type: 'dynamic', target: 'dynamic', auto: process.argv.includes('--auto') })) { console.error('拒绝：限额闸不通过（额度/白名单）'); process.exit(2) }
// 出站身份闸（2026-10-23 用户要求：只准自己互认，不许泄露主人和别人的信息）
// 动态是公开面：一旦把主人/别人的 QQ 号或 B站 mid 贴出去就收不回来；提示词只是概率约束，这里是硬拦。
try {
  assertOutboundIdentitySafe(text, { surface: 'B站 动态' });
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(9);
}
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'user-agent': UA, referer: REF, origin: 'https://t.bilibili.com', 'content-type': 'application/json', cookie: cookieHeader },
    body,
  })
  const out = await r.json()
  console.log(`\n[go] HTTP ${r.status}  code=${out.code} message=${out.message ?? ''}`)
  if (out.code === 0) {
    const id = out.data?.dyn_id_str ?? out.data?.dyn_id
    if (!r.ok || !/^[1-9][0-9]{0,19}$/.test(String(id))) { console.error('Unconfirmed dynamic response; verify before retrying'); process.exit(6) }
    confirmReceipt('dynamic',id,`https://t.bilibili.com/${id}`)
    record({type:'dynamic',target:'dynamic',note:text,auto:process.argv.includes('--auto')})
    console.log(`  ✅ 已发布  dyn_id=${id}`)
    console.log(`  https://t.bilibili.com/${id}`)
  } else {
    console.log(`  errmsg: ${out.data?.errmsg ?? '-'}`)
    process.exit(6)
  }
  process.exit(0)
}

console.error('Usage: post --text <text> --dry|--go');
process.exit(2)
