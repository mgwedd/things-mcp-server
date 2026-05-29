/**
 * Tool registry. Maps tool name → { description, input schema, handler }.
 *
 * The wrapper `executeTool` applies policy (allow/dry-run/deny + rate limits)
 * and writes the audit row regardless of outcome.
 */

import { z, ZodTypeAny } from "zod";
import { logCall } from "../audit.js";
import { checkAndRecordRateLimit, getToolPolicy } from "../policy.js";
import {
  AddProjectInput,
  AddTodoInput,
  BulkCreateInput,
  BulkReorganizeInput,
  CloneProjectInput,
  CompleteTodoInput,
  FindTodosInput,
  GetProjectInput,
  ListByDeadlineInput,
  ListTodosInput,
  RescheduleInput,
  SearchInput,
  ShowInput,
  UpdateProjectInput,
  UpdateTodoInput,
} from "../types.js";
import { addProject, addTodo } from "./add.js";
import { bulkCreate, bulkReorganize } from "./bulk.js";
import { findTodos, getProject, listAreas, listByDeadline, listTags, listTodos } from "./find.js";
import { search, show } from "./show.js";
import { getSnapshot, SnapshotInput } from "./snapshot.js";
import { cloneProject, completeTodo, reschedule, updateProject, updateTodo } from "./update.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  /**
   * Whether this tool requires the Things auth-token (reorganize tools).
   * Used to drive sensitivity hints in the MCP advertisement.
   */
  requiresToken: boolean;
  /**
   * Handler. `dryRun` is true when policy decision was "dry-run".
   */
  handler: (args: any, dryRun: boolean) => Promise<unknown>;
}

export const TOOLS: ToolDef[] = [
  // ---- capture ----
  {
    name: "add_todo",
    description:
      "Create a new to-do in Things. If `list` is omitted and `when` is omitted, goes to Inbox. " +
      "Use `titles` to create multiple at once.",
    inputSchema: AddTodoInput,
    requiresToken: false,
    handler: (a, d) => addTodo(a, d),
  },
  {
    name: "add_project",
    description: "Create a new project in Things, optionally inside an Area, with initial to-dos.",
    inputSchema: AddProjectInput,
    requiresToken: false,
    handler: (a, d) => addProject(a, d),
  },
  {
    name: "bulk_create",
    description:
      "Bulk-create projects, headings, to-dos, and checklist items in one call using the Things JSON spec. " +
      "Create operations only; use bulk_reorganize for updates.",
    inputSchema: BulkCreateInput,
    requiresToken: false,
    handler: (a, d) => bulkCreate(a, d),
  },

  // ---- reorganize (token required) ----
  {
    name: "update_todo",
    description:
      "Modify an existing to-do by ID. Include only fields you want to change; pass '' to clear a field.",
    inputSchema: UpdateTodoInput,
    requiresToken: true,
    handler: (a, d) => updateTodo(a, d),
  },
  {
    name: "update_project",
    description: "Modify an existing project by ID.",
    inputSchema: UpdateProjectInput,
    requiresToken: true,
    handler: (a, d) => updateProject(a, d),
  },
  {
    name: "complete_todo",
    description: "Mark a to-do complete.",
    inputSchema: CompleteTodoInput,
    requiresToken: true,
    handler: (a, d) => completeTodo(a, d),
  },
  {
    name: "reschedule",
    description: "Change the `when` of an existing to-do. Pass '' to clear.",
    inputSchema: RescheduleInput,
    requiresToken: true,
    handler: (a, d) => reschedule(a, d),
  },
  {
    name: "bulk_reorganize",
    description:
      "Bulk-update items using the Things JSON spec. Auth-token is injected automatically. " +
      "Each item should include `operation: 'update'` and an `id`.",
    inputSchema: BulkReorganizeInput,
    requiresToken: true,
    handler: (a, d) => bulkReorganize(a, d),
  },

  // ---- read ----
  {
    name: "list_todos",
    description:
      "Read to-dos from a source list. `from` accepts: " +
      "'inbox', 'today' (includes This Evening), 'anytime', 'upcoming', 'someday', 'logbook', " +
      "'area' (needs name), 'tag' (needs name), 'project' (needs name or id). " +
      "Each to-do includes its activation datetime — when a reminder time is set, the activationDate field " +
      "is yyyy-mm-ddTHH:MM; otherwise date-only.",
    inputSchema: ListTodosInput,
    requiresToken: false,
    handler: (a) => listTodos(a),
  },
  {
    name: "find_todos",
    description: "Substring search across to-do names and notes (Anytime list). Returns up to `max` (default 50).",
    inputSchema: FindTodosInput,
    requiresToken: false,
    handler: (a) => findTodos(a),
  },
  {
    name: "get_project",
    description:
      "Return full detail for a single project: id, name, area, status, headings, todo count, due date, " +
      "activation date, tags, AND the project's notes body. Use this for context-loading rentals, big initiatives, " +
      "or anything where you've stashed reference info in the project's notes field.",
    inputSchema: GetProjectInput,
    requiresToken: false,
    handler: (a) => getProject(a),
  },
  {
    name: "list_by_deadline_window",
    description:
      "Return to-dos whose deadline is on or before (today + daysAhead). Sorted by deadline ascending. " +
      "Use for 'what's due in the next N days?' workflows. Default window: 7 days.",
    inputSchema: ListByDeadlineInput,
    requiresToken: false,
    handler: (a) => listByDeadline(a),
  },
  {
    name: "list_areas",
    description: "All Area names defined in Things.",
    inputSchema: z.object({}),
    requiresToken: false,
    handler: () => listAreas(),
  },
  {
    name: "list_tags",
    description: "All tag names defined in Things.",
    inputSchema: z.object({}),
    requiresToken: false,
    handler: () => listTags(),
  },

  // ---- snapshot + clone (templates-as-projects pattern) ----
  {
    name: "snapshot",
    description:
      "Return the current Things state: Areas, Tags, and Projects. " +
      "Backed by a 60-second in-memory cache; pass `force: true` to bypass. " +
      "Call this once at the start of a conversation to ground subsequent operations.",
    inputSchema: SnapshotInput,
    requiresToken: false,
    handler: (a) => getSnapshot(a),
  },
  {
    name: "clone_project",
    description:
      "Duplicate an existing project (with all headings + child to-dos) and rename / relocate the clone. " +
      "Pattern: keep 'Template: New Rental', 'Template: Camping Trip' etc. as projects in a Templates Area, " +
      "then call this tool to instantiate them. Templates live in Things, editable on any device.",
    inputSchema: CloneProjectInput,
    requiresToken: true,
    handler: (a, d) => cloneProject(a, d),
  },

  // ---- navigation ----
  {
    name: "show",
    description:
      "Navigate the Things UI to a list, area, project, tag, or to-do. " +
      "Use built-in list IDs like 'inbox', 'today', 'upcoming', or pass a `query` like 'Camper'.",
    inputSchema: ShowInput,
    requiresToken: false,
    handler: (a, d) => show(a, d),
  },
  {
    name: "search",
    description: "Open the Things search UI, optionally with a query.",
    inputSchema: SearchInput,
    requiresToken: false,
    handler: (a, d) => search(a, d),
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export interface ToolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  policyDecision: string;
}

/**
 * Execute a named tool with policy + audit. Validates input via the tool's
 * Zod schema before dispatch.
 */
export async function executeTool(name: string, rawArgs: unknown): Promise<ToolCallResult> {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${name}`, policyDecision: "n/a" };
  }

  const policy = getToolPolicy(name);
  const start = Date.now();

  // Deny first — don't even parse the args.
  if (policy.decision === "deny") {
    logCall({
      tool: name,
      args: rawArgs,
      outcome: "denied",
      durationMs: Date.now() - start,
      policyDecision: policy.decision,
    });
    return { ok: false, error: `Policy denied tool: ${name}`, policyDecision: policy.decision };
  }

  // Validate input.
  const parsed = tool.inputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    logCall({
      tool: name,
      args: rawArgs,
      outcome: "error",
      error: `input validation: ${msg}`,
      durationMs: Date.now() - start,
      policyDecision: policy.decision,
    });
    return { ok: false, error: `Invalid input: ${msg}`, policyDecision: policy.decision };
  }

  // Rate limit.
  if (policy.rateLimit && !checkAndRecordRateLimit(name, policy.rateLimit)) {
    const limStr = `${policy.rateLimit.count}/${policy.rateLimit.perSeconds}s`;
    logCall({
      tool: name,
      args: parsed.data,
      outcome: "denied",
      error: `rate limit exceeded (${limStr})`,
      durationMs: Date.now() - start,
      policyDecision: policy.decision,
    });
    return {
      ok: false,
      error: `Rate limit exceeded for ${name}: ${limStr}`,
      policyDecision: policy.decision,
    };
  }

  const dryRun = policy.decision === "dry-run";

  try {
    const data = await tool.handler(parsed.data, dryRun);
    logCall({
      tool: name,
      args: parsed.data,
      outcome: dryRun ? "dry-run" : "ok",
      durationMs: Date.now() - start,
      policyDecision: policy.decision,
    });
    return { ok: true, data, policyDecision: policy.decision };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logCall({
      tool: name,
      args: parsed.data,
      outcome: "error",
      error: msg,
      durationMs: Date.now() - start,
      policyDecision: policy.decision,
    });
    return { ok: false, error: msg, policyDecision: policy.decision };
  }
}
