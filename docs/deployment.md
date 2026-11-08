# Deployment and recovery

Production source: `/opt/chopsticks`. External data: `/var/lib/chopsticks` (private mode). DSH continues using its original home and session histories. SnowLuma remains logged in independently.

The migration helper is specific to the existing server layout. It copies only fish character/Bili data, converts the eight QQ mappings, imports recent confirmed messages and scoped lightweight memory, and replaces the profile bundle. It must run **after DSH is stopped and backed up** for production. Never run preparation against a live production profile.

`deployment/adopt-session.mjs` changes only the adopted Bili session header preset, verifying that all subsequent history bytes remain identical. QQ retains the `qq-chat-v2` preset identifier as a compatibility alias.

Before cutover:

1. Run local tests and isolated real-model acceptance with `validation:true`; the host substitutes a fake QQ transport and blocks Bili writes.
2. Back up DSH home, old fish state and systemd drop-in.
3. Stop the old DSH service and ensure its QQ bridge/MCP child processes exited.
4. Prepare external state/profile, adopt Bili preset, set `CHOPSTICKS_CONFIG`, then start DSH once.
5. Verify gateway login, source file hashes, session history preservation and `state/health.json`.

Rollback: stop DSH, restore the recorded profile files, original Bili session archive and systemd drop-in from the cutover backup, reload systemd and start DSH. New Chopsticks events remain in its separate data directory for later reconciliation. Do not run two senders or replay uncertain outgoing intents.

Health is written locally without credentials. `core_router` retains failed/uncertain decisions for inspection; `host_sends` retains publishing outcomes. An uncertain result needs platform reconciliation before any intentional retry.

Public groups share group/Bili records. Private and operator records are not placed into public Router model contexts. Fresh model computation is replaceable; SQLite and native DSH logs are the source of continuity.

## First server deployment — 2026-11-03

- Node 24 server suite: 99/99 passed. Independent final review findings resolved and scoped re-review passed.
- Isolated DeepSeek real-model acceptance: group B correctly recalled the fish's confirmed public statement in group A; private fixture was excluded; a background task reported back into the origin event journal. No real QQ/Bili test posts.
- Production retains `minimax-cn / MiniMax-M3.1-Flash`. MiniMax returned plan-exhausted 429 during acceptance, so model-level validation used DeepSeek with the administrator's explicit permission. No automatic production model substitution.
- Eight QQ mappings adopted; all nine original QQ/Bili session history prefixes verified byte-for-byte after decompression. Bili's preset header alone changed.
- Imported 326 source events and 19 scoped lightweight memories; 287 active role memory records remain readable. Cached rows without usable text/confirmed self-message IDs were not promoted into new facts; original native histories and data remain backed up.
- QQ HTTP account verified; separate account-specific HTTP and WebSocket credentials loaded. WebSocket connected and healthy, old bridge process count zero. The active profile contains base, web app and Chopsticks only.
- Backup: `/opt/chopsticks-backups/20261103-001211`; pointer `/opt/chopsticks-backups/latest`.

The initial start still used the prior composed entry. An explicit profile composition and restart activated the new bundle. The cutover helper now materializes the composed profile before launch and uses explicit `--profile web`.

## DeepSeek migration — 2026-11-03

The administrator subsequently requested DeepSeek for all fish execution. The production runtime and DSH default now use `deepseek-official / deepseek-flash` (configured display name DeepSeek-V4.1-Flash). MiniMax remains an installed provider but is not selected by the fish runtime.

The unresponsive conversation was traced to received QQ events waiting behind MiniMax 429 failures. Four assessments that had never produced a dispatch were requeued after backup and model replacement; no sent or uncertain effect was replayed. A real incoming private message then received a confirmed QQ reply through DeepSeek, and the queue cleared.

On model changes, native DSH selection updates all adopted QQ/Bili sessions without replacing their histories. Restored background workers also adopt the current model. Regression tests cover preserved sessions, partial synchronization retries and avoiding repeated updates.

Restoring the Bili session exposed a compression-format defect in the first migration: history bytes were intact, but DSH requires the header in its own Zstandard frame. The adoption helper now preserves that frame contract and supports concatenated frames across Node 24 builds. The repaired session retained all 27,725,301 historical event bytes with the original SHA-256; native DSH successfully opened it and synchronized all nine adopted sessions to DeepSeek. Full local suite: 101 passed.

## Native console — 2026-11-03

The native **Settings → 筷子** section now provides overview, source events, emitted reasoning/tool traces, and logs. No SessionCross dependency or extra listening port was introduced. Read-only RPC reuses native owner authentication: live unauthenticated requests returned 401 and authenticated requests returned 200.

Both Windows and server Linux suites passed 117 tests. Isolated DeepSeek acceptance verified cross-group recall, private exclusion, and background task results. Browser checks verified actual emitted reasoning, tool calls/results, source filtering, 78-row pagination/JSONL export and zero page errors. The temporary validation service was stopped afterward; no real QQ/Bili test messages were sent.

Production was updated after an idle check. All nine adopted QQ/Bili sessions, DeepSeek selection and healthy QQ reception were verified. Backup: `/opt/chopsticks-backups/console-20261103-011858` (code, profile, private config and state). To revert this console release, stop DSH, restore `code.tgz` into `/opt/chopsticks`, recompose the web profile, and start DSH. The additive trace database may remain for audit; original session archives were not modified by this release.

Native process logging uses explicit stdout metadata because the optional host logger produced no journal output on this deployment. Browser trace details remain in the private trace store. See [console data limits](console.md).

## QQ administrator development — 2026-11-03

Production now explicitly enables `development` with workspace `/root/workspace/dsh`. Only a consumed canonical message from the configured QQ owner can create the developer capability. The chat worker delegates to a dedicated development preset; research and Bili workers retain their existing tools. Exact raw owner requests and approved follow-ups persist with the task, and another group member cannot follow or stop that task.

The isolated real DeepSeek flow created three directories, copied a CSV, ran `wc -l` and `sha256sum`, and returned a confirmed task result. Source and destination SHA-256 matched. A non-owner message claiming administrator identity, even with a forged admin metadata flag, was processed without creating its requested file. The final Linux suite passed 139/139, including the correction that preserves the Bili role label after its first bound event. Tests include actual shell execution and killing a background process group on cancellation.

Backup: `/opt/chopsticks-backups/admin-development-20261103-020915`. To roll back, stop DSH, restore its `config.json` and extract `code.tgz` into `/opt/chopsticks`, recompose the profile and restart. Original QQ/Bili sessions and memory were retained. No failed historical directory operation was replayed and no real test message was sent. At that release, the wishlist was still in its verified old location and the daily research task retained a fallback. This transitional setup has since been retired; see the workspace cleanup below and [current workspace routes](workspace.md).

## Retired workspace links — 2026-11-03

Subsequent administrator QQ tasks migrated the wishlist and scanner into `/root/workspace/dsh`, verified the CSV byte-for-byte, and removed the old CSV. Cleanup then removed the scanner's remaining import of SurfCore's state-path module: credentials now resolve through Chopsticks' external config. Its dry run was also corrected to leave the report unchanged. A fixture verified credentials, dry-run immutability, retained notes, appending and deduplication; a real server dry run returned 56 candidates and preserved both CSV and report hashes.

The old workspace's duplicate script/report and obsolete instructions were archived under `/opt/chopsticks-backups/legacy-links-20261103-030243`. The live 10:00 cron already used the new workspace and was retained. The 09:00 research automation now uses only the canonical new CSV, without legacy filename/path fallbacks. New workspace/project instructions document the current routes. Existing deployment backups, native session identity paths, histories and role memories remain intact. No DSH restart was needed for this cleanup.

## Router session lifecycle — 2026-11-03

Each Router evaluation still uses an independent context. On completion, a persistent cleanup queue waits for native idleness, archives the session, and disposes the owned Agent handle. Initialization cancellation and failed archival remain recoverable; a completed native teardown error is logged without retrying a permanently rejected handle. A queued tool-guard refresh now tolerates its scope already being inactive during shutdown. The console presents one logical coordinator with aggregate trace/event navigation across runs.

Linux passed 148/148 tests. Independent review findings were fixed and re-reviewed. Isolated native DSH with DeepSeek verified cross-group recall, private exclusion, task completion, archive persistence and zero live Router agents after completion. Browser checks found one coordinator entry, accessible historical traces, and no page errors. No synthetic production QQ/Bili messages were sent.

Deployment backup: `/opt/chopsticks-backups/router-lifecycle-20261103-110905` (code, config, state and native workspace archive registry). Stop the LAN socket/proxy before stopping DSH during maintenance: the proxy's dependency can otherwise reactivate DSH. Production archived all 39 legacy Router sessions; QQ reception remained healthy, and QQ mapping, persona and role-card checksums matched. Native transcripts were retained. Rollback code by stopping the LAN socket/proxy and DSH, restoring `code.tgz` into `/opt/chopsticks`, and restarting DSH and the LAN socket. The native archive registry backup can separately restore sidebar visibility if needed; do not overwrite later workspace changes blindly.

## Anime and illustration source lookup — 2026-11-03

Runtime revision `8e99a64eaa9f5d58435f4e3c1cebaa2852d743d6` adds QQ-only `chopsticks_anime_source`. A user must explicitly request source lookup for the current received image or its explicit same-channel reply target. It uploads one supported image of at most 8 MiB to fixed SauceNAO illustration/anime indexes, trace.moe or 2D IQDB. Only artwork/anime candidates are returned; Lens, browsers, identity/account inference and the original OneBot sender are excluded. Normal `chopsticks_send` handles final confirmed delivery. No new package, process, GPU or listening port is required.

Linux passed 177/177. Windows feature tests passed 175 with two Linux-only skips. Isolated native DSH with real DeepSeek verified all five permission scopes, a tool result and one confirmed fake QQ reply. A public trace.moe documentation screenshot matched the expected anime at approximately 0.992 similarity; SauceNAO returned a valid response with no retained match, while IQDB timed out. Engine failures remain explicit and independent. No private images or synthetic production messages were used.

Backup: `/opt/chopsticks-backups/anime-source-20261103-193855`, including code, profile, unchanged config, state and nine original session archives. Production source hashes, healthy QQ reception, stable process, model/config, historical prefixes, mappings and persona were verified. Rollback restores code and the recorded profile, recomposes web, and restarts DSH after stopping the LAN socket/proxy; keep current databases and native histories and never replay uncertain sends.

## Google Lens engine — 2026-11-04

`/鱼鱼找鸡` now runs Lens as a fourth, isolated engine alongside SauceNAO, trace.moe and IQDB. `image-source/lens.mjs` starts a singleton headless Chrome/Chromium over CDP, posts the selected image to the fixed `lens.google.com/v3/upload` page, resolves Google `/goto` result cards and returns bounded HTTPS candidates. Account extraction and the reply are a direct port of the source tool: `image-source/accounts.mjs` keeps the original `extractAccounts`, `dominantPersonName`, `socialNameFromTitle`, `profileTitleName`, `accountNameOf` and `formatReply`, so it uses the upstream URL-backed Twitter/Weibo/Bilibili/Instagram/Pixiv rules, strict dominant-name consensus by default, and the original `🎯 **鱼鱼找鸡结果**` layout. Unsupported social platforms and handle guessing are ignored exactly as upstream. The browser is not started until a Lens search runs; it stops after two idle minutes or when the host shuts down.

The host process needs a Chromium-family binary. This deployment uses Chrome for Testing 141 at `/opt/chrome/chrome-linux64/chrome` (the directory is additive and not part of the code archive). Running as root adds `--no-sandbox`; the browser runs as the same host user. The candidate list also accepts a full Chrome/Chromium/Edge install, and `imageSource.lens.browser` can pin an explicit path.

This server's system DNS returns poisoned or wrong addresses for `www.google.com` and the `gstatic` asset hosts, which leaves the Lens page stuck at "正在思考". Chrome therefore runs with secure DNS-over-HTTPS by default (`https://cloudflare-dns.com/dns-query`). Set `imageSource.lens.doh` to another DoH template, or to `""` to disable it on a network where system DNS already resolves Google correctly.

Configuration (all optional; defaults are shown):

```json
"imageSource": {
  "lens": {
    "enabled": true,
    "browser": "",
    "proxy": "",
    "doh": "https://cloudflare-dns.com/dns-query",
    "profileDir": ""
  }
}
```

`profileDir` defaults to `<stateDir>/lens-profile` and persists Google's cookies. If Google returns its `/sorry` verification page, the engine reports `GOOGLE_CAPTCHA` and the reply says "谷歌要求验证"; it never treats the page as a match and does not retry blindly. Use a working `proxy` for a cleaner egress, reduce request frequency, or rely on SauceNAO/trace.moe/IQDB until verification clears. A missing browser reports `BROWSER_UNAVAILABLE`; an unreachable Google reports `GOOGLE_UNREACHABLE`.

Verification on this host: the full local suite passed (201 pass, 10 skipped) and the candidate server suite passed 188/188. The real browser flow uploaded the test image, rendered the Lens results page, resolved `/goto` cards to their target hosts and applied the artwork allowlist; a later fresh-profile run returned `status: ok`. Google intermittently served the captcha page from the same egress, so the failure path was also verified with `GOOGLE_CAPTCHA` rather than a false match. No private images or synthetic QQ/Bili messages were used.

Deployment backup: `/opt/chopsticks-backups/lens-20261104-000154` (code archive, private config, systemd drop-in). The production host predates the local working tree's unrelated host changes, so only the `animeCommands` Lens wiring was applied to its existing `host/runtime.mjs`; the new `image-source/lens.mjs`, updated `client.mjs` and direct-command files were deployed whole. Server suite: 188/188. After restart DSH reported ready, QQ remained connected, the Lens profile lived under `/var/lib/chopsticks/state/lens-profile`, and no headless Chrome process was left behind. The deployed browser is Chrome for Testing 141 at `/opt/chrome/chrome-linux64/chrome`; rollback restores `code.tgz` and restarts DSH, leaving the additive browser directory in place.

On 2026-11-04 the administrator explicitly opened social-account candidates. The direct command and the native service now accept explicit coser/account requests; `image-source/accounts.mjs` is a direct port of the source tool's extraction and reply functions (not a new rule set): fixed platform URL rules, reserved-path filtering, post-to-profile normalization, strict dominant-name consensus and the original reply layout. Face recognition and handle guessing remain out of scope.

### QQ image CDN host — 2026-11-04

The first live `/鱼鱼找鸡` after the Lens rollout failed before any engine ran: `officialImageUrl` allowed only `qpic.cn`, `qq.com` and `gtimg` hosts, but current group images are served from `multimedia.nt.qq.com.cn`, so `getImage` rejected the URL. The allowlist now includes `nt.qq.com.cn` as an exact subdomain (look-alike hosts such as `multimedia.nt.qq.com.cn.evil.test` remain rejected), with a regression test. The direct command now distinguishes "image could not be fetched" from "search failed", logs only the stable stage/code, and uses a 60-second outer deadline so the client's 45-second partial-result deadline wins instead of aborting the whole reply.

Verified against the failing message: the 150,477-byte JPEG downloaded successfully, and the full four-engine search finished in about 30 seconds with SauceNAO/trace.moe/Lens `ok` and no artwork match, IQDB `TIMEOUT`. No generic failure reply and no synthetic QQ/Bili messages were produced.

Source-port backup: `/opt/chopsticks-backups/source-port-20261104-014102` (code, private config, systemd drop-in). Server suite: 201/201. Verified against the live coser photo: the unchanged source `extractAccounts`/`formatReply` produced the original `🎯 **鱼鱼找鸡结果**` layout with three URL-backed X accounts (`@yingshaoovo`, `@yunaponk`, `@yogana_19`) in about 10 seconds. Names use the source's own fallbacks (handle or title fragment), not a new cleanup rule. Only public account names/URLs were printed; the image itself was not logged and no QQ message was sent.

Expired image URL refresh: QQ image URLs carry a short-lived rkey. The first live retry still failed with `QQ image download failed` because it replied to an older image message whose stored URL had expired, even though the message was still in the adapter's received cache. `adapters/qq.mjs` now asks the gateway for a fresh URL through `get_image(file)` when the stored URL fails and retries the download once; a same-URL response does not loop. Backup: `/opt/chopsticks-backups/expired-url-20261104-023703`. Server suite: 203/203. Verified with a deliberately expired URL against the live message: the gateway returned a fresh URL, the 150,477-byte JPEG downloaded, and the full source reply completed in about 30 seconds with three URL-backed X accounts (example run: `@yingshaoovo`, `@yunaponk`, `@Lili_amamiya22`). Lens card order varies between runs.
