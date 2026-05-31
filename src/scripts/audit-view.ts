#!/usr/bin/env node
/**
 * things-audit — view decrypted audit log rows.
 *
 * Usage:
 *   things-audit                            # last 20 rows, pretty
 *   things-audit --tail 50
 *   things-audit --tool add_todo --tail 100
 *   things-audit --outcome error
 *   things-audit --since 2026-05-20
 *   things-audit --json                     # JSON output (for piping into jq)
 *
 * Reads the SQLCipher-equivalent field-level-encrypted audit DB. Will trigger
 * a Keychain access prompt the first time if `node` isn't whitelisted for
 * the `audit-key` item.
 */

import Database from "better-sqlite3";
import { decryptField, keyFromHex } from "../crypto.js";
import { DB_PATH } from "../audit.js";
import { getAuditKey } from "../keychain.js";

interface Args {
  tail: number;
  tool?: string;
  outcome?: "ok" | "denied" | "error" | "dry-run";
  since?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { tail: 20, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--tail":
        out.tail = parseInt(argv[++i] ?? "20", 10);
        break;
      case "--tool":
        out.tool = argv[++i];
        break;
      case "--outcome": {
        const v = argv[++i];
        if (v === "ok" || v === "denied" || v === "error" || v === "dry-run") out.outcome = v;
        else throw new Error(`Invalid --outcome: ${v}`);
        break;
      }
      case "--since":
        out.since = argv[++i];
        break;
      case "--json":
        out.json = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(`things-audit — view decrypted audit log.

Options:
  --tail N           Show the last N rows (default 20)
  --tool NAME        Filter by tool name (e.g. add_todo)
  --outcome STATE    Filter by outcome: ok | denied | error | dry-run
  --since YYYY-MM-DD Filter to rows from this date onward
  --json             Emit JSON Lines instead of pretty output
  -h, --help         This help
`);
}

interface Row {
  id: number;
  ts: string;
  tool: string;
  args_redacted: string;
  outcome: string;
  error: string | null;
  duration_ms: number;
  policy_decision: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const keyHex = await getAuditKey();
  let keyBuf: Buffer;
  try {
    keyBuf = keyFromHex(keyHex);
  } catch (err) {
    throw new Error(
      `Audit key in Keychain is malformed: ${err instanceof Error ? err.message : err}.\n\n` +
      `If you have no audit data to preserve (typical on first setup or after a botched seed), reset with:\n\n` +
      `  security delete-generic-password -s com.thingsmcp -a audit-key 2>/dev/null\n` +
      `  security add-generic-password -s com.thingsmcp -a audit-key -U -w "$(openssl rand -hex 32)"\n\n` +
      `WARNING: regenerating the key makes any existing encrypted audit rows undecryptable.`,
    );
  }

  const db = new Database(DB_PATH, { readonly: true });

  const where: string[] = [];
  const params: Record<string, string> = {};
  if (args.tool) { where.push("tool = $tool"); params.tool = args.tool; }
  if (args.outcome) { where.push("outcome = $outcome"); params.outcome = args.outcome; }
  if (args.since) { where.push("ts >= $since"); params.since = args.since; }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT id, ts, tool, args_redacted, outcome, error, duration_ms, policy_decision
    FROM audit_log
    ${whereSql}
    ORDER BY id DESC
    LIMIT $limit
  `;
  const rows = db
    .prepare(sql)
    .all({ ...params, limit: args.tail }) as Row[];

  // Reverse so oldest is first in output — easier to read top-down.
  rows.reverse();

  for (const row of rows) {
    let argsDecoded: unknown;
    try {
      argsDecoded = JSON.parse(decryptField(keyBuf, row.args_redacted, row.tool));
    } catch (err) {
      argsDecoded = { _decrypt_error: err instanceof Error ? err.message : String(err) };
    }
    let errorDecoded: string | null = null;
    if (row.error) {
      try {
        errorDecoded = decryptField(keyBuf, row.error, row.tool);
      } catch (err) {
        errorDecoded = `[decrypt failed: ${err instanceof Error ? err.message : err}]`;
      }
    }

    if (args.json) {
      process.stdout.write(JSON.stringify({
        id: row.id,
        ts: row.ts,
        tool: row.tool,
        outcome: row.outcome,
        policy: row.policy_decision,
        duration_ms: row.duration_ms,
        args: argsDecoded,
        error: errorDecoded,
      }) + "\n");
    } else {
      const outcomeColor = row.outcome === "ok" ? "\x1b[32m" :
        row.outcome === "error" ? "\x1b[31m" :
        row.outcome === "denied" ? "\x1b[33m" : "\x1b[36m";
      process.stdout.write(
        `\x1b[2m#${row.id} ${row.ts}\x1b[0m  ` +
        `${outcomeColor}${row.outcome.padEnd(7)}\x1b[0m  ` +
        `\x1b[1m${row.tool}\x1b[0m  ` +
        `(${row.duration_ms}ms, policy=${row.policy_decision})\n`,
      );
      process.stdout.write(
        `    args: ${JSON.stringify(argsDecoded)}\n`,
      );
      if (errorDecoded) {
        process.stdout.write(`    error: ${errorDecoded}\n`);
      }
    }
  }

  if (!args.json) {
    process.stdout.write(`\n\x1b[2m${rows.length} row(s)\x1b[0m\n`);
  }

  keyBuf.fill(0);
  db.close();
}

main().catch((err) => {
  process.stderr.write(`things-audit: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
