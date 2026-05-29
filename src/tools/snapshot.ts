/**
 * MCP tool wrapper for the Things state snapshot.
 *
 * The snapshot is read-only consolidation of Areas / Tags / Projects-with-
 * headings from Things via AppleScript, backed by an in-memory TTL cache.
 *
 * For project bootstrapping (new rental, new trip, etc.), DON'T add YAML
 * templates here. Instead, keep a "Templates" Area in Things itself with
 * reference projects, and use `clone_project` (see tools/update.ts) to
 * duplicate them — Things' URL scheme supports `duplicate=true` on the
 * update-project command natively.
 */

import { z } from "zod";
import { snapshot } from "../snapshot.js";

export const SnapshotInput = z.object({
  force: z.boolean().optional().default(false).describe("Bypass cache; re-read from Things."),
  includeProjects: z.boolean().optional().default(true).describe("Include projects in the snapshot (heavier query)."),
});

export async function getSnapshot(args: z.infer<typeof SnapshotInput>): Promise<unknown> {
  return snapshot({
    force: args.force,
    includeProjects: args.includeProjects,
  });
}
