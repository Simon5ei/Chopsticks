# TypeScript runtime migration

The administrator authorizes migration, removal of retired source, documentation organization and deployment to the existing Linux server. Preserve all active behavior, identity, credentials, historical sessions, current platform holds and GPL/MIT/other upstream notices.

## Design

Use TypeScript ESM (`.mts`) for owned Node source and tests, and TypeScript (`.ts`) for browser scripts. Compile with TypeScript/NodeNext to `.mjs` and `.js`. The deployable release retains the existing root-relative entrypoints; private DSH profiles and MCP commands do not need a mass rewrite. Production never runs the compiler. Imported vendor code and the live upstream Python plugin runner retain their languages and notices.

Alternatives considered: Node type stripping alone would not build browser scripts or check types; changing all runtime entrypoints to `.ts` would unnecessarily alter deployed host/child contracts. A compiled release preserves these contracts. This implementation choice is made under the user's instruction to proceed autonomously.

Source lives in `src/`, tests in `tests/`, tooling in `scripts/`, generated output in ignored `dist/`. Production staging contains compiled modules, assets, presets, package metadata and notices. It excludes tests, development history, credentials and generated local logs. Existing deployment migration tools remain available only where still required for recovery; the one-time legacy cutover script is retired after backing up source.

Type checking must run without `@ts-nocheck`, `@ts-ignore` or `noCheck`. Explicit dynamic boundary types may be necessary for the existing DSH and platform protocols; this migration must not pretend those protocols have been fully modeled. Narrow critical stable contracts where possible without altering logic.

## Documentation and cleanup

Provide a current docs index, architecture/design, operations and development documentation; preserve dated deployment evidence in history. Keep required AGENTS design/initial-plan paths valid. Move module READMEs into indexed guides. Remove only files proven obsolete or generated; do not remove live optional adapters, upstream licenses, original deployment backups or private history.

## Verification and resource envelope

Run one diagnostic at a time. Local builds/tests: Windows Job Object, 1 GiB total committed memory, approximately one CPU core, 24 processes, 300-second maximum; tests use one worker and 30-second per-file deadlines. Source inspection: at most 600 tracked files, 4 MiB total, 128 KiB per file. Server diagnostics and acceptance use transient systemd units with MemoryMax, MemorySwapMax=0, CPUQuota, TasksMax, RuntimeMaxSec and KillMode=control-group. No unrestricted recursive production scans or native-history decompression.

Verify baseline, typecheck, compiled regression suite, browser assets, spawned CLI/MCP entrypoints and release inventory. Before cutover, run real server DSH/model acceptance with isolated state and transport. No synthetic outbound posts or private-message tests. Back up before replacement; stop the existing delivery owner before starting the new owner; preserve state unchanged. Verify readiness and receipt-safe recovery. Roll back code/profile on failure; never replay uncertain effects.
