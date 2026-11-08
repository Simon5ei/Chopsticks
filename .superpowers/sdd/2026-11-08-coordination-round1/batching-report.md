# Batching implementation report — 2026-11-08

Owned files: `core/batching.mjs`, `core/router.mjs`, `tests/batching.test.mjs`.

## API

`createRouter({store,assess,dispatch,batchWindowMs=0,onBatch,urgent,...existingOptions})`.

- Root must explicitly pass `batchWindowMs:3000` for production. Zero preserves existing immediate/multiple-action compatibility behavior. Positive finite windows are floored/clamped to 1–60000 ms.
- `urgent(event) === true` is a trusted host predicate. `router.ingest(event,{urgent:true})` is an equivalent trusted override. Never derive administrator authority from pooled message text. An urgent event has its own deadline-now window and wakes scheduled work. It does not abort an already executing assessment or dispatch.
- `assess({events,batch,context,signal,...existingRouteAndMoodFields})`: `events` remain separate original-identity objects, with bounded text projections. `batch` is `{id,channel,openedAt,deadline,sourceEventIds,truncated,omittedEventCount}`. IDs preserve original sequence order. There is no synthetic concatenated source event.
- `dispatch(action,originalEvent,context)`: the event is loaded fresh from the canonical event store, preserving exact actor/text/metadata, irrespective of projected text. `context.batch` is `{id,channel,openedAt,deadline,sourceEventIds}`. Permission checks must use `originalEvent` alone.
- `onBatch({id,channel,openedAt,deadline,sourceEventIds,originals})` observes sealing. `originals` are all canonical source events, including actors and quoted-source metadata. Host should record IDs/count only in ordinary traces. Observer exceptions/rejections are isolated. The callback is best-effort, at-most-once per durable batch (flag written before callback), not an exactly-once external delivery mechanism.
- `policy.batchMaxEvents` defaults to 16, clamped to 1–32; `policy.batchMaxChars` defaults to 12000, clamped to 1–12000. These limit the assessment event projection, retaining the latest messages in chronological order. Text clipping sets `event.batchTextTruncated=true`; omitted messages set `batch.omittedEventCount`; either sets `batch.truncated=true`. Canonical journal data and onBatch originals remain intact. Full source-ID lists are audit metadata, not limited by this text projection budget.

## Persistence and dispatch

SQLite `core_batches` holds first-admission/deadline/sealed/observer state and `core_batch_members` binds each event once. `core_router.next_at` stores the durable deadline. Further arrivals never extend it. Restart restores open windows without replacing deadlines. Admission uses the persisted router arrival timestamp, including recovery of an event persisted just before admission. A batch is sealed synchronously before its first assessment; new arrivals while that assessment is running belong to another window.

Each window is assessed in one call, independently of the legacy Router row limit, and accepts at most one non-observe action (`respond`, `task`, `attach`, or `stop`). An initial observe action does not suppress a later actionable choice. Every unchosen or projection-omitted source gets its own durable observed decision. Existing assessment failure retry limits remain; a retry is possible only before side-effect intent. The existing decided/dispatching boundary remains: uncertain sends never replay, including after restart. Passive own-send evidence and policy-blocked events are persisted but never enter semantic windows. Separate channels never merge, including when hierarchy shares a native session.

## Verification

Followed TDD: initial four tests failed against the existing router (immediate assessments, no durable deadline/window grouping, urgent not bypassing, no projection bound). Subsequent regression tests separately exposed and then fixed observe swallowing the actionable choice and policy/passive events leaking into batch membership.

Final command:

`node --test --test-concurrency=1 tests/batching.test.mjs tests/core.test.mjs tests/router-hierarchy.test.mjs tests/mood-router.test.mjs`

Result: 33 passed, 0 failed (7 new batching tests + 26 compatibility tests), exit 0, 5.56 seconds. Coverage includes fixed timing/no deadline reset, duplicate, restart, independent channels, arrival during processing, urgency, clipping/original retention, actor authority, multiple model actions, per-source audit, and ambiguous dispatch restart. Existing Router hierarchy and mood transaction tests passed. Tests use local temporary SQLite fixtures and fake assess/dispatch callbacks; no server connections or platform sends were made. Local target was the four named test files and their fixture databases; one test-file process at a time, finite timer polling and default 10-second tool wait. No server diagnostic workload was run.

## Integration boundaries

Root owns runtime wiring, production 3000 ms setting, trusted administrator cancellation and source-scoped tool authorization. Batch context conveys evidence only. Root may use onBatch original records to index trace provenance; it must not pool authority or leak private text into shared traces. A currently running model turn remains serialized under existing timeout limits. Observation callbacks are not transactional external queues. The authoritative event journal retains clipped/omitted message text for bounded on-demand reads.
