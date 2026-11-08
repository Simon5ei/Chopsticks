# Deployment and recovery

Production code: `/opt/chopsticks`. External private data: `/var/lib/chopsticks`. DSH retains its original home and native histories; SnowLuma remains independently authenticated. Deploy the compiled `dist/release/` tree, retaining the existing runtime-relative `.mjs` paths.

## Build and acceptance

Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run typecheck`, and `npm test` in the source checkout. Tests build first and execute compiled code with one worker. Release output excludes tests and private data. Preserve all upstream notices.

Before every diagnostic, declare exact target paths/processes, file/byte/row limits, deadline and CPU/memory budget. Server workloads must use enforced process-tree limits, for example:

```sh
sudo systemd-run --wait --pipe --collect \
  -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=50% \
  -p TasksMax=32 -p RuntimeMaxSec=300 -p KillMode=control-group \
  --working-directory=/opt/chopsticks-candidate \
  /opt/node24/bin/node --test --test-concurrency=1 --test-timeout=30000 tests/*.test.mjs
```

Use a concrete candidate directory containing compiled tests and their dependencies. The release tree itself intentionally has no tests. SSH timeout alone is insufficient. Stop on pressure, timeout or connectivity loss; do not broaden the workload.

Real DSH/model acceptance uses a separate private DSH home, `validation:true`, fake QQ transport, disabled publishing and isolated state. Verify confirmed public cross-group recall, private exclusion and background task completion. Do not reuse production native sessions. Ordinary deployment performs no synthetic platform posts or private-message tests.

## Cutover

1. Verify candidate revision and capture bounded current readiness, pending work and delivery-owner status.
2. Back up code, private config and exact profile/unit files being changed outside Git. Hash small identity/mapping files. Do not decompress native history as a health check.
3. Stop the LAN socket/proxy before DSH: its dependency can reactivate DSH. Stop DSH and confirm the old delivery process group is gone.
4. Install the verified release at `/opt/chopsticks`, preserving the old deployment in its backup. Install production dependencies with `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`.
5. Materialize the existing web profile using `DSH_HOME=/root/.dsh /opt/node24/bin/dsh --profile web --dump-config`, discarding secret-bearing output, then restart DSH and the LAN socket/proxy.
6. Verify current code hashes, native readiness and QQ reception with small exact-file probes. Confirm identity/config/mappings are unchanged. Preserve databases and native histories in place.

Keep one active production delivery owner. Never replay uncertain outbound attempts. Platform holds and operator-only live-test restrictions remain in force; see [live tests](live-tests.md).

## Rollback

Stop the LAN socket/proxy and DSH, restore backed-up code and any changed profile/unit files, recompose the web profile and restart. Preserve current databases and native histories: additive records are audit evidence. Restoring code does not authorize restoring stale state or retrying an unknown effect.

The original SurfCore initial-cutover executables are retired. Their source remains in Git and the external pre-refactor backup. Offline session-header adoption and additive memory-import utilities remain in `src/deployment/`; these are recovery tools for stopped, backed-up target state.

Historical results and backup locations: [November releases](../history/releases-2026-11.md), [initial ledger](../history/initial-deployment.md). Historical model choices and commands describe their original dates, not the current configuration.