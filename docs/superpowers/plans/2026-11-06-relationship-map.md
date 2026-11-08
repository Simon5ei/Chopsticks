# Relationship management view

User asked to implement after prompt/session cleanup. Scope: QQ group/private chat; content-platform direct messages only. Exclude comments, public feeds and QQ-space activity. Keep one undirected graph updated after each social report.

- [x] Test and implement source admission at social summarization and graph projection boundaries.
- [x] Persist an idempotent, platform-namespaced graph with sourced relationship annotations; backfill bounded existing social reports.
- [x] Add authenticated `/api/chopsticks` management page and link from existing DSH settings. Canvas graph: automatic layout, node drag, pan/zoom, fit, search, platform and certainty filters, evidence details, responsive resizable canvas.
- [x] Run behavioral and browser tests, inspect a large graph, review changes, deploy exact changed files with backup, verify authentication and production data.

Keep existing auth, source validation, other evolution scopes and runtime sessions. No extra management features. Graph bounds: 2,000 nodes, 6,000 edges; 200 reports per backfill batch with a durable cursor; 4 MiB graph cap and a visible truncation indicator. No external CDN or graph service.
