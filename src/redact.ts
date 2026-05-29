/**
 * Audit-log redaction. Runs BEFORE field-level encryption, so even if the
 * audit-key leaks, no content body (title, notes, checklists) is recoverable
 * from the log.
 *
 * Rules:
 *   - Content fields → {sha256, len, type}
 *   - Structural fields (IDs, list/area/tag names, dates, booleans) → literal
 *   - Keys matching /token|password|secret|key|auth/i → "[REDACTED]"
 *   - All other strings/numbers/booleans → literal
 */

import { createHash } from "node:crypto";

export const HASH_FIELDS = new Set([
  "title", "titles",
  "notes", "appendNotes", "prependNotes",
  "checklistItems", "appendChecklistItems", "prependChecklistItems",
]);

export const SECRET_PATTERN = /token|password|secret|key|auth/i;

export interface HashSummary {
  sha256: string;
  len: number;
  type: string;
}

export function redactArgs(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(redactArgs);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
        continue;
      }
      if (HASH_FIELDS.has(k) && v !== undefined && v !== null) {
        out[k] = hashSummary(v);
        continue;
      }
      out[k] = redactArgs(v);
    }
    return out;
  }
  return "[unsupported]";
}

export function hashSummary(v: unknown): HashSummary {
  let str: string;
  let type: string;
  if (Array.isArray(v)) {
    str = v.join("\n");
    type = "array";
  } else if (typeof v === "string") {
    str = v;
    type = "string";
  } else {
    str = JSON.stringify(v);
    type = typeof v;
  }
  return {
    sha256: createHash("sha256").update(str).digest("hex").slice(0, 16),
    len: str.length,
    type,
  };
}
