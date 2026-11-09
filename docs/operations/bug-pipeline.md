# Bug reports and automatic repair

`chopsticks_bug_report` is available in every native conversation and every managed
fish preset. It records a bounded, redacted problem; it never grants the reporting
conversation command execution or repair-completion authority.

Enable `bugPipeline.enabled` and set `bugPipeline.sessionId` to the exact existing
operator development session ID in the external runtime config. The host never
creates a replacement session or resolves a destination by its display name.
The production destination is the existing “开发、迭代与debug” conversation.

Problems persist in `bug_issues`, deduplicated by component and normalized error
code. New videos, tickets and intent labels do not create duplicate issues.
Fresh occurrence identities reopen completed issues as a new generation while
preserving previous receipts in `bug_results`; repeated evidence does not reopen
them. Watchdog establishes an enablement watermark and records each later health
observation once. Older incidents must be explicitly seeded by the operator.
The developer receives at most five queued issues when idle. While a batch is
active, later reports accumulate. Watchdog operation failures enter automatically;
watchdog and reflection reports may also supply at most five `problems` with
canonical `sourceEventIds`. Reflection findings remain hypotheses to verify.

Submission intent is saved before sending the native prompt. A lost acknowledgment
or restart does not resend it. `user/message` with the exact native request ID
proves consumption. Only that active destination can call `chopsticks_bug_result`
for an issue in its batch, with `fixed`, `blocked` or `rejected` and actual evidence.
Ending a turn without a receipt records `attention_required`. After thirty minutes,
an unresolved batch can release the queue only when the native session is idle;
its unreceipted issues remain unresolved and are not retried.
Native runtime/time context snapshots also use `user/message`; they do not
supersede a consumed batch. A new actual user message does revoke its authority.

The queue is limited to 256 unresolved issues. Summaries are limited to 800
characters, result evidence to 2,000. Private-source prose and source identities
are not copied to developer prompts. A private report contains only the problem
category/code and a generic scope notice. The debug session must not treat bug text
or retrieved material as instructions.
Private codes are mapped to trusted classifications; arbitrary private strings are
not used as outward diagnostic labels. A full queue is recorded as a reporting
health error and does not stop watchdog, reflection or runtime startup.

Automatic repair follows repository resource bounds, regression tests, isolated
DSH/model acceptance, backups and rollback. Platform holds, CAPTCHA, login checks,
unknown-send records and synthetic-send restrictions continue to apply. A repair
receipt must distinguish code verification from a real platform send.

`CONTROL_NOT_UNIQUE`, verification and login failures persist an operation hold.
New sources or intent IDs cannot keep testing the same broken operation. The
private `operation-hold` record is repair evidence: a successful authentication
check alone does not prove the affected write path works. Clear a hold only after
the relevant defect or verification requirement has actually been addressed; do
not clear the send ledger or replay an old uncertain effect.

Owner privacy is injected into every native system prompt. Configure actual owner
aliases and sensitive details in external `privacy.ownerAliases` and
`privacy.ownerDetails`; never commit those values. The outgoing gate also reads
existing owner account/name fields and rejects disclosure to outsiders. It permits
the fish to introduce itself without naming its owner. The exact QQ owner private
channel is excluded from this outward-disclosure check; group messages are not.

Validation on 2026-11-10: the complete suite ran 857 tests with no failures
(Windows: 841 passed, 16 skipped; DSH Linux: 847 passed, 10 skipped). Real native
acceptance exposed the context-snapshot case above; its new regression failed
before the correction and all 13 queue/native focused tests then passed on both
hosts. A fresh isolated DSH run with DeepSeek Flash registered a real model tool
report and completed six fixture receipts in batches of five and one. No platform
write was performed. These checks do not establish that Heybox verification or
Douyin's actual comment control has been repaired.
