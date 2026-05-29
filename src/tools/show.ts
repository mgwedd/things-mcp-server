/**
 * Navigation tools — make the Things UI navigate to a list / item / search.
 * No auth-token required.
 */

import { z } from "zod";
import { buildSearchUrl, buildShowUrl, openUrl } from "../things-url.js";
import { SearchInput, ShowInput } from "../types.js";
import type { ToolResult } from "./add.js";

export async function show(args: z.infer<typeof ShowInput>, dryRun: boolean): Promise<ToolResult> {
  const url = buildShowUrl(args);
  if (dryRun) return { url, message: "Dry run — URL not invoked.", dryRun: true };
  await openUrl(url);
  return { url, message: `Navigated Things to: ${args.id ?? args.query ?? "(home)"}` };
}

export async function search(args: z.infer<typeof SearchInput>, dryRun: boolean): Promise<ToolResult> {
  const url = buildSearchUrl(args);
  if (dryRun) return { url, message: "Dry run — URL not invoked.", dryRun: true };
  await openUrl(url);
  return { url, message: `Opened search${args.query ? ` for: ${args.query}` : ""}` };
}
