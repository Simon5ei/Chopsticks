# TypeScript development

Use Node 24 and the pinned TypeScript compiler in the lockfile. Owned runtime source is in `src/`; Node ESM uses `.mts`, browser scripts use `.ts`. Tests in `tests/` exercise compiled modules. `scripts/` contains the build and test entrypoints. Generated `dist/` is ignored by Git.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run release
```

`npm test` builds first and runs one test file at a time, with a 30-second per-file timeout and a four-minute suite timeout. The compiler has a 640 MiB V8 heap limit and a three-minute deadline. When running diagnostics, also use an OS process-tree limit: these runtime settings alone do not bound child-process memory or CPU. Server acceptance must use a transient systemd unit; see [deployment](operations/deployment.md).

The compiler checks all owned runtime source and tests; errors prevent emission. This is a behavior-preserving migration of a dynamic runtime, not a claim of complete strict typing: `strict` is currently false, and explicit `any` remains at DSH, platform JSON and test-double boundaries. Do not add `@ts-nocheck`, `@ts-ignore` or `noCheck`. Tighten these boundaries with named contracts when changing their behavior.

`dist/src/` and `dist/tests/` are local execution outputs. `dist/release/` is the production payload: executable `.mjs`/`.js`, adjacent HTML/CSS/Python assets, vendor code, presets, notices and dependency metadata. It retains deployed paths such as `host/index.mjs`, `life/mcp.mjs` and `web/server.mjs`. Production does not compile TypeScript or load source tests. Package exports in the release are rewritten to these paths.

Browser source is checked as separate modules, then its empty TypeScript module marker is removed. Actual imports/exports are rejected, preserving the classic-script contract of DSH and the management pages. Tests execute those emitted assets.

Upstream JavaScript in `src/**/vendor/` keeps its original language and license; the active MaiBot Python runner remains Python. Those are intentional interoperability boundaries, not abandoned duplicate implementations. The old initial SurfCore import/cutover executables are retired; their original code remains in Git and the pre-migration external backup. Recovery tools for session-header adoption and additive memory import remain in `src/deployment/`.

Keep credentials, native histories, SQLite and runtime state outside this public repository. Never clean deployment backups or replay uncertain sends as part of a build.
