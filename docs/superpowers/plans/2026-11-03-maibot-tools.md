# MaiBot tool integration implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. The user explicitly requested reading checked-out plugin implementations and proceeding with functional integration.

**Goal:** Run the real date and Moegirl plugins behind scoped DSH tools, and adapt the reminder plugin's intent contract to durable Chopsticks events.

**Architecture:** An opt-in Python child loads only explicitly configured SDK plugins and exposes allowlisted tools over bounded JSONL. The trusted Node host owns channel identity, reminder persistence, Router ingestion and confirmed sending. The complete MaiBot host is not started. Unsupported hooks and capabilities fail explicitly.

**Tech Stack:** Node 24, Python 3.10+, separately installed pinned MaiBot SDK and plugin dependencies, SQLite, DSH native tools.

**Spec:** User's current request: check out and read real plugin code, then integrate functionality; conversion tooling is a future extension. Do not spend additional effort on licensing or change production.

## Global constraints

- Opt-in configuration; existing default runtime and tool scopes remain valid.
- No candidate runtime configs, credentials, persona or chat data in Git.
- Source channels derive from trusted canonical events, never tool arguments.
- No synthetic QQ/Bili sends, no production installation or restart.
- Date and wiki are read-only; only QQ may schedule/cancel reminders.
- Reminder delivery creates a durable timer event, never a platform receipt or direct message.

## Review focus

- Cross-channel/private reminder cancellation and forged stream identifiers must fail.
- Restart between timer ingestion and state acknowledgement must not duplicate the event.
- A noisy, crashed or stalled Python child must not corrupt protocol or hang shutdown.
- Unknown components/capabilities and unconfigured plugins must never become visible tools.
- Disabled configurations and research Workers must not gain reminder or machine permissions.

## Tasks

### Task 1: Real SDK child transport

Files: `maibot/bridge.mjs`, `maibot/runner.py`, `maibot/policy.mjs`, `tests/maibot.test.mjs`.

- [x] Write and run failing tests for missing/unknown configuration, real date plugin discovery/calls, protocol errors and close/cancel behavior.
- [x] Implement explicit plugin ID/tool allowlists, schema projection, bounded transport and private data paths. Consume externally configured plugin roots; do not install dependencies at runtime.
- [x] Verify actual date/holiday results with the checked-out source and installed SDK; wiki service code executes through the same child, with external network mocked only in fixture tests.

### Task 2: Durable reminder contract

Files: `host/reminders.mjs`, `tests/reminders.test.mjs`.

- [x] Write and observe failing tests for schedule/list/cancel scoped to original source actor/channel, idempotent tool calls, invalid dates, limits, restart and overdue events.
- [x] Implement SQLite reminder rows and stable `timer` event IDs. Atomically acknowledge accepted events; retries may re-ingest the same ID but must not cause duplicate dispatch.
- [x] Verify cancellation, concurrent tick/close and failures without any QQ transport.

### Task 3: Host integration

Files: `host/index.mjs`, `host/runtime.mjs`, `host/guard.mjs`, `tests/runtime.test.mjs`, `tests/guard.test.mjs`.

- [x] Write and observe failures for enabled tools, caller-derived scope, real timer-to-Router dispatch, disabled default and Worker restrictions.
- [x] Register native read tool wrappers and QQ-only reminder tools; start/close resources with the host and report failures clearly.
- [x] Run focused and complete Node test suites plus real Python plugin integration checks.

### Task 4: Usable setup and final review

Files: `maibot/README.md`, `maibot/sources.json`, `config.example.json`, root `README.md`.

- [x] Document pinned source revisions, local dependency setup, exact opt-in config, tools, known limits and rollback by disabling the feature.
- [x] Run available isolated DSH native API validation without modifying production. Official 0.2.1-rc.2 packages register the original schemas and call the real date/holiday tools and wiki error path.
- [x] Obtain a fresh independent review and reproduce/fix all four Important findings with regression tests. Final full suite: 169 passed, two Linux-only skips, zero failures.
- [ ] Before production cutover, run full real-server DSH/DeepSeek agent acceptance in isolation. Local API checks do not replace it; no production activation is included here.
- [x] Deliver implemented functionality and explicit remaining plugin gaps. No claim that all 45 plugins have been migrated.
