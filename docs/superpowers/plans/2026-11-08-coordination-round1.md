# Coordination Round One Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the isolated modules and review; root integrates and deploys. Steps follow failing tests, implementation, passing tests, review.

**Goal:** Ship the approved seven improvements in existing Chopsticks.
**Architecture:** Extend the event Router, task coordinator, shared context reader and trace projection; preserve authoritative source events and effects. Existing production/native tool integrations remain intact.
**Tech Stack:** Node 24, SQLite, DSH native sessions/tools, existing authenticated management UI.
**Spec:** docs/superpowers/specs/2026-11-08-coordination-round1.md

## Global Constraints
- No unrelated changes, private runtime data, credentials, or synthetic outbound messages.
- Fixed 3000 ms batching in production; configurable zero in existing compatibility tests.
- Input budgets and enforced cgroups for every server probe; one diagnostic at a time.
- Deployment uses hash-checked file deltas against fresh server baseline and backups, never rewinds databases.
- Local baseline a3e2eb9 includes concurrent integration work; it is a local snapshot, not an independently reviewed release.

## Review Focus
- Mixed actors/admin messages in a batch must not lend authority to another message.
- Crashes between decision/delivery must not duplicate replies or tasks.
- Cross-chat reads and notes must not leak private/development work or grant write authority.
- A stale Worker recovery must not replay unknown tool effects.
- Console rendering and usage dedup must remain safe with missing or duplicate native events.

## Tasks and interfaces
- [ ] 1. `core/batching.mjs`, `core/router.mjs`, batching tests: add optional `batchWindowMs`, `onBatch`, `urgent` Router inputs. Durable fixed windows, one grouped action/dispatch, retain source IDs and report batch metadata to host. Existing behavior when window is zero. Agent documents exact output contract before root integration. Test with injected clock/timing where feasible.
- [ ] 2. `tasks/coordinator.mjs`, `tasks/dsh-executor.mjs`, task tests: public research `knowledge(caller,{query,id,limit})`, source-bound cross-public context notes via routeSource attach; retain private/write/stop scope. Stable ticket session mapping, development cwd, bounded deterministic `supervise` with durable recovery receipts. Root wires trusted caller and callbacks. Test knowledge boundaries, session reuse, interrupted research versus ambiguous/development work.
- [ ] 3. `host/context-service.mjs`, context tests: `createContextService({store,state,coordinator})` exposes `search(caller,{query,limit})`, `read(caller,{kind,id,beforeSeq,limit})`, `overview(caller)`. Event/thread reads honor public versus exact private scope, cap rows/chars and return reference IDs. Task reads delegate coordinator knowledge. No runtime/index edits by this task.
- [ ] 4. Root integrates `host/runtime.mjs`, `host/index.mjs`, `host/guard.mjs`, presets: enable 3000 ms batching, bind source-scoped Router tools, task/context summaries, administrator quick cancel; preserve original actor/authority per message. Tests for combined dispatch, Router read capability and provenance.
- [ ] 5. Root extends `host/observability.mjs`, management routes/assets, console allowlist and runtime projection: indexed correlation fields, usage accounting with unknown status, pipeline list/detail and links to existing pages. Test migrations, duplicate usage, auth boundary and escaping.
- [ ] 6. Run affected/full tests once, review modules and final integrated changes, fix substantive issues, run isolated real DSH/model acceptance under capped resources, hash-check and deploy, verify passive production health and console, integrate own deltas back into main checkout preserving concurrent changes.

Expected test commands: `node --test tests/batching*.test.mjs`, `node --test tests/tasks*.test.mjs tests/dsh-executor-workspace.test.mjs`, `node --test tests/context-service.test.mjs`, then affected integration tests and `npm test`. Expected: pass with explicit pre-existing failures separated if encountered.
