# things-mcp-server

A local MCP server that exposes [Things 3](https://culturedcode.com/things/) as agent tools. Designed for personal use by a security-focused folks: token in Keychain, audit log of every call, capture vs. reorganize split as a policy primitive.

**Status:** v0.1.0 — alpha, single user, build-from-source.

## Architecture

### Today

```
Cowork / Claude Desktop
     │ stdio
     ▼
things-mcp-server (Node, this repo)
     ├── capture tools    → things:///add, add-project, json (create)        (no token)
     ├── reorganize tools → things:///update, update-project, json (update)  (token from Keychain)
     ├── read tools       → osascript against Things3                        (no token)
     └── audit log         SQLite at ~/Library/Application Support/things-mcp/audit.db
                          (plaintext schema; args/error AES-256-GCM encrypted)
```

Three trust tiers:

- **Capture** is wide open. Worst case of a runaway agent: noise in Inbox.
- **Reorganize** loads the Things URL auth-token from macOS Keychain on first use. Audit-logged.
- **Read** uses Apple's published AppleScript dictionary. macOS Automation permission prompts on first use.

### Future (the larger Pepper Potts system)

This MCP is one of three planned surfaces. The full system places a **broker** between Claude and the per-surface MCPs, with policy + content-gate + cross-MCP taint propagation. Bodies of E2E-encrypted content (email, calendar events) never reach Claude — they route to a local model. Claude only sees metadata: sender, subject, timestamps, IDs.

```
       ┌────────────────────────────────────────────────────────────┐
       │  Claude  (Cowork desktop · Claude Desktop · Claude iOS)    │
       └────────────────────────────┬───────────────────────────────┘
                                    │
                          today: stdio (local)
                          future: HTTPS via Tailscale → broker
                                    │
                                    ▼
       ┌────────────────────────────────────────────────────────────┐
       │  broker  (FUTURE — not in this repo)                       │
       │                                                            │
       │   • per-tool policy (allow / prompt / deny / dry-run)      │
       │   • cross-MCP taint propagation                            │
       │     (email body marks downstream tool calls untrusted)     │
       │   • content gate                                           │
       │     metadata → Claude (cloud) │ bodies → local model only  │
       │   • encrypted audit log (one row per tool call, end-to-end)│
       └─┬─────────────────┬──────────────────┬─────────────────────┘
         │                 │                  │
   ┌─────▼─────────┐  ┌────▼──────────┐  ┌────▼──────────┐
   │ things-mcp    │  │ proton-mail-  │  │ proton-cal-   │
   │ (THIS REPO)   │  │ mcp (FUTURE)  │  │ mcp (FUTURE)  │
   │               │  │               │  │               │
   │ URL scheme +  │  │ IMAP + SMTP   │  │ CalDAV        │
   │ AppleScript   │  │ on 127.0.0.1  │  │ (Proton)      │
   └─────┬─────────┘  └──────┬────────┘  └──────┬────────┘
         │                   │                  │
   ┌─────▼─────────┐   ┌─────▼─────────┐  ┌─────▼─────────┐
   │  Things 3     │   │ Proton Bridge │  │ Proton CalDAV │
   │ (Mac local;   │   │ (local; E2E   │  │  endpoint     │
   │  Things Cloud │   │  decrypts in  │  │               │
   │  syncs to iOS │   │  memory)      │  │               │
   │  + Mac + Watch│   └──────┬────────┘  └──────┬────────┘
   │  + Vision Pro)│          │                  │
   └───────────────┘   ┌──────▼──────────────────▼──────────┐
                       │   Proton servers (E2E encrypted)   │
                       └────────────────────────────────────┘

                       ┌──────────────────────────────────────┐
                       │  local model  (Ollama or similar)    │
                       │  Llama 3.3 70B / Qwen 2.5 72B / etc. │
                       │                                      │
                       │  Receives email/calendar BODIES via  │
                       │  the broker's content gate. Bodies   │
                       │  never leave your Mac.               │
                       └──────────────────────────────────────┘
```

What each addition unlocks:

- **proton-mail-mcp** — Pepper can triage your Inbox, surface what needs action, draft replies for your approval. Bodies stay local (routed to the local model); metadata (sender / subject / when) flows to Claude for reasoning.
- **proton-cal-mcp** — completes the morning brief. "You've got 2 calendar blocks and 90 minutes of focus time after the 10am" becomes possible.
- **broker** — the policy layer that makes the multi-MCP setup actually trustworthy. Without it, a compromised MCP has full agent privileges; with it, blast radius is bounded per tool and per provenance.
- **Tailscale-exposed MCP** — Claude iOS gets full Pepper parity. Today the agent layer is Mac-bound; with this it follows you to mobile.

### Deployment plan

Two phases. The local-only phase validates that Pepper actually pays off before we add hosting complexity.

**Phase 1 — Local on main Mac.** Stdio transport, this repo as-is. Things3 + things-mcp-server + Cowork all on the same machine. Smoke test, use for a week or two, observe where she actually adds value. Cost: nothing beyond install.

**Phase 2 — Headless camper MBP as the Pepper host.** Migrate the server to a screen-broken MacBook Pro living in the camper. Starlink keeps it always-online; Tailscale gives it a stable network identity regardless of where the camper parks. Pepper follows the camper to Moab, Yellowstone, or the driveway without reconfiguration. Phone reaches her over Tailscale.

```
   Your phone (Claude iOS)              Your laptop (anywhere)
            │                                    │
            └──────────── Tailscale ─────────────┘
                              │
                              ▼
                  ┌───────────────────────────┐
                  │   Camper MBP (headless)   │
                  │                           │
                  │   things-mcp-server       │
                  │     + HTTP transport      │
                  │     + bearer-token auth   │
                  │                           │
                  │   Things 3 (signed into   │
                  │     your Things Cloud,    │
                  │     auto-syncs to main    │
                  │     Mac + iPhone + Watch) │
                  │                           │
                  │   Auto-login, no sleep,   │
                  │   HDMI dummy plug for     │
                  │   clamshell wake          │
                  └───────────┬───────────────┘
                              │
                              ▼
                       Starlink (always on)
```

**The headless gotchas, in order of "will bite you":**

1. **Clamshell-mode wakefulness.** Apple Silicon laptops with lid closed and no external display assume "user wants to sleep." Fix: ~$5 HDMI dummy plug (EDID emulator that fakes an external display), or `caffeinate -dimsu` as a LaunchDaemon. The dummy plug is the cleaner answer.
2. **Sleep prevention beyond clamshell.** `sudo pmset -a sleep 0 disablesleep 1 powernap 0 standby 0 hibernatemode 0`.
3. **FileVault + auto-login tension.** Keep FileVault enabled. `sudo pmset -a autorestart 1` for auto-reboot on power loss. Enable auto-login post-unlock. Accept that hard power loss = one manual unlock when you're next near the camper.
4. **Initial setup with no screen.** Borrow an external display + USB-C dock for ~30 minutes of one-time setup, or use Apple Silicon Mac Sharing Mode via another Mac.
5. **Things3 needs an active user session.** Auto-login handles this.

**Migration steps (Phase 1 → Phase 2):**

1. Get the MBP healthy on an external display (one-time).
2. Install Things 3, sign into Things Cloud (your existing account), confirm sync — todos created on the MBP show up on your phone instantly.
3. Install Node 22, clone the repo, `npm install && npm run build`.
4. Seed Keychain with the Things URL token (the token authorizes any Things3 instance under your iCloud account, so the main Mac and the camper MBP share it).
5. Install Tailscale, tag the node (e.g., `tag:pepper-host`).
6. Apply the gotcha fixes above (auto-login, sleep suppression, autorestart, dummy plug).
7. Close the lid. Disconnect display.
8. Build HTTP transport + bearer auth (tasks #17/#18) targeting the MCP `2026-07-28` spec.
9. Point Claude iOS at the Tailscale endpoint with its bearer token.

After Phase 2, the main Mac becomes just a Things3 client like your phone is. The camper MBP is the agent backend; you talk to Pepper from wherever you happen to be.

## Setup

### 1. Install dependencies

```sh
make install test build
```

If `npm install` fails on a native module, check that Xcode Command Line Tools is up to date (`xcode-select --install`). The only native dep is `better-sqlite3`, which ships prebuilts for Node 22 on macOS arm64 + x64.

### 2. Store your Things URL token in Keychain

In Things, go to *Settings → General → Enable Things URLs → Manage* and copy the token. Then in Terminal:

```sh
security add-generic-password -s "com.thingsmcp" -a "auth-token" -U -w
# -w with no value prompts interactively — the token is never in your shell history
# Paste the token, press Enter
```

Verify (this will prompt for Keychain access the first time):

```sh
security find-generic-password -s "com.thingsmcp" -a "auth-token" -w
```

The first time the MCP reads the token, macOS will ask whether to allow access. Click **Always Allow** to whitelist the node binary for this Keychain item.

### 3. Register with Cowork / Claude Desktop

Add to your MCP config:

```json
{
  "mcpServers": {
    "things": {
      "command": "node",
      "args": ["/Users/<you>/dev/things-mcp-server/dist/index.js"]
    }
  }
}
```

Restart Cowork / Claude Desktop. The tools should appear under `things` in `/mcp`.

### 4. Grant Automation permission

The first time a read tool runs, macOS will ask whether to allow this process to control Things. Grant it. You can later review/revoke in *System Settings → Privacy & Security → Automation*.

## Tools

**Capture (no token):**

| Tool | Description |
|---|---|
| `add_todo` | Create a to-do anywhere (Inbox by default) |
| `add_project` | Create a project in an Area, optionally with initial to-dos |
| `bulk_create` | JSON-based bulk create (projects, headings, to-dos, checklists) |

**Reorganize (token from Keychain):**

| Tool | Description |
|---|---|
| `update_todo` | Update an existing to-do by ID |
| `update_project` | Update an existing project by ID |
| `complete_todo` | Mark a to-do complete |
| `reschedule` | Change the `when` of a to-do |
| `bulk_reorganize` | JSON-based bulk update |
| `clone_project` | Duplicate a template Project (with headings + child todos) and rename/relocate |

**Read (no token):**

| Tool | Description |
|---|---|
| `list_todos` | Read from any list. `from`: inbox/today/anytime/upcoming/someday/logbook/area/tag/project (with `name` or `id` as needed) |
| `find_todos` | Substring search across to-do name + notes |
| `get_project` | Full project detail including notes body (for rental info pads, big-initiative context) |
| `list_by_deadline_window` | To-dos due within N days, sorted ascending |
| `list_areas` | All Area names + IDs |
| `list_tags` | All tag names |
| `snapshot` | Areas + Tags + Projects in one call, with 60s in-memory TTL cache |

**Navigate (no token):**

| Tool | Description |
|---|---|
| `show` | Navigate the Things UI to an item, list, or query |
| `search` | Invoke the Things search UI |

To-do reads include `activationDate` as `yyyy-mm-ddTHH:MM` when a reminder time is set, plain `yyyy-mm-dd` otherwise — so the agent can distinguish "scheduled for today" from "reminder at 2pm today."

## Policy

Defaults live in `config/policy.default.yaml`. Override per-tool at `~/Library/Application Support/things-mcp/policy.yaml`:

```yaml
tools:
  bulk_reorganize:
    decision: dry-run     # never actually fires URLs; returns what would happen
  update_todo:
    rate_limit: 30/hour
```

Decisions: `allow`, `dry-run`, `deny`. (No `prompt` — the chat client handles tool approval UI.)

Reload without restarting:

```sh
kill -HUP $(pgrep -f things-mcp-server)
```

## Audit log

Every tool call writes a row to `~/Library/Application Support/things-mcp/audit.db`. The DB uses plain `better-sqlite3`, with **field-level AES-256-GCM encryption** on the sensitive columns (`args_redacted`, `error`). The 256-bit key is auto-generated on first run and stored in macOS Keychain (service `com.thingsmcp`, account `audit-key`).

What's visible to anyone with file read access (low sensitivity):
- `id`, `ts`, `tool`, `outcome`, `duration_ms`, `policy_decision`

What's ciphertext (Keychain key required to read):
- `args_redacted`, `error`

### Aggregate queries (no key needed)

```sh
sqlite3 ~/Library/Application\ Support/things-mcp/audit.db \
  'SELECT tool, COUNT(*), AVG(duration_ms) FROM audit_log GROUP BY tool;'

sqlite3 ~/Library/Application\ Support/things-mcp/audit.db \
  "SELECT tool, outcome, COUNT(*) FROM audit_log WHERE ts >= '2026-05-01' GROUP BY tool, outcome;"
```

### Decrypted view

After `npm run build`, link the bin:

```sh
npm link    # optional — puts `things-audit` on PATH
```

Then:

```sh
things-audit                              # last 20 rows, pretty
things-audit --tail 100
things-audit --tool add_todo --tail 50
things-audit --outcome error
things-audit --since 2026-05-20
things-audit --json | jq                  # for piping
```

First run prompts Keychain access for `audit-key` — click **Always Allow**.

### Redaction (before encryption)

Args are redacted BEFORE encryption, defense-in-depth style: title/notes/checklist content becomes `{sha256, len, type}`; structural fields (IDs, list/area/tag names, dates, booleans) stay literal; anything matching `/token|password|secret|key|auth/i` → `[REDACTED]`. Even if the audit-key leaks, your titles and notes are never in plaintext anywhere in the audit log.

## Security notes

- The Things auth-token is read from Keychain on first use, cached in memory, and zeroed on `SIGTERM`. It is never written to disk by this server or logged in plaintext.
- The audit DB is **SQLCipher-encrypted at rest** with a 256-bit Keychain-held key. Defense in depth on top of FileVault — even with the disk unlocked, another local process can't read the audit history without Keychain access.
- Capture tools (no token) cannot reorganize existing data; the worst they can do is add items to your Inbox.
- The URL scheme is the only write surface used. We do not touch the Things SQLite store directly, so Things upgrades cannot break us.
- See `SECURITY.md` for the full threat model and trust assumptions.

## Token rotation

```sh
security delete-generic-password -s "com.thingsmcp" -a "auth-token"
# Then re-add per step 2 above
```

You should also rotate the token in Things itself (*Settings → General → Manage Things URLs → Reset*) periodically.

## License

MIT (or your preference — set before publishing).
