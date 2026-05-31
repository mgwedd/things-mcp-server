# AGENTS.md

Quick-start for AI coding agents (Claude Code, Cursor, Continue, etc.) on this repo.

**The primary context document is `CLAUDE.md`.** Read it first. This file is a thin shim that points there and adds tool-agnostic conventions.

## Repository in one sentence

A local macOS MCP server that exposes Things 3 as agent tools, for a security-paranoid single user running a personal AI executive assistant ("Pepper Potts" model).

## Before you change anything

1. Read `CLAUDE.md` — orientation, file map, what-to-never-do.
2. Read `DECISIONS.md` — the rationale behind every major call. Most "this looks weird" instincts are answered here. **If you're about to undo a design decision, find the matching D-NNN entry first.**
3. Read `SECURITY.md` — the threat model. If your change touches the audit log, Keychain access, or the URL builder, this is non-optional reading.

## Commands you'll need

```sh
nvm use && npm install && npm run build
npm test                       # unit tests; no Things required
npm run typecheck
npm run dev                    # tsx watch
```

## House rules

- **Three trust tiers** — capture (no token) / reorganize (Keychain token) / read (AppleScript). Don't blur them.
- **One source of truth for tool registration** — `TOOLS` array in `src/tools/index.ts`. New tools register there + `config/policy.default.yaml` + an input schema in `src/types.ts`. If any of those is missing, the tool is broken.
- **Audit log writes go through `redactArgs()` then field-level AES-GCM** — never log raw args, errors, or anything that could contain a secret. The redaction layer is defense in depth even if the audit key leaks.
- **No native deps beyond `better-sqlite3`** — `better-sqlite3-multiple-ciphers` was tried, didn't work, see D-012. Field-level AES-GCM is the right answer.
- **No direct SQLite reads of the Things store** — see D-008. AppleScript is the supported and narrower-scoped surface.
- **TS strict + `noUncheckedIndexedAccess`** — runtime safety from compile-time errors. Don't disable.

## If you're adding a new tool

1. Add the Zod input schema to `src/types.ts`.
2. Write the handler in the appropriate `src/tools/*.ts` (or a new file if it's a new tier).
3. Register in the `TOOLS` array of `src/tools/index.ts` with `name`, `description`, `inputSchema`, `requiresToken`, `handler`.
4. Add a policy entry in `config/policy.default.yaml`.
5. Add a unit test in `src/test/` — at minimum, schema validation (valid example parses, invalid rejects). URL-building tools also test the URL output shape.
6. Update the README tools table if user-facing.

## If you're adding a new AppleScript query

1. Use the shared `AS_HELPERS` block in `src/applescript.ts`. Don't redefine `safeStr`, `isoDate`, `isoDateTime`, or `todoRow`.
2. TSV output uses `\t` between fields and `␞` (RECORD SEPARATOR) between rows.
3. If your query returns notes (or any free-text field that can contain tabs/newlines), use the `␃NOTES_BEGIN␃...␄NOTES_END␄` sentinel pattern — see `getProjectDetail` for the reference implementation.
4. Always wrap the AppleScript lookup in `try`/`on error return ""` so a missing item returns empty rather than throwing.

## Style

- Prose comments over heavy JSDoc tags.
- Module-level doc comments at the top of each `src/*.ts` file explain what it does and any non-obvious constraints.
- Error messages include the fix command when actionable (see `keychain.ts` and `audit-view.ts` for the pattern — a malformed audit-key error prints the exact `security` command to reset it).
- No emoji in source files.
- No `console.log` in production code paths. `process.stderr.write` for boot diagnostics; `audit.logCall` for tool calls.

## Common pitfalls

- **Tool not appearing in `/mcp` after `npm run build`.** Restart Cowork / Claude Desktop. MCP server registration loads on client startup.
- **`security: SecKeychainSearchCopyNext` errors.** The Keychain item doesn't exist for this account. See the error message — it prints the exact command to seed.
- **AppleScript hangs or times out.** Things3 isn't running, or macOS Automation permission was denied. Check System Settings → Privacy & Security → Automation.
- **Audit log empty after several tool calls.** Init probably failed. Check stderr for "audit log write failed" — usually a Keychain access issue.
