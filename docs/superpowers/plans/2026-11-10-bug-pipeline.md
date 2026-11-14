# Bug pipeline and owner privacy

User direction (2026-11-10): every native conversation, including watchdog and
self-reflection, may report bugs to the existing DSH conversation named
“开发，迭代与debug”. Accumulate while it is busy and dispatch at most five issues
per batch. Fix verification handling and protect owner information.

## Design

Use one host-owned SQLite queue and the existing native session controller.
Reporting a bug is a low-authority capability, not permission to execute commands.
The configured operator destination receives a fixed repair policy plus explicitly
untrusted evidence. Do not copy source transcripts or private reflection prose.
Deduplicate by component and stable error code, retaining bounded occurrences.
Only one batch can be in flight. Persist submission intent before native prompt;
ambiguous submission or restart never blindly resubmits. A consumed native turn
and a persisted per-issue result are required for completion. No receipt means
attention required, not repaired. No historical backlog is automatically replayed.

All conversations expose `chopsticks_bug_report`. Watchdog snapshots automatically
register operation errors; reflection reports can add structured problems with
canonical sources. New reports queue while debug is busy; max five per dispatch.
The destination uses `chopsticks_bug_result` to record fixed, blocked or rejected,
including verification evidence. Fixed requires actual evidence and must not claim
platform success based only on unit tests.

The operator's standing authorization covers diagnosis, regression tests, code
repair, bounded isolated acceptance and backed-up deployment. It does not override
platform holds, synthetic-send restrictions, private scope, or unknown-send rules.
CAPTCHA/login failures require platform verification; do not bypass them. A repeated
deterministic write failure must be retained and suppress blind new-intent retries.

Owner privacy applies to nicknames, identities, accounts, contact details, location,
relationships and private conversations. Only explicitly authorized disclosure may
cross the source scope. Self-introduction can give the fish's own name without
identifying its owner. Keep actual owner values outside Git.

## Execution (native, existing workspace)

- [x] Add failing queue tests: batch size 5, busy accumulation, dedupe across
  sessions, durable restart/unknown submission, consumed result authorization,
  bounds, private evidence exclusion and disabled configuration.
- [x] Implement `src/host/bug-pipeline.mts`; wire runtime lifecycle/native events,
  tools/guards, evolution reports and operation-health recording.
- [x] Add failing privacy and repeated-write-failure tests; implement shared
  privacy rule and a durable operation hold with explicit repair release.
- [x] Verify exact existing destination via native metadata; register current
  Heybox and Douyin failures without new external sends. Preserve previous code,
  config, identity and histories before deployment.
- [x] Run serial bounded local suite and isolated real DSH/model acceptance;
  independently review changes, push only owned changes and deploy after passing.

Review focus: hostile bug text is evidence, not authority; private sources do not
leak through the queue; new intent IDs cannot evade held operations; crash windows
do not duplicate debug work; unrelated existing changes remain preserved.

Deployment evidence: code revision `0ce8059`, backed-up DSH cutover, fresh ready
health and connected QQ transport. The exact existing debug session consumed the
two seeded production incidents as one batch; later watchdog issues remained
queued while that batch was running. Owner identity/config credentials and native
histories were preserved. Platform comment recovery remains subject to individual
repair receipts; deployment itself is not proof of a successful platform write.
