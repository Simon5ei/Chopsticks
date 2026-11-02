# Source attribution

Chopsticks is a new composition, with selectively adapted MIT code:

- QQ protocol/media helpers, Bili command closure, webpage MCP and the prior task adapter originate from SurfCore, copyright (c) 2026 Derpyu520 and qq-bridge / QSH contributors. Original licenses are retained in `notices/`. The old bridge, host UI and installer are not runtime dependencies.
- `tasks/vendor/` is a minimal compiled closure of `deepseek-ai/dsh-superagent-prototype` core at revision `6337fc823ce20251c8de8085948165c81aaa701e`. Its license and original source hashes remain alongside the files. Type erasure and import extension transformations are documented in `PROVENANCE.json`.
- The new global Router, canonical event store, host integration, scope handling and migration code are part of Chopsticks.

Dependencies have their own licenses. Accounts, messages, credentials and role data are not distributed with this repository.
