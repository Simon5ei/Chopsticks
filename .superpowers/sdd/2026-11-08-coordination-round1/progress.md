# SDD ledger — plan: docs/superpowers/plans/2026-11-08-coordination-round1.md
Baseline: a3e2eb9573796254220cf9a6c08f39b700b390fb; 45 targeted tests passed.
Ruling: user already approved the concrete diagram and asked to implement, so no repeat approval gate.
Ruling: native worktree tool rejected nested repository sourceRoot; manual linked worktree used. Original checkout untouched.
Preflight: Tasks 1/2/3 own disjoint files; root owns runtime/index/guard/presets/UI and integrates their published APIs.

Completed: durable fixed conversation batches, bounded task/context reads, stable workers and development cwd, deterministic supervision, runtime integration and authenticated pipeline console.
Independent reviews: task recovery race, failed/blocked false-resume, supervisor starvation, cross-source development results in explicit AND automatic context, and queued worker trace attribution all reproduced and repaired. Final reviewer found no remaining required issue in scope.
Verification: full local suite 835 tests / 819 pass / 16 environment skips / 0 fail. Linux candidate 124 / 124. Native DSH + configured DeepSeek with fake adapters: two sources -> one dispatch after fixed 3000 ms, persistent session reused, public recall works, 11 completed responses all supplied native usage, zero real platform writes.
Production: deployed 19 hash-verified files, explicitly set routing.batchWindowMs=3000. DSH active; QQ connected and receiveHealthy; no Router errors. Browser opened authenticated /api/chopsticks/pipeline and displayed live usage, tasks and traces; screenshot visually checked.
Integration ruling: user previously explicitly asked to store/iterate code in Simon5ei/Chopsticks. Publish a feature branch without replacing main or staging the original checkout's unrelated work. Baseline a3e2eb9 is explicitly the pre-existing local integration snapshot; current coordination changes follow it. Production package was three-way merged against actual server sources to exclude unrelated unpublished reminders/MaiBot changes.
Preserve worktree and original checkout. No destructive cleanup and no synthetic QQ/Bili sends.
