# MaiBot functionality in Chopsticks

This is an opt-in integration of two real, independently installed Python plugins and the reminder plugin's tool/intent contract. It does not start MaiBot or add another QQ connection.

## Available functionality

| Tools | Behavior |
| --- | --- |
| `mcp__maibot_date__query_date`, `mcp__maibot_date__query_holiday` | Run the original date plugin through MaiBot SDK 2.21.0. Gregorian/lunar dates, solar terms and holiday data retain upstream coverage limits. Both automatic prompt injection hooks stay disabled. |
| `mcp__maibot_wiki__moegirl_lookup` | Run the original Moegirl parser, search fallback, candidate selection and cache. HTTP is delegated to Chopsticks' existing DNS-pinned public fetcher with bounded response size. No login Cookie is sent. |
| `chopsticks_reminder_set`, `chopsticks_reminder_list`, `chopsticks_reminder_cancel` | QQ-only native adaptation of MaiBot Reminder. Persist in SQLite, survive restart, and emit a stable timer event to the original channel. Router decides the response; this service does not send messages. |

Date/wiki are available to the existing QQ, Bili and reading/development Worker scopes. Router receives no new tools. Reminder rows belong to the original channel and sender; another group member cannot inspect or cancel them. Setting a reminder requires a consumed canonical QQ message. `set` accepts only `{at, text}`: a future ISO-8601 time including timezone and seconds, and at most 1,000 characters. Up to 20 pending reminders per sender/channel are allowed.

Unknown tools, plugins and host capabilities are rejected. This is not a universal MaiBot converter: hooks, arbitrary database models, proactive APIs, platform gateways and WebUI components are not automatically transplanted. Python process separation is not an operating-system sandbox; only use inspected source directories with the intended service account.

## Prepare outside the source tree

Use a private Python environment and source checkouts. No runtime package installation or Git fetch happens when the host starts. Exact reviewed revisions are in `sources.json`.

```sh
python3 -m venv /var/lib/chopsticks/maibot-venv
/var/lib/chopsticks/maibot-venv/bin/python -m pip install -r /opt/chopsticks/maibot/requirements.txt
git clone https://github.com/xiexiaojia780/date_context_plugin.git /var/lib/chopsticks/plugins/date
git -C /var/lib/chopsticks/plugins/date checkout 72098e2919b7df9cc31d4431c87a09f63db8aba7
git clone https://github.com/YukiSakiko/moegirl_wiki_plugin.git /var/lib/chopsticks/plugins/wiki
git -C /var/lib/chopsticks/plugins/wiki checkout 24a7e870afb1900bae7f85a14f9b0af8e34b951b
```

These are administrator setup steps after approving the specific versions, not startup instructions for the model. A non-root service account and restricted file/network access remain deployment responsibilities.

Add explicit configuration to the external Chopsticks JSON file:

```json
{
  "maibot": {
    "enabled": true,
    "python": "/var/lib/chopsticks/maibot-venv/bin/python",
    "plugins": [
      { "kind": "date", "root": "/var/lib/chopsticks/plugins/date" },
      { "kind": "wiki", "root": "/var/lib/chopsticks/plugins/wiki" }
    ]
  },
  "reminders": { "enabled": true }
}
```

Each plugin accepts an optional `config` object containing partial non-secret plugin settings. Date injections are forced off. The integration doesn't forward the main host configuration or inherited credential environment variables to Python. Plugin-specific data lives under `<stateDir>/maibot/` outside Git. Errors omit candidate exception text and local paths.

Enabling an unreadable or incompatible plugin fails initialization clearly rather than advertising tools that do not work. Disabling `maibot.enabled` removes all three Python tool registrations. Disabling `reminders.enabled` removes reminder tools and polling while retaining rows for later inspection. If re-enabled, overdue pending reminders enter Router once using their original stable event IDs. Requests already accepted into the canonical journal remain journal facts.

To roll back an installed release, disable the new feature flags and restore the previous code/profile backup during a controlled restart. Do not erase events or replay uncertain platform sends. No provider, existing model selection, QQ identity, role memory or native session history is migrated by these features.

## Verification

```sh
CHOPSTICKS_MAIBOT_PYTHON=/path/to/venv/bin/python \
CHOPSTICKS_MAIBOT_SOURCES=/path/to/checkouts npm test
```

The source directory contains `xiexiaojia780--date_context_plugin` and `YukiSakiko--moegirl_wiki_plugin`. When those environment variables are omitted, real-plugin tests are explicitly skipped; transport, reminder and host-scope tests still run. On Windows, use a temporary directory writable by both Node and the selected Python executable.

Tests exercise the real date and wiki implementations with the installed SDK, mock only the wiki HTTP boundary, and cover cancellation, child failure, reminder restart/replay and private scope. They do not send real QQ/Bili messages.

Local verification on 2026-11-03: 169 tests passed, two Linux-only shell tests skipped on Windows. A separate read-only check returned a live Moegirl article. The official DSH 0.2.1-rc.2 ToolRuntime and MCP adapter accepted all three original schemas and executed date, holiday and wiki error-result calls. A full native agent run with the real DeepSeek model remains required in isolation before production cutover; these checks do not establish that acceptance.
