# Source attribution

Copyright (c) 2026 Simon5ei and Chopsticks contributors.

Chopsticks-authored code is licensed under GPL-3.0-only as of 2026-11-03; see `LICENSE`. This aligns the project's main license with MaiBot's GPLv3 ecosystem. No MaiBot plugin implementation has been imported by this license change.

Code previously distributed under MIT retains its original grant, recorded in `notices/chopsticks-previous-MIT-LICENSE`. This historical notice does not make new GPL-only additions dual-licensed.

Chopsticks is a new composition, with selectively adapted third-party code whose original notices remain in force:

- QQ protocol/media helpers, Bili command closure, webpage MCP and the prior task adapter originate from SurfCore, copyright (c) 2026 Derpyu520 and qq-bridge / QSH contributors. Original licenses are retained in `notices/`. The old bridge, host UI and installer are not runtime dependencies.
- `tasks/vendor/` is a minimal compiled closure of `deepseek-ai/dsh-superagent-prototype` core at revision `6337fc823ce20251c8de8085948165c81aaa701e`. Its license and original source hashes remain alongside the files. Type erasure and import extension transformations are documented in `PROVENANCE.json`.
- The new global Router, canonical event store, host integration, scope handling and migration code are part of Chopsticks.
- `style/vendor/fishrules.cjs` is the unchanged pure rule module from `Nozzi2455/fishtalk` v0.3.6, commit `bb621c3da31052e7e52b6307db3e27c508e4d502`; only the extension is changed for CommonJS loading. Its original MIT license is retained in `notices/fishtalk-MIT-LICENSE`, with hashes in `style/vendor/PROVENANCE.json`. No corpus, store or full plugin bundle is included.

Dependencies have their own licenses. Accounts, messages, credentials and role data are not distributed with this repository.

Future MaiBot plugin adaptations must record their source revision, original license and attribution individually. GPL, LGPL, AGPL and other notices must not be replaced with the Chopsticks license; a plugin's compatibility and distribution requirements need review before integration.

Anime/illustration source parsers in `image-source/` are selectively adapted from user-supplied `coser-image-search` 1.0.0, copyright (c) 2026 小鲸鱼 (MIT), with the original license in `notices/image-source-MIT-LICENSE` and exact source hashes in `image-source/PROVENANCE.json`. Browser, identity/account inference, VPN and OneBot sending components are excluded.


Life platform adapters selectively reference WenfuRainbow/heybox v0.2.2 (commit afbe8a5f0629aafcd7e17d1c56eeec84ff4dd1bf, MIT) and kdcadmin/dsh_douyin_tools v0.2.9 (commit aaf9f9a862afafd45a15acf32789da97688de695, MIT). Their original notices are retained in notices/heybox-MIT-LICENSE and notices/douyin-MIT-LICENSE. Full upstream plugins, schedulers, personas, private data and ComfyUI integrations are not bundled.

QQ space uses the existing SnowLuma OneBot gateway API; no SnowLuma runtime is distributed. The diary, layered Router, platform queue, scoped tickets and private MCP bridge are Chopsticks-authored. qrcode and Playwright Core retain their own MIT and Apache-2.0 package licenses. The separately installed Linux desktop and keyboard tools retain their own licenses and are not relabeled by this package.

Life interaction additions (2026-11-05) selectively adapt protocol fields and receipt handling, rewritten for the Chopsticks scoped host:

- Heybox public interactions reference Sakura520222/xhh-workshop, commit `3f1ca9aee836691f134a2c744ff64fe6f3534ef6`, `crates/xhh-core/src/api/{post,comment,interaction}.rs`, GPL-3.0-only. Its original license is retained in `notices/heybox-workshop-GPL-3.0-LICENSE`.
- Heybox personal messages reference advent259141/astrbot_plugin_xiaoheihe_adapter, commit `534b9479e9bebe4ef82d9ec959d0c11146c90078`, `xhh_client.py`, Apache-2.0. Its original license is retained in `notices/heybox-dm-Apache-2.0-LICENSE`. These are modified, narrow Node adapters, not the original AstrBot plugin.
- Douyin message protobuf and interaction field semantics reference yunsur/douyin-mcp, commit `7e90d139007f141cb7389aa509d8e6e67f7b5840`, copyright (c) 2026 Yunsur, MIT; retained in `notices/douyin-actions-MIT-LICENSE`. Authentication and signing emulation are not imported. Normal logged-in web UI supplies platform requests; the adapter validates actual responses.

Upstream apps, device-token generators, private keys and credentials are not bundled. Platform webpages were inspected to verify normal current requests, not copied into the distribution.
