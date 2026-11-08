# Tasks/context independent review

Baseline: `a3e2eb9`. Reviewed actual coordinator/executor diff and new context-service, their tests, module reports, and the approved spec. Read-only code review; only this report was written. No server operations, private logs, or external sends. Synthetic reproduction used temporary directories that were removed afterward.

## Findings

### P1 — Revalidate effects and ticket freshness after async worker inspection

`tasks/coordinator.mjs:405-414` snapshots unresolved effects before awaiting `executor.isRunning`. After the await it only checks cancellation and assignment identity. A follow-up can create a new prompt on the same assignment during that await; even if its acceptance becomes uncertain, `safe` still uses the empty old `pending` list and issues another recovery prompt.

Reproduced: submit/flush a research task; begin supervise with a deferred `isRunning`; while deferred, follow/flush and have the second prompt throw `lost acknowledgement`; then resolve inspection with `{running:false,pending:false}`. Immediately before resolution status has `deliveryState:'uncertain'`, prompts=2. Supervise returns `action:'resume'`, and flush produces prompts=3 while uncertainty remains. This breaks the requirement to hold unknown effects and risks overlapping continuation with an accepted but unacknowledged prompt.

Refresh the ticket, report, supervision and unresolved effects after the asynchronous boundary; reject a stale observation when progress/delivery changed during inspection. The existing cancellation/assignment recheck alone is insufficient.

### P2 — Failed/blocked tasks falsely consume the single recovery attempt

`tasks/coordinator.mjs:412-415` treats any idle research task without pending effects as recoverable and persists `resumed:true` before calling `engine.note`. But `tasks/vendor/tickets.mjs` `addInput` holds automatic notes when `waitsForPerson(ticket)` is true; `tasks/vendor/model.mjs:47-51` returns true for failed/blocked tasks without a newer human trigger. No prompt is queued.

Reproduced: submit/flush; report `failed` with the accepted delivery ID; supervise with an idle executor. Result advertises `action:'resume'`, durable supervision contains `resumed:true`, but prompt count remains 1 after flush. Subsequent cycles cannot recover because the sole attempt was already consumed. Either classify failed/blocked as attention immediately or use an explicit safe recovery transition which actually queues a continuation; only record successful scheduling as resumed.

### P2 — Fixed newest-first slice permanently starves older open tasks

`tasks/coordinator.mjs:399` slices `repo.tickets.open()` before evaluating staleness/cooldown and has no iteration cursor. `tasks/store.mjs` returns tickets newest-first. With 26 open tickets at default limit 25, the oldest is never checked while those newer tickets remain open, including when the newer tickets are healthy or in cooldown.

Reproduced with 26 synthetic tasks and two supervise iterations past cooldown: both return checked=25; neither includes the oldest ticket; its supervision remains undefined. Use bounded fair pagination/rotation across iterations (including after restart where appropriate), rather than repeatedly selecting the same prefix.

## Verification and integration observations

- `node --test tests/tasks-round1.test.mjs tests/dsh-executor-workspace.test.mjs tests/context-service.test.mjs`: 22 passed, 0 failed. Existing cases do not exercise the three scenarios above.
- Public research lookup uses canonical public channels plus matching character. Private/operator/development cross-public detail checks pass. Cross-source context notes do not add subscriptions or change task origin/control authority.
- Stable task session identity and saved assignment checks pass existing tests. Keep `deliveryId` required in the host report tool: coordinator's legacy optional-delivery fallback cannot independently identify an old report if the host resolves the stable session to its current assignment. The current host tool schema already requires it.
- New development cwd is ticket-derived; restored inspected sessions are intentionally not moved. Host execution default cwd must use the native session workspace, not the original shared default.
- Root must supply historical `resolveTaskMode(ticketId)` based on durable development provenance. Do not derive historical task visibility from a currently-valid grant only: revoked/expired development grants must not make old development details public or eligible for read-only recovery.
- Context task reads delegate unchanged to `coordinator.knowledge`; root must pass a trusted source caller including supported role/sessionId/chatKey/characterId. A generic `{role:'router',channel}` works for event reads but will be rejected by real task knowledge. Existing context test mocks knowledge, so it does not establish integration compatibility.
- Context search/event/thread queries are bounded and scope checked. A minor API inconsistency remains: search returns `nextBeforeSeq` through the shared envelope, but its signature does not accept `beforeSeq`; callers cannot paginate search results using that cursor. Thread read pagination works. This is not included as a release-blocking finding.

Runtime/UI/core integration was still in progress and is excluded from defect judgments here.
