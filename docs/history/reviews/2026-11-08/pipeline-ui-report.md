# Pipeline management UI report — 2026-11-08

## Delivered

- Added exact authenticated DSH-connection GET routes `/api/chopsticks/pipeline`, `/api/chopsticks/pipeline.js`, `/api/chopsticks/pipeline.css`. Existing no-store, nosniff and same-origin CSP apply unchanged. No inline scripts/styles or remote resources.
- Added `pipeline` to the existing `/api/chopsticks-console` POST RPC allowlist. Queries only accept string correlation filters (`eventId`, `batchId`, `requestId`, `ticketId`, `channel`, optional `sessionId`) of at most 512 characters, integer limit 1–100 and positive safe-integer beforeSeq. Mutation/unknown keys and malformed filter values are rejected before calling runtime.
- Standalone page shows message → fixed 3-second window → Router → optional task → tools/receipts as reading guidance, explicitly noting actual configured batching and that stages need not all occur. Trace records use provider-recorded kinds/data, UTC timestamps, source links and expandable recorded details. It does not synthesize model reasoning or infer delivery success.
- Five exact filters are editable. Clicking an event/batch/request/task/channel ID clears other filters and requests the related chain. Older pages use nextBeforeSeq and sequence deduplication; 50 records per request and 500 visible record maximum. Paging pauses automatic refresh; explicit refresh returns to latest and resumes visible-page polling every 30 seconds.
- Metrics consume `metrics.modelResponses`, `usageKnownResponses`, `reportedTotalTokens`, `usageComplete`. Labels explicitly describe recorded completed native responses with stable IDs, not all calls. Missing token reports display unknown; partial usage is called incomplete. Metrics come from backend filtered totals and do not accumulate as pages load.
- Side panels consume `batches.counts` from router.status() and display latest `supervision` as recorded data with task links. These are explicitly current-instance status, independent of trace filters.
- Existing relation graph and mood pages remain and link to pipeline. The native console header links to all three pages; its Controller preserves batch/request/task filters.

## Safety and budgets

All dynamic strings use textContent/createElement; untrusted markup never enters innerHTML. Requests use same-origin credentials, validate RPC identity, have a 12-second AbortSignal timeout and stream-read at most 2 MiB. Existing display remains after failed reads. Hidden pages skip periodic refresh, and requests serialize. Text/detail rendering is clipped to finite display budgets without changing stored trace evidence.

Only assigned UI/router/console/test files and this report changed. No runtime, observability, index, server connection or platform send work was performed.

## Verification

TDD: the initial six management/pipeline tests failed against baseline for missing exact routes, absent pipeline RPC and missing browser assets; implementation made them pass. Fixed the test's inline-handler regex to require an attribute boundary (the original regex incorrectly matched the ordinary HTML content attribute).

Final bounded local target was these five named test files, one test-file process at a time, local fixture databases and VM DOM executions capped at 1000 ms each. No server workload was run.

`node --test --test-concurrency=1 tests/management.test.mjs tests/pipeline-management.test.mjs tests/mood-management.test.mjs tests/console.test.mjs tests/console-client.test.mjs`

Result: 29 passed, zero failures, exit 0, 1.79 seconds. Tests cover asset/CSP boundaries and retained navigation, read-only RPC validation, hostile text rendering, partial/unknown usage, source-ID navigation, cursor pagination, failure state retention, hidden refresh, oversized/mismatched replies, and native-console compatibility. UI behavior was verified in a VM DOM harness; a real-browser screenshot/layout review was not performed by this worker.

## Root integration

Runtime must return `queryConsole('pipeline',payload)` as `{items,nextBeforeSeq,metrics,retention,batches:router.status(),supervision}`. Existing host/pipeline-traces.mjs query already defines the first four fields. `items` contain raw trace objects (including `seq`, `kind`, `at`, `channel`, `eventId`, and `data` correlation fields). Route/connection authorization stays with DSH. The page supplies no arbitrary URL/resource/file reads or write actions.
