# 筷子 v0.1 design

Approved direction: independent continuously online fish; global Router + isolated workers + persisted shared experiences + watchdog. SessionCross is optional future cross-machine infrastructure, not a runtime dependency. QQ group experiences and confirmed self messages are globally known across groups. Do not expand private/operator disclosure by inference.

Sources normalize QQ inbound, successful outgoing receipts, Bili observations, task results and timer ticks to durable events. Program gates deduplicate and apply source/allowlist/rate constraints; model assessor decides observe/respond/task for actionable events. Router is one logical decision owner, not a forever-growing transcript. Context comes from canonical event journal and task references, with recent confirmed self messages given priority. Worker contexts remain separate but draw on shared group experience. New inbound interrupts neither the global service nor unrelated workers.

Runtime is a DSH bundle at /opt/chopsticks. Host owns persisted event store, serialized semantic routing, scoped tools, MCP child and work sessions. QQ transport connects to existing authenticated SnowLuma gateway; it does not distribute that runtime. Existing fish QQ session IDs and role memory are adopted, with a new narrow preset definition replacing unsupported old tool guidance. Root project is not a renamed copy of SurfCore.

Keep: QQ group/private handling, configured allowlist/admin identity, anti-spam/fish guard, text/images/forwarding where adapters support them, role/persona and existing full memories, Bili read/search/subtitles/frames and guarded publishing, durable delegated tasks. Drop: desktop pets, voice, old web console/update machinery, unused platform extensions. A compact health/task view and documented config replace the broad old console.

Evaluation must cover real model seeing confirmed message from group A when drafting in group B; duplicate inputs, send uncertainty, cancellation, restart, busy worker and fresh context refresh. No synthetic public messages. Stop old production owner before enabling new owner. Rollback restores old profile/env; additive state remains for audit.

Runtime inputs and credentials live outside repository. Imported memory retains provenance and counts. No unrelated local knowledge import. Development execution is restricted to authenticated administrator-origin work; background content work has read tools. Autonomous behavior requires a configured standing rule, not a retrieved text instruction.
