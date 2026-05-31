# Design decisions

ADR-style record of major design choices. Read before refactoring — most "this seems weird, let me clean it up" instincts are answered here.

Newest at the top. Each entry: **context** (what we were facing), **decision** (what we chose), **alternatives considered**, **consequences** (what we accept by choosing this).

---

## D-014 — URL scheme + AppleScript, not the reverse-engineered Things Cloud API

**Context.** Discovered `arthursoares/things-cloud-sdk` (Go SDK for the reverse-engineered Things Cloud sync protocol) and `wbopan/things-cloud-mcp` (MCP server built on it, public hosted endpoint at `thingscloudmcp.com`). Both bypass the local Mac entirely — direct HTTPS to Things' sync servers, no AppleScript, no URL scheme, no macOS dependency. Tempting for Phase 2 because it would let Pepper run on a Linux VPS instead of requiring the camper MBP.

**Decision.** Keep our URL-scheme + AppleScript approach. Do not adopt the Cloud API.

**Alternatives.**

- Cloud API via the Go SDK. Faster, no Mac required, real-time push notifications, batch ops.
- Hosted `thingscloudmcp.com`. Zero-setup, but multi-user shared server.

**Consequences.**

- Pro: No password leaves the machine. Our Keychain item holds a scope-bounded URL-scheme auth-token; the Cloud API requires the master Things Cloud username + password (or OAuth-flavored access that holds the same blast radius). The token can be rotated in Things settings; the password can't be scoped without losing all access.
- Pro: Documented, supported surfaces. AppleScript dictionary and URL scheme are maintained by Cultured Code for compatibility. The Cloud API is reverse-engineered, undocumented ("no official API documentation available, all requests need to be reverse engineered" — SDK README). Could break on any Things release. Could trigger account flags for non-Things-app User-Agents.
- Pro: Smaller TCC blast radius. AppleScript → Things3 only. Cloud-API credentials can do anything in your account from anywhere on the internet.
- Con: Mac dependency stays. Phase 2 still needs the camper MBP rather than a $50 Linux VPS.
- Con: No native change-detection push. Pepper has to poll or be triggered by tool calls. **Worth borrowing the *pattern* from `arthursoares/things-cloud-sdk` — its sync engine emits 40+ semantic events (`TaskMovedToToday`, `TaskCompleted`, `TaskTagsChanged`).** We can implement a poll-based version on AppleScript: periodic snapshot → diff → emit events to a local SQLite log. Same primitive, same trust model. Tracked for the future as a `things-watcher` companion.
- Con: AppleScript latency (~500ms/call) and URL-scheme rate limit (250 items / 10s). Acceptable for personal-EA volumes.

The `thingscloudmcp.com` hosted version is a hard no regardless — multi-user server with everyone's Things Cloud credentials in a Fly.io volume is exactly the pattern this project exists to avoid (see the broader "I don't trust those connect-CRUD" stance that started this whole conversation).

---

## D-013 — Token in macOS Keychain, not env var or config file

**Context.** The Things URL scheme requires an auth-token for `update-*` and `json` (with update operations). It has to live somewhere the server can read at runtime.

**Decision.** Store in macOS Keychain under service `com.thingsmcp`, account `auth-token`. Set interactively via `security add-generic-password -w` (no value on argv → password prompt, never in shell history). Read lazily on first reorganize call via `security find-generic-password -w`. Cached in memory after first read, zeroed on `SIGTERM`.

**Alternatives.**

- Env var in `claude_desktop_config.json` (hald/things-mcp pattern). Plaintext on disk, no ACL story.
- `.env` file in repo or home. Same issue.
- Hardcoded constant. Comically bad.

**Consequences.**

- Pro: macOS does the at-rest encryption + ACL gating. First access prompts user once ("Always Allow"). FileVault is the floor.
- Pro: Token never appears in any file the user might `cat` or commit.
- Con: macOS-only. Doesn't matter — this whole project is macOS-only.
- Con: Keychain ACL whitelists a specific binary path. If an attacker replaces `node` at that path, they read the token without prompting. Mitigation tracked as future work (sign + hash-pin the binary).

---

## D-012 — Field-level AES-256-GCM, not SQLCipher

**Context.** Audit log needs encryption at rest (FileVault only protects when disk locked; an unlocked-but-logged-in Mac with another local process can exfil the file). Want defense in depth.

**Decision.** Use plain `better-sqlite3` and AES-256-GCM with per-row IVs and tool-name AAD. Encrypted columns: `args_redacted`, `error`. Plaintext columns: `id, ts, tool, outcome, duration_ms, policy_decision` (these are low-sensitivity structural data and let `sqlite3` CLI do aggregate queries without the key).

**Alternatives.**

- SQLCipher via `better-sqlite3-multiple-ciphers`. **Tried, didn't work.** Prebuilds lag the main `better-sqlite3`, build-from-source via node-gyp fails on Node 22 even with Xcode CLT current. Spent a build cycle on it before pivoting.
- `@journeyapps/sqlcipher`. React-Native-flavored, awkward.
- Encrypt only when reading. Doesn't help: the file at rest is still cleartext.

**Consequences.**

- Pro: Zero native-build pain. `better-sqlite3` has rock-solid prebuilts for Node 22 on macOS arm64/x64.
- Pro: Aggregate queries (`COUNT(*)`, `AVG(duration_ms)` by tool) work with plain `sqlite3` CLI — no key needed.
- Pro: Defense-in-depth on top of redaction. Even with the audit-key compromised, titles/notes are never plaintext anywhere because `redactArgs()` hashes them BEFORE encryption.
- Con: `things-audit` CLI needed for decrypted view (small, lives in `src/scripts/audit-view.ts`).
- Con: SQLCipher would give whole-DB encryption including the schema columns. We accept exposing timestamps, tool names, outcomes, and timing — those are the least sensitive parts.

---

## D-011 — `clone_project` via Things' native `duplicate=true`, not YAML templates

**Context.** Need a way to bootstrap new projects with a standard shape (new rental → onboarding/repairs/tenants/finance headings + starter todos).

**Decision.** Keep "Template: X" projects in a Templates Area inside Things itself. `clone_project` calls `things:///update-project?id=X&duplicate=true&title=Y&area=Z`. Native Things behavior, single source of truth.

**Alternatives.**

- YAML templates in `templates/*.yaml` + a substitution engine. We built this, used it briefly, deleted it.
- Hardcoded templates in TS. Same problem at a different layer.

**Consequences.**

- Pro: Templates editable in Things on every device. No parallel definition to drift.
- Pro: One mechanism (`update-project`) handles cloning. Less code.
- Con: User has to remember to maintain template projects. Documented in README.

---

## D-010 — In-memory TTL cache for snapshot, no disk persistence

**Context.** Hot reads of Areas/Tags/Projects during agent reasoning shouldn't re-spawn AppleScript every time.

**Decision.** 60-second in-memory cache in `src/snapshot.ts`. No disk persistence. CLI `things-mcp-snapshot --write path` for explicit ephemeral dumps.

**Alternatives.**

- Persistent snapshot.json. Built, deleted. Things itself is the source of truth (syncs via cloud across devices); a local stale file becomes a coordination problem we don't need.
- No cache at all. Acceptable but wastes time on multi-step agent reasoning that lists Areas + Tags + something else in quick succession.

**Consequences.**

- Pro: Always fresh enough (60s window). No staleness anxiety.
- Pro: No file to corrupt, garbage-collect, or sync.
- Con: Restarts lose the cache. Negligible — first call is ~500ms.

---

## D-009 — Consolidated `list_todos` tool, not one tool per built-in list

**Context.** Original design had `list_inbox`, `list_today`, `list_by_area`, `list_by_tag`. Adding Anytime/Upcoming/Someday/Logbook would push tool count to ~22.

**Decision.** Single `list_todos({from: "inbox" | ... | "area" | "tag" | "project", name?, id?})` tool. Net count went 18 → 18 while adding 4 capabilities.

**Alternatives.**

- Separate tool per list. Familiar shape, larger MCP tool advertisement context.

**Consequences.**

- Pro: Smaller LLM context footprint.
- Pro: Easier to extend (new built-in list = one enum addition).
- Con: Slightly less self-documenting for the LLM. Mitigation: good tool description.

---

## D-008 — AppleScript reads, not direct SQLite

**Context.** Need to read Things data: Areas, Tags, Projects, To-dos. Two paths exist.

**Decision.** AppleScript via Apple's published Things3 dictionary. `osascript -e <script>`. Parse TSV output.

**Alternatives.**

- Direct SQLite read of `~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/.../main.sqlite` (the hald/things-mcp / `things.py` approach).

**Consequences.**

- Pro: Supported surface. Cultured Code maintains AppleScript dictionary compatibility. SQLite schema can change without warning.
- Pro: TCC scope is "Automation → Things3 only," granted on first call. SQLite path requires Full Disk Access — grants read of the entire user home directory.
- Con: Slower per call (~500ms vs <50ms). Acceptable for agent workloads. Mitigated by snapshot TTL cache.
- Con: TSV parsing is fiddly. Mitigation: shared `AS_HELPERS` block + sentinel separator (`␃NOTES_BEGIN␃...␄NOTES_END␄`) for notes that can contain anything.

---

## D-007 — Three trust tiers (capture / reorganize / read)

**Context.** Need a structural way to separate "low-risk" from "modifies existing data" tool calls so policy and audit have something natural to gate on.

**Decision.** Three groups:

- **Capture** (no token): `add_*`, `bulk_create`. The Things URL scheme doesn't require auth for additions.
- **Reorganize** (token required): `update_*`, `complete_*`, `reschedule`, `clone_project`, `bulk_reorganize`.
- **Read** (no token, AppleScript only): `list_*`, `find_*`, `get_*`, `snapshot`.

Each tier has different policy defaults, different rate-limit settings, and different audit-log scrutiny.

**Alternatives.**

- Flat tool list with per-tool config. Possible but loses the structural insight that the URL scheme already gates writes.

**Consequences.**

- Pro: Compromise of a capture flow can't escalate to mutating existing data.
- Pro: Maps naturally to LLM tool choice (capture = "free", reorganize = "be careful", read = "free").
- Con: A few tools blur the line (`complete_todo` is sugar over `update_todo`; both are reorganize). Accept the duplication.

---

## D-006 — Zod for input validation, zod-to-json-schema for MCP advertisement

**Context.** MCP's `inputSchema` field expects JSON Schema. Want to express schemas once in TypeScript and have them validated at runtime + advertised over MCP.

**Decision.** Zod schemas in `src/types.ts`. `zod-to-json-schema` converts them at server startup for the `tools/list` response.

**Alternatives.**

- Hand-written JSON Schemas + Ajv. More boilerplate, easier to drift.
- Native MCP SDK validators. Coverage gaps.

**Consequences.**

- Pro: One source of truth. TypeScript types derive from Zod schemas via `z.infer`.
- Pro: When MCP spec `2026-07-28` lifts to JSON Schema 2020-12, our schemas should validate as-is (composition, refs, conditionals all supported by zod-to-json-schema).
- Con: Bundle size slightly larger than hand-written.

---

## D-005 — No "prompt" policy tier; rely on Cowork's tool approval UI

**Context.** proto-mcp's design has a `prompt` decision that fires an NSAlert for destructive operations. We considered the same.

**Decision.** Skip in-server prompts. Policy decisions are `allow` / `dry-run` / `deny` only. The chat client (Cowork / Claude Desktop) already provides per-tool approval UI; duplicating it in the MCP would create two prompts for one action.

**Alternatives.**

- Implement NSAlert-via-Swift-helper like proto-mcp. More code, more native deps, redundant UI.

**Consequences.**

- Pro: Less code, no Swift helper, no Touch-ID integration burden.
- Pro: Consistent with how every other MCP server behaves (let the client handle approval UX).
- Con: We rely on the client to actually gate destructive ops. For Cowork this is true. If the user adds another client that doesn't gate, every reorganize tool runs unprompted. Mitigation: `dry-run` policy decision is a strong default for new clients while building trust.

---

## D-004 — TypeScript / Node, not Python or Rust

**Context.** Pick a language for the broker, MCPs, and supporting tools.

**Decision.** TypeScript on Node 22 throughout.

**Alternatives.**

- Python (hald/things-mcp uses this; broad MCP ecosystem; user knows less Python).
- Rust (memory safety; smaller TCB for the broker; user not Rust-fluent).
- Go (proto-mcp uses this; aligns with MCP server idiom).

**Consequences.**

- Pro: Plays to the user's expertise. Fast iteration.
- Pro: Official `@modelcontextprotocol/sdk` is mature in TS.
- Pro: Type system helps with policy correctness.
- Con: V8 is a larger TCB than Rust or Go for trust-critical code. Accepted for v1; revisit if/when the broker handles cross-MCP routing.

---

## D-003 — Stdio transport for v1, HTTP transport later

**Context.** MCP supports stdio (subprocess) and HTTP/SSE transports.

**Decision.** Ship stdio only for v1. HTTP transport added later when remote access is needed (Phase 2 — camper MBP via Tailscale).

**Alternatives.**

- HTTP from day one. Premature; adds auth + network surface for a use case that's not yet active.

**Consequences.**

- Pro: Simpler v1. Stdio auth is implicit (subprocess runs as the user).
- Con: Defers the work. When we build HTTP transport (task #17), target MCP spec `2026-07-28` (stateless protocol core) directly rather than the older session-based `2025-11-25` model.

---

## D-002 — No "prompt" elicitation tooling; LLM proposes, user accepts via chat

**Context.** Per ADHD-friendly design, capture should be zero-friction. But triage involves Claude proposing Area/Tag/schedule for items, and the user approving.

**Decision.** Triage happens in the chat conversation. Claude calls `list_todos({from: "inbox"})`, reasons about each, proposes a `bulk_reorganize` JSON, and asks the user once for batch approval. No special elicitation tool; the chat IS the UI.

**Alternatives.**

- MCP elicitation/prompt features. Adds surface area for one workflow.

**Consequences.**

- Pro: Works in any chat client without special support.
- Pro: Decisions are visible in conversation history.

---

## D-001 — Things 3 (not Apple Reminders, Todoist, Notion, etc.)

**Context.** Pick a task system.

**Decision.** Things 3 — already the user's daily-driver, has URL scheme + AppleScript, syncs across iOS/Mac/Watch/Vision via Things Cloud (no third-party cloud), supports rich structure (Areas → Projects → Headings → Todos → Checklists).

**Alternatives.**

- Apple Reminders: weaker structure, EventKit binary permission.
- Todoist / Notion: third-party cloud, broad OAuth scopes.
- Things 3: chosen.

**Consequences.**

- Pro: User-owned data on user-owned devices. Things Cloud is E2E for paid plans.
- Pro: Rich structure maps cleanly to multi-domain life (Rentals / Camper / Athena / Work / Personal).
- Con: Mac-only. Acceptable — the user's life centers on Apple devices.

---

## Adding a decision

When making a non-trivial design call, add a new entry at the TOP (newest first). Template:

```md
## D-NNN — Short imperative title

**Context.** What were we facing? What constraints?

**Decision.** What we chose. Specific enough that a fresh agent can reproduce the choice.

**Alternatives.** What else we considered and why we passed.

**Consequences.** What we accept by choosing this. Pros and cons honestly.
```

Bump the number, don't reuse old ones.
