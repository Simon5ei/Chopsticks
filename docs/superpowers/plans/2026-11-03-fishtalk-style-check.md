# Fishtalk draft diagnostics implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session, with one fresh whole-branch review before deployment.

**Goal:** Install the administrator-approved fishtalk v0.3.6 rule-only adaptation as the optional QQ tool `chopsticks_style_check`.

**Architecture:** Copy only the unchanged MIT pure rule module at `bb621c3da31052e7e52b6307db3e27c508e4d502`. A small Node wrapper validates at most 2,000 Unicode code points, supplies no history/corpus and returns advisory diagnostics. Register it on the existing native DSH ToolRuntime, with QQ-only visibility and execution checks. Existing Router, send gates, receipts, model and history remain authoritative.

**Tech Stack:** Existing Node 24, native DSH 0.2.1-rc.2 tools, Node test runner; no runtime dependency added.

**Spec:** Administrator's quoted, detailed pending-candidate proposal and explicit instruction “这个装一下吧” in this chat. This approves that exact rule-only version, isolated real DeepSeek validation, and production rollout after verification.

## Global constraints

- Maximum 2,000 Unicode code points; reject empty/whitespace, non-string and oversized input before rules run.
- Only QQ executors; Router, Bili, research and development Workers cannot see or execute it.
- No filesystem/network/corpus access in the rule closure; no input-supplied history or destination.
- Return diagnostics, not authorization or proof of sending; do not intercept sending or append canonical events.
- Preserve upstream MIT and exact revision/hash; do not install full fishtalk or any unrelated pending MaiBot feature.
- Production backup and idle check before controlled restart; retain sessions/data and uncertain-send records.
- Use a fake QQ adapter for native DSH/real DeepSeek acceptance, with publishing disabled.

## Review focus

- Quotes and ordinary colloquial speech must not be marked as hard evidence.
- Unicode boundaries, malformed values and adversarial long strings must be bounded.
- Every non-QQ scope must fail closed even if a model guesses the tool name.
- Rule import/call must have no file writes, network access or canonical send/event effects.
- Restart must preserve the existing profile/history/model and must not activate pending MaiBot integrations.

## Task 1: Bounded native QQ diagnostics

Files: `style/vendor/fishrules.cjs`, `style/vendor/PROVENANCE.json`, `notices/fishtalk-MIT-LICENSE`, `host/style-check.mjs`, `host/index.mjs`, `host/guard.mjs`, `presets/runtime.patch.yml`, `tests/style-check.test.mjs`, `tests/guard-lifecycle.test.mjs`, `NOTICE.md`.

- [x] Add behavior tests and observe failure: missing tool, quotes, ordinary speech, hard and soft diagnostics, empty/oversized/Unicode, forged history and non-QQ calls. Prove the rule closure executes without filesystem/network capabilities.
- [x] Copy verified upstream rule bytes and license; implement bounded advisory wrapper, native registration, QQ guard and one optional-use prompt sentence.
- [x] Run regression suite, Linux suite, short-text p95/RSS checks, and isolated native DSH with real DeepSeek and fake QQ. Actual model tool result observed; direct diagnostics left canonical events and send records unchanged. Linux: 153/153. Short-text p95: 0.015531 ms; module-load/warmup RSS increment: 2.125 MiB.
- [x] Obtain a fresh independent review, resolve material findings with regression tests, then verify the final tree. Independent review reported no findings.
- [x] Back up code/profile/config/state privately, wait for idle, deploy only approved files, recompose the web profile and restart once. QQ healthy, model/config unchanged, nine native history prefixes and mappings/persona preserved. Test service stopped; no real platform test messages. Rollback instructions and private ledger/memory recorded.
