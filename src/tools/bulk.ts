/**
 * Bulk tools — multi-item operations using things:///json.
 *
 * `bulk_create` requires no token (create-only). `bulk_reorganize` injects
 * the token automatically and refuses if any item lacks `operation: "update"`.
 */

import { z } from "zod";
import { getThingsToken } from "../keychain.js";
import { buildJsonUrl, openUrl } from "../things-url.js";
import { BulkCreateInput, BulkReorganizeInput } from "../types.js";
import type { ToolResult } from "./add.js";

export async function bulkCreate(args: z.infer<typeof BulkCreateInput>, dryRun: boolean): Promise<ToolResult> {
  // Defense: ensure no item carries operation: "update" in a create-only flow.
  for (const item of args.data) {
    if (typeof item === "object" && item !== null) {
      const op = (item as Record<string, unknown>).operation;
      if (op === "update") {
        throw new Error(
          "bulk_create cannot perform update operations. Use bulk_reorganize for updates.",
        );
      }
    }
  }
  const url = buildJsonUrl(args.data, undefined, args.reveal);
  if (dryRun) return { url, message: "Dry run — URL not invoked.", dryRun: true };
  await openUrl(url);
  return { url, message: `Bulk-created ${args.data.length} top-level item(s).` };
}

export async function bulkReorganize(
  args: z.infer<typeof BulkReorganizeInput>,
  dryRun: boolean,
): Promise<ToolResult> {
  const token = await getThingsToken();
  const url = buildJsonUrl(args.data, token, args.reveal);
  if (dryRun) {
    // Don't include the token in the dry-run output.
    const safeUrl = buildJsonUrl(args.data, "[REDACTED]", args.reveal);
    return { url: safeUrl, message: "Dry run — URL not invoked. Token redacted.", dryRun: true };
  }
  await openUrl(url);
  return { url: "[contains auth-token, omitted from response]", message: `Bulk-reorganized ${args.data.length} item(s).` };
}
