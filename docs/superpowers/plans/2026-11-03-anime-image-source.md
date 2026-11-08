# Anime image-source integration

> **For agentic workers:** Use TDD, isolated implementation and independent final review. User approved anime-only engines on 2026-11-03; implement and install in this chat.

**Goal:** QQ users can explicitly request the source of an illustration or anime screenshot.

**Architecture:** Native `chopsticks_anime_source(messageId, engine?)` resolves an actual received image in the current QQ channel through the existing adapter. A bounded client uploads to fixed SauceNAO, trace.moe and IQDB endpoints, returns artwork/anime candidates and explicit failures. Normal `chopsticks_send` remains responsible for confirmed delivery. No browser, raw upstream core import, account inference, public hosting, arbitrary URLs/paths, new process, GPU or new package.

**Source:** User-supplied coser-image-search 1.0.0, MIT. Extract only three deterministic source parsers with original attribution and content hashes; do not copy personal-account inference or browser code.

## Tasks

- [x] Implement `image-source/client.mjs` and parser closure, with tests first. `searchAnimeImage(bytes,mimeType,{engines?,signal?})` accepts supported bounded image bytes; engines default to all three fixed anime engines. Bound response body, reject upload redirects, apply end-to-end deadline and cancellation, report each failure independently, filter links to artwork/anime paths. SauceNAO indexes are restricted to illustration/anime, never cosplay/photo/social indexes.
- [x] Implement QQ-only host service and `chopsticks_anime_source` native registration/guard/prompt with failing scope, explicit-request, current-message/reference, concurrent, timeout, result and no-send tests. Image arguments never accept URL/path/base64. Only current canonical source event's own image or explicit reply target may be uploaded, with an explicit image-source request. Limit one concurrent search, no unbounded queue; source-channel result recording only. Preserve independent Router/Workers and fresh-context sends.
- [x] Run full local and Linux suites, independent branch review, real native DSH/DeepSeek isolated acceptance with fake QQ. Use only public anime/test fixtures for real external engine checks; no private images. Back up code/profile/config/state/native histories, verify idle and unchanged production bases, deploy only approved changed files, compose once and verify health/history/config. Provide bounded rollback and private installation evidence; preserve all unrelated pending MaiBot changes.

## Later addition: Google Lens

On 2026-11-03 the administrator asked to add Google Lens to the same lookup. `image-source/lens.mjs` now runs a singleton headless Chrome/Chromium over CDP, uploads the selected image to the fixed `lens.google.com/v3/upload` page, resolves result cards and returns bounded HTTPS candidates. On 2026-11-04 the administrator explicitly opened account candidates; `image-source/accounts.mjs` is a direct port of the upstream `extractAccounts`, `dominantPersonName`, `socialNameFromTitle`, `profileTitleName`, `accountNameOf` and `formatReply` functions, preserving the Twitter/Weibo/Bilibili/Instagram/Pixiv URL rules, strict name consensus and original reply layout. Face recognition and handle guessing remain excluded. The browser is a new host process, started lazily and stopped after two idle minutes or at host shutdown. Configure it with `imageSource.lens` (`enabled`, `browser`, `proxy`, `doh`, `profileDir`). Google's egress can require a captcha; set a working proxy in that section when direct Google search returns `GOOGLE_CAPTCHA`.

## Review focus

- Wrong-channel IDs, private records, ambiguous quoted source, and unrelated historical images are refused before upload.
- Upstream login/challenge/rate limits and malformed/overlarge replies are failures, never a false match.
- Cancellation releases concurrency; one engine failing does not hide other engines' useful results.
- External links cannot invoke local networking or social-account lookups and are never fetched automatically.
- Native guards deny Router/Bili/background/development workers even when the tool name is guessed.
