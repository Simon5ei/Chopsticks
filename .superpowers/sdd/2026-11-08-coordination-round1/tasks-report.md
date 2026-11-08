# Task 2 — task coordination

Implemented in coordinator/executor with vendor unchanged.

- `knowledge(caller,{query,id,limit})`: id detail object or bounded summary array (max20, summary1500, prompt4000). Cross-scope visibility requires same character, both canonical public channels, research mode, neither caller/source operator or worker. Scoped status/follow/stop/report authorization unchanged.
- `routeSource` cross-public attach journals canonical source trigger and a context-only provenance note. It does not attach a subscription, change original caller, or grant machine authority. Host remains responsible for verifying event/thread/text and explicit ticket reference. Operator cross-scope attach/stop remain rejected.
- New session mapping hashes ticket identity; existing ticket worker mapping is adopted. Old assignment stop cannot overwrite current binding; stale assignment reports rejected. Existing effect live checks prevent old assignment launch/prompt execution.
- New development native cwd is workerRoot/tasks/sha256(ticket.id).slice(0,32). Existing inspected sessions are not relocated. Research fixed cwd retained.
- `supervise({now,staleMs,cooldownMs,limit})` returns `{checked,actions,attention}`, max100 tickets/iteration. It requests waiting-worker status once or resumes provably idle research once if no unresolved effect. Durable records (`supervision`) hold cooldown/resumed/statusRequested/attention; scoped project exposes supervision. Concurrent calls share the same run. Recheck cancellation/assignment after asynchronous inspection. Unknown or development/effect ambiguity requires attention and is never replayed.
- `resolveTaskMode(ticketId)` host callback supports historical task-source development classification. Native unattached agents return unknown running/pending rather than false.

Integration required: root wires trusted caller/admin and authoritative source references, task mode callback, timer/observability, and development exec default cwd. No args can grant authority. New development marker alone only restricts sharing/recovery; machine permission remains host controlled.

TDD evidence: first tests failed for missing knowledge/supervise, assignment-based session identity, shared development cwd; legacy-mode callback and concurrent-supervise/missing-agent regressions also observed red before fixes. Final affected test command `node --test tests/tasks*.test.mjs tests/dsh-executor-workspace.test.mjs`: 37 pass, 0 fail. Full npm test deferred to root integration as requested. No server commands or external sends.

Review notes: knowledge output is bounded but underlying existing store repositories enumerate ticket rows; no new SQL query/index interface added under file ownership constraints. Supervision uses original worker/session and a new continuation note, not replay of accepted prompt IDs. Recovery is restricted to host-classified research and definite attached idle state. No model call for unchanged active healthy workers. Existing uncertainty receipt reconciliation remains intact.
