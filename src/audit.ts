/**
 * Append-only audit log of every tool call.
 *
 * Plain `better-sqlite3` (reliable prebuilts) with field-level AES-256-GCM
 * encryption on `args_redacted` and `error` columns. The encryption key is
 * a 256-bit random value held in macOS Keychain under service "com.thingsmcp",
 * account "audit-key". Generated on first run.
 *
 * What's visible to anyone with file read access (low sensitivity):
 *   id, ts, tool, outcome, duration_ms, policy_decision
 *
 * What's ciphertext (requires Keychain audit-key to read):
 *   args_redacted, error
 *
 * To view the encrypted columns, use `things-audit` (or `npm run audit`).
 * To run aggregate queries without decryption, use plain sqlite3:
 *
 *   sqlite3 ~/Library/Application\ Support/things-mcp/audit.db \
 *     'SELECT tool, COUNT(*), AVG(duration_ms) FROM audit_log GROUP BY tool;'
 */

import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { encryptField, keyFromHex } from "./crypto.js";
import { getAuditKey, hasSecret, KNOWN_ACCOUNTS, setSecret } from "./keychain.js";
import { redactArgs } from "./redact.js";

const SUPPORT_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "things-mcp",
);
export const DB_PATH = join(SUPPORT_DIR, "audit.db");

let db: Database.Database | null = null;
let keyBuf: Buffer | null = null;
let initPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (db && keyBuf) return;
  if (initPromise) return initPromise;
  initPromise = init();
  await initPromise;
}

async function init(): Promise<void> {
  mkdirSync(SUPPORT_DIR, { recursive: true });

  // Ensure an audit key exists. If not, generate 256 bits and store it.
  if (!(await hasSecret(KNOWN_ACCOUNTS.auditKey))) {
    const key = randomBytes(32).toString("hex");
    await setSecret(KNOWN_ACCOUNTS.auditKey, key);
  }
  const keyHex = await getAuditKey();
  try {
    keyBuf = keyFromHex(keyHex);
  } catch (err) {
    throw new Error(
      `Audit key in Keychain is malformed: ${err instanceof Error ? err.message : err}.\n` +
      `Reset (loses existing audit history):\n` +
      `  security delete-generic-password -s com.thingsmcp -a audit-key 2>/dev/null\n` +
      `  security add-generic-password -s com.thingsmcp -a audit-key -U -w "$(openssl rand -hex 32)"`,
    );
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ts              TEXT NOT NULL,
      tool            TEXT NOT NULL,
      args_redacted   TEXT NOT NULL,  -- base64 AES-256-GCM ciphertext, AAD = tool
      outcome         TEXT NOT NULL CHECK (outcome IN ('ok', 'denied', 'error', 'dry-run')),
      error           TEXT,           -- base64 AES-256-GCM ciphertext when non-null, AAD = tool
      duration_ms     INTEGER NOT NULL,
      policy_decision TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
    CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_log(tool);
  `);
}

export interface AuditRecord {
  tool: string;
  args: unknown;
  outcome: "ok" | "denied" | "error" | "dry-run";
  error?: string;
  durationMs: number;
  policyDecision: string;
}

/**
 * Append a row to the audit log. Fire-and-forget from the caller's
 * perspective — failures are logged to stderr but do not surface to the
 * tool result, since failing to log is not a reason to fail the call.
 */
export function logCall(record: AuditRecord): void {
  ensureInit()
    .then(() => {
      if (!db || !keyBuf) return;
      const ts = new Date().toISOString();
      const redactedJson = JSON.stringify(redactArgs(record.args));
      const argsCt = encryptField(keyBuf, redactedJson, record.tool);
      const errorCt = record.error
        ? encryptField(keyBuf, record.error, record.tool)
        : null;

      const stmt = db.prepare(`
        INSERT INTO audit_log (ts, tool, args_redacted, outcome, error, duration_ms, policy_decision)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        ts,
        record.tool,
        argsCt,
        record.outcome,
        errorCt,
        record.durationMs,
        record.policyDecision,
      );
    })
    .catch((err) => {
      process.stderr.write(
        `things-mcp: audit log write failed: ${err instanceof Error ? err.message : err}\n`,
      );
    });
}

export function closeAuditDb(): void {
  if (db) {
    try { db.close(); } catch { /* best-effort */ }
    db = null;
  }
  if (keyBuf) {
    keyBuf.fill(0);
    keyBuf = null;
  }
  initPromise = null;
}

// Redaction logic lives in ./redact.ts so it's independently testable.
