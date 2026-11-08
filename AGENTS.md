# Chopsticks / 筷子

User-authorized independent extraction and replacement of the server fish runtime. Read docs/design.md and docs/superpowers/plans/2026-11-02-initial-runtime.md before implementation.

- Preserve fish identity, credentials and historical sessions outside Git; no runtime data in this public repository.
- No dependency on installed SurfCore or SessionCross. The project license is GPL-3.0-only. Preserve each upstream license and attribution, including the existing MIT notices; review each MaiBot plugin's license before adaptation rather than relabeling third-party code.
- New behavior requires failing regression tests before implementation. Integration must use real server DSH and model in isolation before cutover.
- Stable event IDs, confirmed outbound receipts, bounded contexts, no blind retry after ambiguous sends.
- Share group experiences; private/operator details stay separately scoped until explicitly authorized otherwise.
- Do not delete old deployment or history. Back up before overwrites. Synthetic outbound tests require specific administrator authorization. The authorized fixed-text `pong` regression uses the operator-only live-test runner, exact source revision, one durable attempt and actual own-post readback; unknown results never permit blind resend. Private-message testing remains excluded. Respect platform-specific holds.
- User authorized push to Simon5ei/Chopsticks and full server cutover after verification; do not ask again.
- Keep changes in assigned files. No secrets in logs, commits, model contexts or test output.

## Mandatory diagnostic resource limits

- Before any resource inspection, diagnostic or acceptance workload, define the exact target paths/processes, maximum input bytes/rows/files, runtime deadline, and CPU/memory budget. Read-only access is not evidence of low impact.
- Server diagnostic processes must run inside an enforced resource boundary (for example a transient systemd unit with MemoryMax, MemorySwapMax, CPUQuota, TasksMax, RuntimeMaxSec and process-group termination). Shell/SSH timeout alone is insufficient. If these limits cannot be enforced, do not execute the workload.
- Bound input before reading, allocating, parsing or decompressing it. Output truncation and LIMIT after loading everything do not bound workload. Never perform unrestricted recursive scans or full native-history decompression as a routine health check.
- Prefer exact-key queries, small incremental samples and existing verification evidence. Check previous results before repeating a scan. Keep diagnostic concurrency at one and do not rerun a completed heavy check without new evidence that it is needed.
- Use finite connection timeouts and low-frequency probes for unreachable hosts. Stop diagnostics on pressure, timeout or loss of connectivity; preserve the failure evidence and do not escalate to a broader or uncapped workload.
