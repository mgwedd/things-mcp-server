#!/usr/bin/env node
/**
 * things-mcp snapshot — inspect current Things state from the CLI.
 *
 * Things is the source of truth; this is read-only inspection.
 *
 * Usage:
 *   things-mcp-snapshot                    # pretty summary (cache miss → AppleScript)
 *   things-mcp-snapshot --force            # bypass cache
 *   things-mcp-snapshot --json             # JSON to stdout
 *   things-mcp-snapshot --write path.json  # also write to a file (ephemeral)
 *   things-mcp-snapshot --no-projects      # skip the heavier project query
 *
 * First run will prompt macOS Automation permission for Things3.
 */

import { writeFileSync } from "node:fs";
import { snapshot } from "../snapshot.js";

interface Args {
  force: boolean;
  json: boolean;
  write?: string;
  includeProjects: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { force: false, json: false, includeProjects: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--force": out.force = true; break;
      case "--json": out.json = true; break;
      case "--no-projects": out.includeProjects = false; break;
      case "--write":
        out.write = argv[++i];
        if (!out.write) throw new Error("--write requires a path");
        break;
      case "-h":
      case "--help":
        process.stdout.write(`things-mcp snapshot — inspect current Things state.

  --force        bypass cache, re-read from Things
  --json         JSON to stdout
  --write PATH   also write JSON to PATH (ephemeral; not used by the MCP)
  --no-projects  skip the heavier project query
  -h             this help
`);
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const snap = await snapshot({
    force: args.force,
    includeProjects: args.includeProjects,
  });

  if (args.write) {
    writeFileSync(args.write, JSON.stringify(snap, null, 2) + "\n", "utf8");
    process.stderr.write(`Wrote snapshot to ${args.write}\n`);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
    return;
  }

  process.stdout.write(`\x1b[2mTaken at ${snap.takenAt}  (source: ${snap.source})\x1b[0m\n\n`);
  process.stdout.write(`\x1b[1mAreas (${snap.areas.length}):\x1b[0m\n`);
  for (const a of snap.areas) {
    const projCount = snap.projects?.filter((p) => p.area === a.name).length;
    const meta = projCount !== undefined ? `${projCount} project${projCount === 1 ? "" : "s"}, ` : "";
    process.stdout.write(`  ${a.name}\x1b[2m  (${meta}id=${a.id.slice(0, 8)}…)\x1b[0m\n`);
  }
  process.stdout.write(`\n\x1b[1mTags (${snap.tags.length}):\x1b[0m\n`);
  process.stdout.write(`  ${snap.tags.join(", ") || "(none)"}\n`);
  if (snap.projects) {
    process.stdout.write(`\n\x1b[1mProjects (${snap.projects.length}):\x1b[0m\n`);
    for (const p of snap.projects) {
      const headings = p.headings.length ? ` [${p.headings.join(" | ")}]` : "";
      process.stdout.write(`  ${p.area ? `${p.area} › ` : ""}${p.name}\x1b[2m  (${p.todoCount} todo${p.todoCount === 1 ? "" : "s"})\x1b[0m${headings}\n`);
    }
  }
  process.stdout.write("\n");
}

main().catch((err) => {
  process.stderr.write(`snapshot: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
