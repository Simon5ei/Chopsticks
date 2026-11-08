# TypeScript Runtime Implementation Plan

> Use superpowers:executing-plans; execute serially under the user's full authorization. Use a fresh final reviewer and failing regression tests for new behavior.

**Goal:** TypeScript source, clean maintained layout, behavior-preserving release on the existing Linux server.
**Architecture:** Compile owned source/tests into an isolated output tree and assemble a production release with unchanged runtime-relative paths.
**Tech Stack:** Node 24, TypeScript NodeNext, native node:test, SQLite, existing DSH.
**Spec:** ../specs/2026-11-09-typescript-runtime.md

## Global constraints

- Preserve external identity/config/state/history; no secret output or commits.
- One workload at a time; limits from the spec apply to every check.
- Preserve GPL-3.0-only and all upstream notices.
- No production switch until compiled suite and isolated real-model acceptance pass.

## Review focus

- Child processes, dynamic imports and URL-relative assets resolve in the assembled release.
- Browser classic scripts retain their execution model.
- Unknown sends remain durable and are never replayed by migration.
- Package and DSH bundle metadata refer only to files present in the release.
- Documentation links and recovery commands survive reorganization.

## Task 1: Establish baseline and build/release contract

- [x] Back up source outside Git, record baseline revision and run existing suite serially.
- [x] Add failing build-contract tests for TypeScript checking, executable exports, required assets, clean release inventory and no legacy owned JS source.
- [x] Add compiler settings, resource-conscious build/test/release commands and pinned tooling.

## Task 2: Migrate owned source and preserve behavior

- [x] Move owned runtime to src, convert Node modules/tests to .mts and browser scripts to .ts.
- [x] Preserve vendor and Python boundaries, imports, actual receipts, event IDs and DB formats.
- [x] Resolve compiler diagnostics with types and narrow fixes, without check suppression.
- [x] Build and run compiled tests; confirm CLI, MCP and browser asset tests.

## Task 3: Documentation and retired code cleanup

- [x] Inventory references before removing one-time legacy cutover logic or unused files.
- [x] Separate current operations from dated evidence; add docs index/development guide and validate links.
- [x] Record retained optional integrations and license exceptions.

## Task 4: Review and Linux deployment

- [x] Assemble release and independently review the complete change.
- [x] Run bounded Linux tests and isolated real DSH/model acceptance.
- [x] Back up code/profile, stop sole production owner, install release, recompose and start.
- [x] Verify current health/source identity and preserved config/session mappings without decompressing history.
- [x] Commit and push verified source; record release/rollback evidence.
