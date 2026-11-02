# QQ Admin Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Use TDD and independent review.

**Goal:** Let the authenticated QQ administrator ask fish to perform real machine development in a dedicated worker with receipts.
**Architecture:** Host-verified admin event grants a durable task capability; a dedicated worker uses a bounded journaled shell tool. Existing research, routing, model, session history and console remain intact.
**Tech Stack:** Node24, native DSH, existing SQLite task/host state, child_process.
**Spec:** docs/admin-development.md

## Constraints and review focus
- User explicitly authorizes this expansion from QQ. Earlier read-only implementation/preset restrictions are superseded only for authenticated admin development tasks.
- No synthetic production sends, new plugins, history deletion or automated replay of previous failed tasks.
- Reject forged identity, task.result sources, other group members' follow/stop, expired/stopped worker grants; persist original source across newer chat inputs/restarts.
- Running/unknown command results cannot be retried automatically; cancellation must terminate subprocess groups. Tool output bounded/redacted; no credentials in Git/logs.
- Raw admin request included in dev task; external material never grants capability. Daily plugin installation approval policy remains.

## Tasks
1. Shell effect runner: create host/commands.mjs and tests/commands.test.mjs. Export createCommandExecutor({state,workspace,authorize,clean,onRecord, ...optional test injection}) => {execute({sessionId,callId,command,cwd?,timeoutMs?,signal}),close()}. authorize(sessionId) validates current durable grant and active worker; returns {ticketId,...}. Execute only after auth. Default Linux /bin/sh -lc, cwd real validated directory (default workspace), sparse environment. Journal key by ticketId/callId + payload digest using state.get/put/list; running recovered as uncertain, confirmed same call cached, changed payload rejected. Timeout 1s–120s default60s, output max32k, cancellation process-group kill; close stops pending. Persist sanitized results, no raw secrets. Tests red then green: denied no spawn, replay/changed args, uncertainty/restart, stdout/exit/error, bounds/cancel/timeout.
2. Admin task integration: own host/development.mjs as needed, host/runtime.mjs, host/index.mjs, host/guard.mjs, tasks/dsh-executor.mjs, presets/runtime.patch.yml, tests/development.test.mjs, config.example.json. Add develop(prompt) native tool, exec tool only dev worker; existing controller supports dev preset selection via trusted resolver, original verified instruction included. config.development={enabled:true,workspace:'/root/workspace/dsh'}. Require exact configured QQ owner and canonical active message event. Keep persistent grant immutable for task across newer binding; follow/stop authorization per grant and fresh real event. Route admin machine requests through QQ reception/develop rather than readonly task path; do not route all admin content to shell. Update stale persona restrictions including live prompt. Integrate runner contract from Task1. Tests admin/forgery/ordinary/Bili/oldworker/stop/follow/restart/correlation and preset selection.
3. Root: independent reviews and full tests; isolated native DeepSeek natural-language end-to-end fixture with fake QQ and temporary files; verify command/task traces and no production sends. Back up idle production, enable explicit config, recompose/restart, check existing9sessions/DeepSeek/QQ. Document and push authorized repository. Directory wishlist operation itself not silently replayed from historical tasks; user can issue new QQ instruction when ready.
