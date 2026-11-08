# Explicit live pong regression

`npm test` uses isolated temporary ledgers and local callbacks. It cannot publish
these regression posts. The live runner is an operator-only action on the existing
platform owner; it does not start another browser or platform service.

The operator CLI accepts only `qzone`, `douyin`, `heybox`, or `bilibili` and a
64-character lowercase SHA-256 source revision. The deployed owner reads
`stateDir/life/source-revision.json`, generated from the frozen source with
`buildLiveSourceManifest()` exported by `life/live-platforms.mjs`. Its JSON shape is
`{version:1,revision,files:[{path,sha256}]}`. The revision hashes sorted
`path + NUL + sha256 + newline` rows. The fixed inventory covers runtime source
directories, scripts, presets and package manifests; callers cannot choose it.
Prepare and execute verify every actual source file, and execute checks again
immediately before publishing. Missing, changed, added or omitted runtime files
refuse execution. Freeze the manifest only after final review; do not change it
to retry an unknown send. With `CHOPSTICKS_CONFIG` pointing to the private runtime
configuration:

```sh
node life/live-test-cli.mjs qzone --revision "$REVISION"
node life/live-test-cli.mjs qzone --revision "$REVISION" --execute
node life/live-test-cli.mjs qzone --revision "$REVISION" --verify
```

For a Douyin publisher control failure, an operator can inspect the existing
browser owner with `node life/operator.mjs diagnostics douyin publish_controls`.
This serially opens the fixed official image-upload page and returns only bounded
control counts, visibility, input type and accepted file types. It does not upload,
fill, click or submit, and refuses when no browser owner is already running.

The first command prepares without publishing. Execute requires that successful
preparation. Verify reads back an existing attempt and never publishes. The same
commands apply to the other three platforms. There are no caller-supplied text,
recipient, path, media, or executor options. Every post contains exactly `pong`;
Qzone targets the owner's friends feed and the others the owner's public feed.
Douyin additionally receives a deterministic PNG containing only `pong`.

The existing singleton owner wires `createLivePlatformTests` directly. Its private
ledger root is `stateDir/life/live-test`; copy its bounded reports to the private
task artifact directory for review. It uses the existing Qzone, Heybox and Douyin
adapters, and the Bili service's explicit operator dry/go methods. Bili dry
preflight does not mark publishing as verified. Douyin's fixed PNG is staged in
the configured desktop account's `userStateDir/media`, with that user's ownership
and mode 0600, so its existing worker can read it without opening private ledgers.
Call `runner.run({platform,revision,mode},{operator:true})` only from the authenticated
operator bridge context. A request field cannot authorize itself.

Each platform adapter implements:

- `prepare(input)`: read-only readiness and own-account checks; returns
  `{ready:true,accountId}` only when the exact operation is available.
- `publish(input)`: one fixed external write, returning an actual accepted
  `{id,accountId}`. An explicit `confirmed:false` never counts as a receipt.
- `verify(input)`: actual platform readback, returning
  `{verified:true,id,accountId,text:'pong',target}`. It must check actual object
  contents, account ownership and visibility, not echo the requested intent.

Inputs include fixed `platform`, `revision`, `text`, `target`, `imagePath`, and
for publishing/readback `accountId` and `intent`. Readback also receives `receipt`
when available. The intent contains a unique `intentId` and a start timestamp.

The private per-platform ledger fsyncs an exclusive active reservation and intent
before publishing, and commits the accepted receipt before readback. Repeating an
attempted revision returns `already_recorded`. Any unfinished reservation blocks
new revisions with `blocked_unknown`. A crash, network exception, wrong account,
or failed readback never triggers another publish. Do not delete ledger files to
retry an ambiguous attempt.

Future Douyin refusals at the three explicit upload/editor/publish-button control
checks can be recorded as `not_sent` only with `submitted:false` and no accepted
ID. The runner durably preserves intent and resolution before releasing the
active reservation; the attempted revision remains non-repeatable. Existing
unknown records are never reclassified or unlocked automatically.

Readback without a known receipt ID additionally requires
`{intentId:intent.intentId,correlated:true}` backed by unique trusted platform
request evidence. Matching old `pong` text or a rough timestamp is insufficient.
When a platform cannot provide that evidence, the outcome stays unknown. A
reservation-only crash also stays unknown; no external attempt is replayed.

An adapter may preserve an accepted server ID when its own first readback fails.
The runner stores this in `candidate.json` without treating it as confirmed.
`--verify` then reads that exact ID and must prove account, text and visibility;
it never discovers a post by searching for an older `pong`.
Qzone's generic friends-feed scope is not proof of a post's privacy setting. Its
deployed gateway strips author and privacy from ordinary detail responses, so
live verification uses a separate fixed, authenticated raw detail GET with
`need_right=1`. Gateway cookies stay inside the server adapter. The actual
response must match author, post ID and exact `pong`, and explicitly return
`ugc_right=4`. Missing proof stays pending. A successful private ledger records
`visibilityEvidence: "qzone_raw_ugc_right_4"`; no cookies or raw body are saved.

`result.json`, `receipt.json`, and `verified.json` retain bounded private evidence
without arbitrary adapter errors or credential fields. Linux files/directories
use owner-only permissions and directory fsync. Windows uses file fsync; protect
the configured private root with its existing account ACL.
