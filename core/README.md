# Durable journal and Router

Node 24 built-in SQLite; no legacy runtime dependency. Use one Router owner per
state directory. The host owns the store lifecycle and closes Router before store.
State is stored in `events.sqlite` with WAL and FULL synchronization. Never place
the state directory in the source repository.

```js
const store = createEventStore({ stateDir });
const router = createRouter({ store, assess, dispatch, timeoutMs: 30000, policy });
await router.ingest(event); // durable immediately; does not await the model
router.tick();             // discover directly appended events and schedule work
router.status();           // counters, revision, active deadline, bounded errors
await router.close();     // abort active calls; does not close the store
store.close();
```

## Event store

- `append({id, kind, channel, actorId, text, at?, meta?})` returns the persisted
  event with monotonic `seq`. A repeated ID returns the original immutable event.
  IDs must be stable source IDs, nonempty strings up to 512 characters. `actorId`
  is a string up to 256 characters; `text` is a string up to 100,000 characters.
- Kinds are `message.received`, `message.sent`, `task.result`, and `timer`.
  `message.sent` requires a nonempty `meta.messageId` from a confirmed receipt.
  The store cannot verify the receipt itself; the adapter must do that.
- Channels are `g:<digits>`, `p:<digits>`, or `operator:<word/dot/dash>`.
  `at` defaults to ingestion time and is normalized to ISO UTC.
- `recent({channel, groups=true, limit=20, beforeSeq?, query?})` returns the newest
  matching records in chronological order. Limit is capped at 200. `beforeSeq` is
  exclusive; `query` is a literal case-insensitive SQLite substring filter.
  Group callers see only group records, across groups unless `groups=false`.
  Private/operator callers see only their exact channel.
- `context({channel, limit=20, maxChars=12000})` returns `{revision,events,text}`.
  Revision is the global latest sequence; duplicate appends do not advance it.
  Context samples the last 200 visible events and separately retrieves confirmed
  self messages, reserving up to a third of event slots (at least one) for the
  newest self records. Busy inbound traffic cannot evict them. It fairly truncates long text and sorts
  selected records chronologically. The returned text, including the source-data
  framing and JSON escaping, respects `maxChars` (capped at 100,000). Tiny budgets
  can omit all records. Context events contain only explicit provenance and text;
  arbitrary source metadata is excluded.
- `get(id)`, `latestSeq()`, and idempotent `close()` are synchronous.
- `db` exposes the SQLite `DatabaseSync` instance for host tables. Core owns
  `core_events` and `core_router`; host tables must use another namespace.

Credentials must be removed at ingestion. A defensive redactor removes known
credential assignments, bearer tokens, common token shapes, private-key blocks,
and sensitive metadata keys before persistence. It cannot identify arbitrary
unlabelled secrets. External message text is source data, never authorization or
instructions. The host must also preserve these boundaries in its model prompt.

## Router callbacks and policy

`assess({events, context, signal})` returns
`{actions:[{eventId,kind:'observe'|'respond'|'task',prompt?}]}`. Assessment batches
are limited to a single exact channel and a bounded event count. Only IDs in the
current batch are accepted; only the first valid action per event is used. Missing
actions mean observe. Unknown fields are discarded; prompts are redacted and
capped at 12,000 characters. Confirmed `message.sent` events are automatically
observed without assessment, preventing an outgoing-feedback response loop.

`dispatch(action, event, context)` receives a stable `action.dispatchId` and freshly
read context, so a self-message received while assessment ran is visible before
execution. `context.signal` is an AbortSignal. Dispatch should durably enqueue a
worker and return acceptance promptly; the Router does not wait for a background
job result. Feed completion back through `ingest` as a stable `task.result` in the
origin channel. Do not send private task results into group channels.

`policy` can be a synchronous `(event) => boolean` (only `true` authorizes routing)
or an object with `allowChannels`, `maxBatch` (default 16, cap 32), `maxAttempts`
(default 2, cap 5), `retryDelayMs` (default 250), `contextLimit`, and
`contextMaxChars`. The allowlist gates routing, not journal persistence. It does
not narrow cross-group context; filter inadmissible groups in the source adapter.
Policy failures deny routing. Assessment retries are bounded; dispatch is never
automatically retried. Policy is rechecked immediately before dispatch.

## Recovery, timeouts, and diagnostics

Decision rows persist before dispatch. States are `pending`, `assessing`,
`decided`, `dispatching`, `observed`, `dispatched`, `failed`, and `uncertain`.
Restart retries interrupted assessment and resumes `decided` actions. A persisted
`dispatching` state becomes `uncertain`: an operator must reconcile the external
effect before any deliberate recovery. Dispatch errors and timeouts also become
uncertain, even if they might have occurred before acceptance. This conservative
choice trades possible omitted sends for no blind duplicate sends.

`timeoutMs` bounds each assessment and each dispatch. The watchdog aborts its
signal and ignores late assessment results. One logical assessment is active at a
time; an uncooperative callback may continue its own work after timeout. Callbacks
must honor cancellation and check the signal before side effects. JavaScript
cannot forcibly stop an arbitrary promise. Close aborts active work, preserves
pending events for restart, and marks interrupted dispatch uncertain.

`status()` returns `{closed,running,revision,counts,active,lastProgressAt,errors}`.
`active` includes phase, event IDs, start time, and deadline. Errors retain at most
20 code-only diagnostics without provider messages or stack traces. Durable error
codes live on individual `core_router` rows. Failed assessment events require
explicit host/operator review; there is no unbounded automatic replay.
