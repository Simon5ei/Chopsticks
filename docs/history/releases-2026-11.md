# Deployment evidence through 2026-11-08

Historical commands and revisions below describe their original releases; use [current deployment instructions](../operations/deployment.md) for new deployments.

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

Native process logging uses explicit stdout metadata because the optional host logger produced no journal output on this deployment. Browser trace details remain in the private trace store. See [console data limits](../guides/console.md).

## QQ administrator development — 2026-11-03

Production now explicitly enables `development` with workspace `/root/workspace/dsh`. Only a consumed canonical message from the configured QQ owner can create the developer capability. The chat worker delegates to a dedicated development preset; research and Bili workers retain their existing tools. Exact raw owner requests and approved follow-ups persist with the task, and another group member cannot follow or stop that task.

The isolated real DeepSeek flow created three directories, copied a CSV, ran `wc -l` and `sha256sum`, and returned a confirmed task result. Source and destination SHA-256 matched. A non-owner message claiming administrator identity, even with a forged admin metadata flag, was processed without creating its requested file. The final Linux suite passed 139/139, including the correction that preserves the Bili role label after its first bound event. Tests include actual shell execution and killing a background process group on cancellation.

Backup: `/opt/chopsticks-backups/admin-development-20261103-020915`. To roll back, stop DSH, restore its `config.json` and extract `code.tgz` into `/opt/chopsticks`, recompose the profile and restart. Original QQ/Bili sessions and memory were retained. No failed historical directory operation was replayed and no real test message was sent. At that release, the wishlist was still in its verified old location and the daily research task retained a fallback. This transitional setup has since been retired; see the workspace cleanup below and [current workspace routes](../operations/workspace.md).

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
## TypeScript runtime and documentation cleanup — 2026-11-09

Runtime revision: `f6518cae2d939d4f6fc7c56704490d7bad71e86c`. Owned Node modules and tests now use `.mts`, and browser code uses `.ts`. Compilation produces the same runtime-relative `.mjs`/`.js` entrypoints in `dist/release`; production contains neither the compiler nor tests. Imported JavaScript and the optional MaiBot Python runner retain their original boundaries and license notices. Type checking is enabled without suppression; strict mode remains a separate future tightening of dynamic integration boundaries.

Removed unused bindings/helpers and retired initial extraction/cutover scripts. Current documentation is divided into architecture, guides and operations, with dated evidence under history and an index in `docs/README.md`. Additive recovery utilities and all existing server backups remain available.

Verification: Windows 840 tests / 824 passed / 16 skipped; Linux 840 tests / 831 passed / 9 skipped; zero failures. A clean Linux build caught a missing native browser-loader declaration, which was added before deployment. Independent review also identified and fixed failure reporting for signal-terminated test subprocesses. Native DSH with the real DeepSeek model passed isolated, layered-routing acceptance: confirmed cross-group recall, private fixture exclusion and background task result persistence. The acceptance fixture used a fake transport and no real platform/desktop MCP; no synthetic production posts or private-message tests were performed.

Server build/tests ran serially under systemd limits: 1 GiB memory, no swap, 50% CPU, 32 tasks and finite deadlines. Nested test startup was replaced for acceptance by separate direct build/test invocations with small V8/libuv pools. Failed startup and fixture attempts were diagnosed within their original scope; no native history was decompressed.

Cutover preserved the complete former deployment at `/opt/chopsticks-backups/typescript-20261109-f6518ca/previous-code`, with private configuration/profile/unit metadata and the previous live-source manifest alongside it. External data remained in place. Configuration, native credentials, persona/current-character files and all nine QQ session mappings retained their hashes. The new service is the sole task-journal owner; the old PID exited. Fresh readiness, connected/healthy QQ reception, owner authentication (unauthenticated HTTP 401) and critical deployed source hashes passed post-cutover checks. The 155-file live-source manifest revision is `9514863878bf6bf37be85536c73a6966c6dc7404ef5a5fc87c616b409db7ae70`.

Rollback: stop `dsh-lan.socket`, `dsh-lan.service` and `dsh.service`; preserve the current code separately and restore `previous-code` to `/opt/chopsticks`; restore the backed-up `source-revision.json` to `/var/lib/chopsticks/state/life/source-revision.json`; recompose the web profile, then restart DSH and the LAN units. Keep current databases and native histories, and do not replay uncertain sends. Private deployment and postcheck receipts are stored in the backup directory.

## Observable prompts, content observations and recovered server repairs — 2026-11-14

Runtime revision: `69fb76368401b0ed86e90dfa69bf54a7ba0a08e2`. Before this release the production host was not running any Git revision: it ran the `codex/bug-pipeline` branch plus repairs that the on-server development session had made in place in its source candidate from 2026-11-10 to 2026-11-13. Those repairs were recovered unchanged as commit `60cd9b0` (branch `server/bug-pipeline-live`) and merged, so the release adds to the live behaviour instead of reverting it.

Added: the prompt registry, decision log and the owner-only page `/api/chopsticks/prompts`; read-only content observations with a private daily recap (every platform switch defaults to off and production does not enable them); the hardened image upload reducer, which replaces the server's `prepare.mts`. Prompt wording is unchanged: all 85 fixed texts in the prompt catalog were checked verbatim against the source production was built from.

Verification: Windows 980 tests / 964 passed / 16 skipped; Linux 980 tests / 970 passed / 10 skipped; zero failures. Server build and tests ran serially under systemd limits (1 GiB memory, no swap, 50% CPU, 32 tasks, 195 s and 255 s deadlines). Isolated acceptance used a private DSH home, `validation:true`, layered routing, the fake QQ transport and the real DeepSeek Flash model: the fish answered a question in one group from what it had said in another, the private fixture stayed out of every recorded prompt and of the reply, a background task delivered its result, and the Router, dispatch and worker prompts recorded by the registry were identical to the text the native sessions received. No platform write was performed.

Two earlier acceptance attempts are kept beside the passing one in the validation directory. They asked the fish to repeat "what you said in group A"; under the current owner-privacy wording the model treated that as carrying talk across groups and once answered evasively and once chose not to reply. The mechanism worked in both; the fixture question was changed to an ordinary one.

Cutover at 16:20 CST took 23 seconds. Production was idle beforehand: no pending or dispatching Router work, no open batch, no active repair batch. The former code, private configuration, profile, unit files, live-source manifest and the former server source are in `/opt/chopsticks-backups/observability-20261114-69fb763`. `node_modules` stayed in place because `package-lock.json` is unchanged. Identity, mapping and configuration hashes are unchanged; readiness was fresh, QQ reception connected and healthy, and the prompts page answered HTTP 401 without a login. The runtime recorded snapshot 1 and its first prompt render within seconds of starting.

Not done: the live-source manifest (`source-revision.json`) was not re-frozen, so the operator live-test runner refuses to run until it is.

Source directory follow-up, 19:01 CST the same day, on the administrator's explicit instruction: the on-server source candidate `/opt/chopsticks-candidates/bug-pipeline-20261110` was brought to `69fb763`, so a full-tree deployment from it no longer reverts this release. Guards held first: production still ran the candidate, no process was working in the tree, and nothing in it had changed since the archive was taken. `src`, `tests`, `presets`, `scripts`, `types` and `docs` are identical to the deployed revision, `dist/release` matches the live code, and `package.json` and `package-lock.json` are unchanged, so the tree's `node_modules` stayed. Nothing was deleted: the replaced directories and top-level files were moved to `source-dir-before-sync/` in the backup directory, beside `previous-source.tgz`. A `SOURCE-REVISION.md` note in the tree records the revision and where host prompt text now lives. Later edits in that tree still do not reach Git by themselves.

Rollback: stop `dsh-lan.socket`, `dsh-lan.service` and `dsh.service`; restore `previous-code` into `/opt/chopsticks` leaving `node_modules` in place; recompose the web profile and restart. The new tables in `traces.sqlite` are additive and can stay.
