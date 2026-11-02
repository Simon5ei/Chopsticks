# Chopsticks / 筷子

User-authorized independent extraction and replacement of the server fish runtime. Read docs/design.md and docs/superpowers/plans/2026-11-02-initial-runtime.md before implementation.

- Preserve fish identity, credentials and historical sessions outside Git; no runtime data in this public repository.
- No dependency on installed SurfCore or SessionCross. Extract narrow reusable code with MIT attribution.
- New behavior requires failing regression tests before implementation. Integration must use real server DSH and model in isolation before cutover.
- Stable event IDs, confirmed outbound receipts, bounded contexts, no blind retry after ambiguous sends.
- Share group experiences; private/operator details stay separately scoped until explicitly authorized otherwise.
- Do not delete old deployment or history. Back up before overwrites. No synthetic outbound QQ/Bili messages during testing.
- User authorized push to Simon5ei/Chopsticks and full server cutover after verification; do not ask again.
- Keep changes in assigned files. No secrets in logs, commits, model contexts or test output.
