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
