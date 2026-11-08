# Independent integration review

## Final disposition after shared-context repair

**All necessary findings raised in this review are now resolved in the inspected code.** The subsequent `core/events.mjs` fix filters cross-source task results in `recent()`, so automatic Router context, live prompt context and recall inherit the same restriction. Same-source evidence remains available; only known public research tasks cross sources; missing or malformed provenance does not grant sharing. Confirmed the new tests exercise both explicit context-service APIs and automatic `store.context` / `liveConversationContext`, closing the P1 bypass documented below.

Independent final run: `node --test --test-concurrency=1 tests/context-event-privacy.test.mjs tests/context-service.test.mjs tests/runtime-coordination.test.mjs tests/pipeline.test.mjs` — **19 passed, 0 failed**. Together with the preceding 27-pass run, this verifies both final integration fixes and all three original supervision fixes. No additional necessary omission found within this review scope. Historical findings below are retained as review evidence, not open blockers.

## Final-fix recheck (2026-11-08)

The queued-worker attribution fix is verified: worker-request metadata is saved at admission, active traceSource switches on native user/message consumption, and the regression preserves old-turn response attribution until that switch. The context-service fix also correctly filters development and unknown task IDs from cross-source search/event/thread reads while allowing same-source access and known research sharing.

**One necessary P1 omission remains in the broader evidence path:** core Router `freshContext` (`core/router.mjs:100`) and ordinary model prompt assembly (`host/conversation-summary.mjs:9-10`) still call `store.context` directly. That path uses public-channel recent events without the new task visibility filter. Reproduced on the final code with a `g:1` development result and a `g:2` caller: `contextService.search` returns zero events, but `store.context({channel:'g:2'}).text` contains `DEVELOPMENT_RESULT_PRIVATE_DETAIL`. The same text is automatically handed to the Router and ordinary model without invoking any context tool. Apply the cross-source task-result restriction to this shared context path as well; a regression should assert both explicit tool reads and automatic model context exclude development/unknown results.

Latest independent command: `node --test --test-concurrency=1 tests/context-service.test.mjs tests/runtime-coordination.test.mjs tests/tasks-round1.test.mjs tests/pipeline.test.mjs` — **27 passed, 0 failed**. These tests establish the direct fixes but currently do not cover the automatic-context bypass above.

Additional inspection confirms result-source and sourceBinding carry original/member event IDs and batch IDs into task result delivery, pipeline indexing recognizes batchIds, onResult records a task.result trace, and supervision projection retains durable attention records. Root reports that isolated real DSH + DeepSeek acceptance passed with native `d.usage` and stable `seq`, and all 11 responses supplied usage; this native acceptance was performed by root, not independently rerun by this reviewer.

Reviewed current batching/router, runtime/context tools, observability/pipeline, authenticated UI routes and the three coordinator fixes. Code was changing concurrently; findings below identify the exact observed behavior rather than claiming a frozen commit review. No server operations or private log reads; only this report written.

## Required fixes found

### P1 — Event evidence bypasses development task visibility

`host/runtime.mjs:223-226` journals worker results as `task.result` under the original public group channel with `meta.ticketId`. `host/context-service.mjs:4-10,39-42,51-54` authorizes event search/read/thread only by channel publicity, with no task classification check. Consequently a caller in another public group can read development task results even though `coordinator.knowledge` correctly denies that same task.

Reproduced using real event store, context service and coordinator: create development task in `g:1`; caller in `g:2` receives scope error from `knowledge({id})`; append the exact runtime result shape (`kind:'task.result', channel:'g:1', meta:{ticketId}, text:'DEVELOPMENT_RESULT_INTERNAL_DETAILS'`); both search and exact event read return the private development detail to `g:2`. This is a concrete alternate access path around the task boundary, not an operator-console concern.

Required: keep same-source access, but restrict cross-source event evidence tied to private/operator/development tasks consistently across search, exact event and thread reads, using durable task provenance. Include an integrated regression covering knowledge denial plus all evidence expansion routes.

### P2 — Queued worker prompts replace active trace attribution too early

`host/runtime.mjs:219` sets `traceSource(sessionId, binding)` as soon as a worker prompt is sent to DSH queue. `event()` at line 388 uses that map before any binding. When a stable worker is already running and receives a follow-up, its remaining current-turn tool calls/model response are attributed to the newly queued prompt's `requestId`, even before the follow-up is consumed. This distorts per-request usage and causal trace navigation.

Required: record prompt admission separately, then switch the active worker trace context when the matching native `user/message` with `source.rpcId` is consumed. Preserve the earlier active context until that boundary. Existing platform binding machinery already illustrates this separation.

## Findings reported during review and being repaired by root

- Original task-source/task.prompt projections lost batchId and nonselected member eventIds, cutting batch/member navigation off before the task execution. Root has since added these fields to task-source, task.prompt and command traces. End-to-end result/receipt correlation should be included in root's integrated regression.
- Default runtime batch window remains zero deliberately for compatibility. Root confirmed production config will explicitly set `routing.batchWindowMs=3000`; this is a deployment requirement, not an open code defect.
- Root identified and repaired unaddressed follow-up admission during an existing group window. The newly added regression passed on independent rerun.

## Verified outcomes

- The original supervisor findings are repaired: fresh ticket/effect/supervision snapshot comparison after inspection; failed/blocked states require attention without consuming resume; durable rotating cursor reaches older tasks. All three new regressions passed independently.
- Explicit owner task stop bypasses the window without a model call and remains bound to the canonical source. Cross-channel control is not broadened.
- Batch source binding retains the selected event's actor/admin status while carrying member event IDs; no synthetic combined text becomes authority. Pending windows persist across restart, processing arrivals go to the next batch, and ambiguous dispatch is not automatically replayed.
- Context tools use runtime-resolved source callers; generic router privilege does not enlarge private event scope. Public research task cross-group access remains separate from follow/stop authority.
- Usage tests verify stable-native-event deduplication, actual supplied token values, partial/unknown usage, and filter-wide totals independent of paging. These tests use synthetic native events; actual deployed DSH usage shape still belongs to the planned real-native acceptance.
- Pipeline UI uses DOM textContent, bounded response parsing, exact same-origin authenticated connection routes and restrictive CSP. Existing mood/relationship navigation is preserved. No real browser screenshot/layout review was performed here.

## Test evidence

Combined command: `node --test tests/tasks-round1.test.mjs tests/runtime-coordination.test.mjs tests/batching.test.mjs tests/pipeline.test.mjs tests/pipeline-management.test.mjs tests/context-tools.test.mjs` — 33 passed, 1 failed. The failure was the runtime test's 30ms sleep/100ms window expectation under concurrent filesystem/test load (`assessments.length` already 1); no evidence of an early-deadline implementation violation. Independent rerun of latest `tests/runtime-coordination.test.mjs` — 4 passed, 0 failed, including root's new unaddressed-follow-up case. Prefer deadline assertions/injected clock or a less fragile timing margin for this test.

No full-suite claim, deployment claim, or actual model-usage-shape claim is made by this review.
