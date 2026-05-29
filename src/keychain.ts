/**
 * Generic macOS Keychain accessor.
 *
 * Two secrets live under service "com.thingsmcp":
 *   - account "auth-token"  — the Things URL scheme auth-token (user-provided)
 *   - account "audit-key"   — 256-bit key for SQLCipher-encrypted audit DB
 *                             (auto-generated on first run)
 *
 * Set the Things token manually:
 *
 *   security add-generic-password -s "com.thingsmcp" -a "auth-token" -U -w
 *
 * On first read, macOS prompts to allow access. Clicking "Always Allow"
 * whitelists this node binary path for the item.
 *
 * Secrets are cached in memory after first read and zeroed on shutdown.
 * They are never written to any file or log by this server.
 */

import { spawn } from "node:child_process";

const SERVICE = "com.thingsmcp";
const ACCOUNT_TOKEN = "auth-token";
const ACCOUNT_AUDIT_KEY = "audit-key";

export class KeychainError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "KeychainError";
  }
}

const cache = new Map<string, string>();

/**
 * Read a secret from Keychain by account. Cached after first read.
 */
export async function getSecret(account: string): Promise<string> {
  const existing = cache.get(account);
  if (existing !== undefined) return existing;
  const value = await readFromKeychain(account);
  cache.set(account, value);
  return value;
}

/**
 * Write a secret to Keychain. `-U` updates if it exists. The value is passed
 * via argv, which is briefly visible to other processes on the same host that
 * can read /proc-equivalent process info (i.e., the same user or root). For
 * machine-generated secrets (like the audit key) this is acceptable; for
 * user-provided secrets (like the Things token) the user runs `security`
 * manually with `-w` and no value, prompting interactively.
 */
export async function setSecret(account: string, value: string): Promise<void> {
  await runSecurity([
    "add-generic-password",
    "-s", SERVICE,
    "-a", account,
    "-U",
    "-w", value,
  ]);
  cache.set(account, value);
}

/**
 * Returns true if the named secret exists in Keychain.
 */
export async function hasSecret(account: string): Promise<boolean> {
  try {
    await readFromKeychain(account);
    return true;
  } catch (err) {
    if (err instanceof KeychainError && /No .+ in Keychain|item not found/i.test(err.message)) {
      return false;
    }
    throw err;
  }
}

/**
 * Zero all cached secrets. Call on SIGTERM / shutdown.
 */
export function clearSecretCache(): void {
  cache.clear();
}

// --------- thin wrappers for the two well-known accounts ------------------

export function getThingsToken(): Promise<string> {
  return getSecret(ACCOUNT_TOKEN);
}

export function getAuditKey(): Promise<string> {
  return getSecret(ACCOUNT_AUDIT_KEY);
}

export const KNOWN_ACCOUNTS = {
  token: ACCOUNT_TOKEN,
  auditKey: ACCOUNT_AUDIT_KEY,
} as const;

// ---------------------------- internals -----------------------------------

async function readFromKeychain(account: string): Promise<string> {
  const { stdout } = await runSecurity([
    "find-generic-password",
    "-s", SERVICE,
    "-a", account,
    "-w",
  ]);
  const value = stdout.trim();
  if (!value) {
    throw new KeychainError(
      `Keychain returned empty value for "${account}" under service "${SERVICE}".`,
    );
  }
  return value;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

function runSecurity(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("security", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    proc.on("error", (err) => {
      reject(new KeychainError(
        `Failed to spawn 'security': ${err.message}. Is this macOS?`,
        err,
      ));
    });
    proc.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });

      // Common error: item not found
      if (/SecKeychainSearchCopyNext|could not be found|item not found|specified item/i.test(stderr)) {
        // Try to extract account from args for a helpful message.
        const aIdx = args.indexOf("-a");
        const account = aIdx >= 0 ? args[aIdx + 1] : "<unknown>";
        return reject(new KeychainError(
          `No "${account}" in Keychain (service "${SERVICE}").\n` +
          `Set it with:\n` +
          `  security add-generic-password -s "${SERVICE}" -a "${account}" -U -w`,
        ));
      }

      reject(new KeychainError(
        `'security' exited ${code}. stderr: ${stderr.trim()}`,
      ));
    });
  });
}
