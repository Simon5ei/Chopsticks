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

Backup: `/opt/chopsticks-backups/admin-development-20261103-020915`. To roll back, stop DSH, restore its `config.json` and extract `code.tgz` into `/opt/chopsticks`, recompose the profile and restart. Original QQ/Bili sessions and memory were retained. No failed historical directory operation was replayed and no real test message was sent. The default workspace exists; the wishlist remains in its verified old location until a new administrator instruction moves it. The daily research task checks the intended new CSV paths first and falls back to the existing old file.
