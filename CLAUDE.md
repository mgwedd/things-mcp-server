# CLAUDE.md

Context for Claude (and other coding agents) working on this repo. Read this first.

## What this is

A local macOS MCP server that exposes Things 3 as agent tools. Built for one user (Michael, staff engineer at Okta) as the task-management backend for a personal AI executive assistant ("Pepper Potts" model). Things 3 is the single source of truth (syncs across Mac + iOS + Watch via Things Cloud); this server lets Claude read and modify that data through the same supported URL-scheme + AppleScript surface Cultured Code exposes to third-party apps.

This is NOT a generic Things integration. Design decisions favor a security-paranoid single user over broad compatibility. Audit log encryption, Keychain-held tokens, per-tool policy, and content redaction exist because the user runs the broader system that this plugs into.

## Architectural pillars

Three trust tiers, mapped directly to tool groups. **Do not violate these boundaries.**

1. **Capture** — `add_*`, `bulk_create`. Wide open (no auth-token), worst-case blast radius is Inbox noise.
2. **Reorganize** — `update_*`, `complete_*`, `reschedule`, `clone_project`, `bulk_reorganize`. Requires Things URL auth-token loaded from macOS Keychain. Audit-logged with arg redaction.
3. **Read** — `list_*`, `find_todos`, `get_project`, `snapshot`. Uses AppleScript via Apple's documented dictionary. Triggers macOS Automation permission (per source binary → per target app). **Never read the Things SQLite store directly** — that requires Full Disk Access (much wider TCC scope) and breaks on schema changes. URL scheme + AppleScript are the supported surfaces.

Every tool call passes through `executeTool()` in `src/tools/index.ts` which applies per-tool policy and writes an audit row regardless of outcome.

## File map (read in this order on a fresh session)

| File | Purpose |
|---|---|
| `README.md` | User-facing setup + tool reference + future architecture diagram |
| `SECURITY.md` | Threat model, secret handling, redaction rules |
| `DECISIONS.md` | Why we chose each major design point. **Read before refactoring.** |
| `src/index.ts` | MCP server entry, stdio transport, tool dispatch, SIGHUP/SIGTERM handlers |
| `src/tools/index.ts` | Tool registry + `executeTool()` wrapper with policy + audit |
| `src/tools/*.ts` | One file per tool group (add, update, find, bulk, show, snapshot) |
| `src/things-url.ts` | URL builders for `things:///` commands, percent encoding |
| `src/applescript.ts` | AppleScript bridge for reads; shared `AS_HELPERS` block + per-query scripts |
| `src/keychain.ts` | Generic Keychain accessor; two secrets: `auth-token` (user-set), `audit-key` (auto-gen) |
| `src/audit.ts` | SQLite-backed append-only log with field-level AES-256-GCM on sensitive columns |
| `src/crypto.ts` | AES-256-GCM helpers used by audit |
| `src/redact.ts` | Pre-encryption redaction (titles/notes → sha256+len before they reach the log) |
| `src/policy.ts` | Policy loader (YAML), per-tool decisions + rate limits |
| `src/snapshot.ts` | In-memory TTL cache (60s) over Areas/Tags/Projects for hot reads |
| `src/types.ts` | Zod schemas for all tool inputs |
| `src/scripts/audit-view.ts` | `things-audit` CLI — decrypted log viewer |
| `src/scripts/snapshot.ts` | `things-mcp-snapshot` CLI — read-only Things state dump |
| `config/policy.default.yaml` | Embedded default policy; user override at `~/Library/Application Support/things-mcp/policy.yaml` |
| `src/test/*.test.ts` | `node:test` via tsx — crypto, things-url, redact, policy |

## Common commands

```sh
# Setup (one-time)
nvm use                                 # picks Node 22 from .nvmrc
npm install
npm run build

# Dev cycle
npm test                                # unit tests; no Things needed
npm run typecheck
npm run dev                             # tsx watch mode

# Operational
npm run audit                           # or `things-audit` if linked
                                        # decrypted view of recent tool calls
things-audit --tail 50 --tool add_todo  # filter by tool
things-audit --outcome error            # show only errors
things-audit --json | jq                # pipe to jq

# Keychain (one-time per Mac)
security add-generic-password -s "com.thingsmcp" -a "auth-token" -U -w
  # Paste the Things URL token from Things → Settings → General → Manage Things URLs

# If audit-key is malformed (e.g., 31 chars), reset and re-seed:
security delete-generic-password -s com.thingsmcp -a audit-key 2>/dev/null
security add-generic-password -s com.thingsmcp -a audit-key -U -w "$(openssl rand -hex 32)"

# Policy hot-reload (without restarting daemon)
kill -HUP $(pgrep -f things-mcp-server)
```

## What to NEVER do

These are not preferences — they're load-bearing for the threat model.

1. **Never log the Things auth-token or audit-key.** Not to stderr, not to the audit DB, not anywhere on disk. The `redact.ts` `SECRET_PATTERN` strips them; don't bypass it.
2. **Never store cleartext titles/notes in the audit log.** Run `redactArgs()` before encryption, always. The redaction layer is defense in depth — even if the audit-key leaks, content bodies are only sha256-hashes.
3. **Never read the Things SQLite store directly.** Use AppleScript (the supported surface). Direct SQLite requires Full Disk Access and grants the MCP read access to the user's entire home directory — a significant blast-radius regression.
4. **Never bypass `executeTool()`.** Every tool call must pass through it to get policy + audit. New tools register in the `TOOLS` array in `src/tools/index.ts`; don't add side-channel dispatchers.
5. **Never weaken the capture/reorganize/read tier split.** The token requirement on reorganize tools is the structural guarantee that a runaway capture flow can't escalate to mutating existing data.
6. **Never set the Keychain item ACL to "allow all apps"** (`-A` flag). Each Keychain item is whitelisted to a specific binary path; that's the access control. Defaults are correct.
7. **Never use HTTP transport without bearer-token auth.** The HTTP transport (planned, task #17) must require a Keychain-held bearer token even on Tailscale, because Tailscale + auth is defense in depth.

## What to ALWAYS do

1. **New tool? Register it in three places: `TOOLS` (src/tools/index.ts), `config/policy.default.yaml`, and an input schema in `src/types.ts`.** Tests should fail loudly if any of the three is missing (see `src/test/tool-registry.test.ts` if it exists; if not, add one).
2. **Add tests for new tool input schemas** — a valid example should parse, an invalid one should reject. `src/test/*.test.ts` uses `node:test` via tsx, no extra deps needed.
3. **AppleScript scripts use the shared `AS_HELPERS` block** in `src/applescript.ts`. Don't redefine `safeStr`, `isoDate`, `isoDateTime`, or `todoRow` per-script.
4. **TSV output from AppleScript uses `\t` between fields and the `␞` RECORD SEPARATOR between rows.** Notes (which can contain anything) use the `␃NOTES_BEGIN␃...␄NOTES_END␄` sentinel pattern — see `getProjectDetail`.
5. **Reorganize tools always redact the URL before returning** (the URL contains the auth-token in plaintext). Helper: `redactUrl(url)` in `src/tools/update.ts`.

## Current state and next steps

**Phase 1 (in progress):** local stdio MCP on the user's main Mac. The user is in the middle of smoke testing — first end-to-end loop through Cowork → MCP → Things3 → audit log.

**Pending tasks:** see `TaskList` if running under Cowork. High-level:

- Smoke-test the local flow (in progress)
- Add four borrowed read tools from hald/things-mcp (trash list, recent items, search_advanced, get_project structure) — design in DECISIONS.md
- Add contract tests for every tool (schema validation + registry consistency)
- HTTP transport + bearer auth targeting MCP spec 2026-07-28 (for camper-MBP remote access via Tailscale)
- Headless MBP host runbook (camper, Starlink-always-on)

**Phase 2 (future):** the same MCP migrated to a screen-broken MBP in the user's camper, accessed remotely via Tailscale + Starlink. README "Future architecture" section has the topology diagram and migration steps.

**Phase 3 (further future):** broker + proton-mail-mcp + proton-cal-mcp + content gate routing bodies to local model and metadata to Claude. This MCP is one of three planned surfaces. Threat model is the unifying primitive.

## Conventions

- TypeScript, Node 22 (`.nvmrc`), strict mode + `noUncheckedIndexedAccess`
- ES modules, `NodeNext` resolution
- Zod for input validation, zod-to-json-schema for MCP advertisement
- `node:test` via `tsx --test` for unit tests
- No native deps beyond `better-sqlite3` (with prebuilts for Node 22 on macOS arm64/x64). **Do not add `better-sqlite3-multiple-ciphers` or other SQLCipher wrappers** — we tried, the prebuilds lag and node-gyp build-from-source is fragile. Field-level AES-256-GCM is the working answer.
- Apple-only. AppleScript, macOS Keychain, `osascript`. Cross-platform is out of scope.

## When stuck

- Look in `DECISIONS.md` first — most "why is this like this?" questions are answered there.
- For Things URL scheme behavior, the canonical reference is https://culturedcode.com/things/support/articles/2803573/ (already cited in code comments).
- For MCP protocol questions, check the SDK source and https://modelcontextprotocol.io. Spec `2026-07-28` ships July 2026; we're currently targeting `2025-11-25` until the SDK supports the new spec (tracked as a task).
- Test scripts in `src/test/` are the executable contract for non-AppleScript modules.
