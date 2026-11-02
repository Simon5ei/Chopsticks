# Chopsticks Initial Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Use TDD and independent review.

**Goal:** Ship an independent event-driven fish runtime, demonstrate cross-group awareness, push public source, deploy server with preserved memories and rollback.
**Architecture:** Persist source events before routing. One semantic Router assigns existing per-channel DSH workers or background tasks, with shared bounded context and confirmed-send feedback. SessionCross not required.
**Tech Stack:** Node 24, SQLite, DSH 0.2.1-rc.2 native host tools, stdio MCP, SnowLuma HTTP/WebSocket.
**Spec:** docs/design.md

## Global Constraints
- No credentials or private content in Git. Keep MIT upstream attribution.
- No production sends for synthetic tests. One active production delivery owner.
- Source reference E:/ai-daily-use/chopsticks-reference is read-only; runtime must not import it.
- Preserve active fish identity, 8 QQ mappings and old histories; new data external.

## Review Focus
- A confirmed self-message arrives while another channel is preparing a reply.
- Duplicate network events or ambiguous outbound acknowledgement do not double send.
- Private source cannot leak via global context or task reports.
- Worker and model timeouts do not block other groups forever.
- Existing live sessions contain obsolete tool messages; new preset must recover without resetting history.

## Tasks
- [x] 1. core/events.mjs and core/router.mjs + tests/core.test.mjs: SQLite canonical event journal, shared bounded recall, deduplication, durable dispatch decisions, context revisions, retries/cancellation/watchdog. API contracts agreed with root before wiring.
- [x] 2. adapters/qq.mjs + tests/qq.test.mjs: narrow extracted converters/guards, SnowLuma inbound normalization and confirmed sends, no legacy bridge monolith. Exact APIs based on deployed config.
- [x] 3. bili/ + tests/bili.test.mjs: extract used MCP command closure and only essential scheduler/guard pieces; explicit external data paths; no SurfCore install dependency.
- [x] 4. host/ + presets/ + tests/host.test.mjs: DSH native integration, persistent Router model session, event decisions, per-channel worker restore, task tools, fresh contexts, scoped operations, isolated validation profile.
- [x] 5. deployment/ + docs: inventory/provenance, credential-free public source, test suite, real MiniMax acceptance and source review; backup, stop old, cutover, validate, push repository and document rollback.

Each implementation task: write and observe failing tests, implement, test, inspect diff; review integrations before cutover.
