# Security model — things-mcp-server

This document describes what this server defends against, what it doesn't, and which design choice mitigates which threat. It is a working document — revise as the implementation evolves.

## Trust assumptions

- **macOS Keychain** is the root of trust for the Things URL auth-token. We assume Apple's at-rest encryption and access control mechanisms work as documented.
- **FileVault** is enabled on the user's Mac.
- **Cowork / Claude Desktop** is the trusted MCP client. It is responsible for any user-facing approval UI for destructive operations.
- **Things 3** is trusted. Its URL scheme is the only write surface this server uses.

## Three-tier capability split

The server's tools fall into three trust tiers, and the split is the central security primitive of the design.

### Capture (no token, blast radius = Inbox noise)

Tools: `add_todo`, `add_project`, `bulk_create`.

These shell `open` against `things:///add`, `things:///add-project`, and `things:///json` (create operations only). The Things URL scheme does not require an auth-token for additions. The worst a compromised or runaway agent can do here is fill your Inbox with garbage — recoverable in minutes by selecting all and deleting.

**Policy posture:** allow by default. Rate-limited by Things itself (250 items / 10 seconds).

### Reorganize (token required, blast radius = data shuffle)

Tools: `update_todo`, `update_project`, `complete_todo`, `reschedule`, `bulk_reorganize`.

These call `things:///update`, `things:///update-project`, and `things:///json` with update operations. All require the auth-token. The token is loaded from Keychain on first use and cached in memory.

A compromised flow here could mark items complete that aren't, move items between Areas, change titles, or rewrite notes. Damage is bounded by the audit log: every reorganize call is recorded with redacted args, outcome, and timing, so any anomaly is visible on review.

**Policy posture:** allow by default, but the chat client's tool approval UI gates them in practice. Configurable to `dry-run` (returns the URL that would be fired without firing it) or `deny` per-tool.

### Read (no token, blast radius = information disclosure to caller)

Tools: `find_todos`, `list_inbox`, `list_today`, `list_by_area`, `list_by_tag`, `list_areas`, `list_tags`.

These shell to `osascript` against Things3 using Apple's published AppleScript dictionary. macOS Automation permission must be granted on first use (per source binary → per target app). The server can read; it cannot escalate to other apps without separate grants.

**Policy posture:** allow by default. Reads do not modify state and are not rate-limited.

## Secret handling

Two secrets live in macOS Keychain under service `com.thingsmcp`:

| Account | Source | Used by |
|---|---|---|
| `auth-token` | User-provided (paste into `security add-generic-password -w`) | All reorganize tools |
| `audit-key` | Auto-generated 256-bit random on first run | Audit DB SQLCipher key |

Both are:

- Loaded lazily on first use via `security find-generic-password -w` (which triggers the standard Keychain access prompt on first run; user clicks "Always Allow" to whitelist the node binary).
- Cached in memory after first read.
- Zeroed on `SIGTERM` / `SIGINT` and on normal shutdown.
- Never written to any file managed by this server.
- Never included in audit log rows.
- Never logged to stderr or any debug output.

The audit key is written via `security add-generic-password -w <value>` on first run — the value is briefly visible in argv during the spawn of the `security` process (visible to the same user or root). For a machine-generated random key this is acceptable; the user-provided `auth-token` is set interactively (no `-w VALUE` argument) so it never appears in argv at all.

**Known residual risks:**

- macOS Keychain ACL whitelists specific binary paths. If an attacker replaces the `node` binary at the whitelisted path, they can access both secrets without prompting. Mitigation: code-sign the eventual standalone binary; hash-pin it; revisit ACL via `SecAccessControl` with biometric protection in a future revision.
- A debugger-entitled process can read memory of this server while it holds the secrets unlocked. Acceptance: this is true of every userland secret handler on macOS; mitigation requires kernel-level protection (Secure Enclave) which is out of scope for v1.

## Audit log

`~/Library/Application Support/things-mcp/audit.db`, plain SQLite (`better-sqlite3`), append-only, with **field-level AES-256-GCM encryption** on the sensitive columns.

### Why field-level rather than SQLCipher?

Initial design used SQLCipher via `better-sqlite3-multiple-ciphers`. Its prebuilds lag the upstream `better-sqlite3` package and build-from-source via `node-gyp` is fragile in practice. Field-level AEAD encryption with Node's built-in `crypto` module gives equivalent threat coverage with zero native-build risk and lets aggregate / structural queries (counts, timing) work with the plain `sqlite3` CLI when convenient.

### Encryption details

- Algorithm: AES-256-GCM
- Key: 256 random bits generated on first run via `crypto.randomBytes(32)`, stored in macOS Keychain under service `com.thingsmcp`, account `audit-key`.
- Per-row IV: 12 random bytes via `crypto.randomBytes(12)`.
- AAD: the row's `tool` column. Binds the ciphertext to the tool context — a ciphertext blob from row R cannot be transplanted to a row for a different tool without breaking authentication.
- On-disk format: `base64(iv || ciphertext || tag)`, single TEXT column per encrypted field.
- Encrypted columns: `args_redacted`, `error`.
- Plaintext columns: `id`, `ts`, `tool`, `outcome`, `duration_ms`, `policy_decision`.

### Threat coverage delta vs. FileVault alone

Without this encryption: a malicious local user-land process with read access to `~/Library/Application Support/` can read the audit history while you're logged in (FileVault only protects when the disk is locked).

With this encryption: that same process sees structural columns (timestamps, tool names, outcomes, timing) and ciphertext for content. It needs both file read access AND a successful Keychain ACL grant for `audit-key` to recover args / errors. The Keychain item is ACL-gated to the whitelisted `node` binary path; an unknown process attempting to read it triggers a fresh access prompt.

### Threats not covered

- A debugger-entitled process can read the key from this server's memory while running. Mitigation requires extracting the audit writer into a separate process with a smaller TCB and tighter entitlements — deferred to a future revision.
- An attacker who replaces the whitelisted `node` binary at the same path can access the key without prompting. Mitigation: code-sign the eventual standalone binary; hash-pin it.

### Double-layer defense for content

Note that title / notes / checklist-item content is **never** stored in plaintext anywhere, even before encryption: the `redactArgs()` pass replaces those fields with `{sha256, len, type}` before serialization. Field-level encryption is defense in depth on top of redaction. Even with the audit-key compromised, no content body is recoverable from the log.

Each row schema: `(id, ts, tool, args_redacted, outcome, error, duration_ms, policy_decision)`.

Redaction rules:

- `title`, `notes`, `notes-append`, `notes-prepend` → `{sha256, len}`
- `checklist-items` → `{count, sha256-of-joined}`
- `query` (in find/search) → kept verbatim (so audit can be reviewed for what was searched)
- `id`, `list`, `area`, `heading`, `tags`, `when`, `deadline`, `completed`, `canceled` → kept verbatim
- Anything else → kept verbatim unless it matches `/token|password|secret/i`

The recipient-equivalent for Things is the destination list/area/heading and the tags. These are kept literal because they are the verification surface for review.

## Out of scope

- **Physical access to an unlocked Mac.** If someone has your unlocked Mac, they have your Things data regardless.
- **Apple software supply chain.** TCC, Keychain, codesign all trusted.
- **Network adversary.** The URL scheme is loopback-only (`open` on the local machine), and the server itself doesn't make network calls.
- **Things 3 itself.** Trusted.
- **The MCP client (Cowork / Claude Desktop).** Trusted to relay tool calls faithfully and to gate destructive operations via its approval UI.

## Future work

1. Replace the `security` CLI shell-out with `SecAccessControl` + biometric ACL so reading either secret requires Touch ID. Held in memory after auth; re-prompt on screen lock / sleep / idle.
2. Code-sign the standalone binary and pin its hash for Keychain ACL.
3. Extract audit writer into a separate process so the main server's TCB doesn't hold the SQLCipher key.
4. Add a weekly `audit-review` script that summarizes activity by tool/area/outcome and surfaces anomalies.
5. Add Touch-ID-gated `protonmcp lock` / `unlock`-style controls so the daemon can be locked without restarting.
