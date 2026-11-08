# QQ draft style diagnostics

`chopsticks_style_check({text})` offers optional, advisory diagnostics for one QQ draft of at most 2,000 Unicode code points. It flags upstream hard phrases and combinations of soft style signals. The tool returns no draft text, approval or sending receipt. A single soft signal does not set `flagged`; quotes and numbered lists follow the upstream exclusions.

Only the QQ executor can see or invoke the tool. Router, Bili and both Worker presets cannot use it. The wrapper also verifies the trusted caller role and channel. It does not read history, compare previous messages, build a corpus, add canonical events, call a model, write files or access the network. Normal native DSH tool tracing still follows the host's existing logging policy.

The vendor file is unchanged `lib/fishrules.js` from [Nozzi2455/fishtalk v0.3.6](https://github.com/Nozzi2455/fishtalk/tree/bb621c3da31052e7e52b6307db3e27c508e4d502), renamed to `.cjs` for CommonJS loading. Its commit and SHA-256 are recorded in `vendor/PROVENANCE.json`; the MIT notice is in `../notices/fishtalk-MIT-LICENSE`. No full plugin, corpus or store is installed.

Use diagnostics only when useful. Sending continues through existing fresh-context checks, deduplication and confirmed platform receipts. `flagged: false` does not establish factual correctness, originality or delivery. Cross-message repetition is not assessed because no history is supplied.

Rollback restores the prior code and profile backup and recomposes the web profile before restarting DSH. Keep databases and historical/uncertain send records intact. The checker creates no data migration or extra runtime dependency.

Verified on 2026-11-03 with Node 24 and DSH 0.2.1-rc.2: all 153 Linux tests passed; a real DeepSeek call in isolation returned diagnostics through the native tool. QQ visibility/execution succeeded and the four other presets were denied. No canonical event or send record was added by diagnostics. Short-text p95 was 0.015531 ms over 2,000 samples; RSS after import, 100 warmups and GC increased by 2.125 MiB. These are local server measurements, not a general latency guarantee.
