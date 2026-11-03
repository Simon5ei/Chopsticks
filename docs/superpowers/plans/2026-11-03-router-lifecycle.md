# Router lifecycle implementation plan

**Goal:** Keep one logical coordinator visible in the console; archive completed internal evaluations without losing history or resetting QQ sessions.

**Approved design:** Each evaluation keeps an independent, bounded context. Native DSH archive hides completed sessions. New router agents are created through the owned Agent API so their handles can be disposed after archival. Cleanup runs outside tool callbacks, retries failures, and recovers legacy sessions only under this runtime's router workspace. Active evaluations are never archived. Native history and telemetry remain available.

**Execution:** Inline using executing-plans; TDD, then independent branch review. Deployment and repository push already authorized.

**Files:** `host/router-sessions.mjs` owns lifecycle and recovery; `host/runtime.mjs` wires evaluation boundaries and logical console identity; `host/index.mjs` adapts native archive/owned agent APIs; `host/observability.mjs` supports aggregate trace lookup; `console/client.js` labels the logical coordinator. Tests cover cleanup, recovery and aggregate navigation.

- [x] Write failing lifecycle tests: active/idle, archive failure retry, release failure retry, restart recovery, unrelated session exclusion, timeout/initialization failure.
- [x] Implement lifecycle and runtime/native adapter; verify fresh contexts still separate private/public inputs and QQ mappings remain stable.
- [x] Test and implement one logical console entry with trace/event lookup across evaluation sessions, including after restart.
- [x] Run full suite, independent review, real native DSH/model isolation acceptance with no public messages.
- [x] Back up and deploy during idle; verify old router sessions archived, new runs archive/release, QQ healthy, logs retained. Commit/push and document evidence.

**Review focus:** No disposing during a tool callback; archive errors must not replay a committed decision; model initialization timeout must still clean up; old sessions must not be silently resumed; source filters and private scopes remain unchanged.

**Evidence:** Linux 148/148; independent review fixes for initialization cancellation and native teardown rejection; isolated DeepSeek cross-group/task/native archive + browser acceptance; production 39/39 archived, zero live Router agents, QQ healthy and identity/memory hashes preserved.

**Rulings:** Native managed-worktree tool could not address nested repository, so a Git linked worktree was used. Native shutdown exposed a queued tool-guard refresh after scope teardown; narrow INACTIVE_EFFECT handling plus regression added. Source transcripts remain unchanged; archives retain their original IDs.
