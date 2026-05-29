/**
 * Reorganize tools — modify existing to-dos and projects. Auth-token required.
 */

import { z } from "zod";
import { getThingsToken } from "../keychain.js";
import {
  buildUpdateProjectUrl,
  buildUpdateUrl,
  openUrl,
} from "../things-url.js";
import {
  CloneProjectInput,
  CompleteTodoInput,
  RescheduleInput,
  UpdateProjectInput,
  UpdateTodoInput,
} from "../types.js";
import type { ToolResult } from "./add.js";

function redactUrl(url: string): string {
  return url.replace(/auth-token=[^&]+/, "auth-token=[REDACTED]");
}

export async function updateTodo(
  args: z.infer<typeof UpdateTodoInput>,
  dryRun: boolean,
): Promise<ToolResult> {
  const token = await getThingsToken();
  const url = buildUpdateUrl(args, token);
  if (dryRun) {
    return {
      url: redactUrl(url),
      message: "Dry run — URL not invoked. Token redacted.",
      dryRun: true,
    };
  }
  await openUrl(url);
  return { url: redactUrl(url), message: `Updated to-do ${args.id}` };
}

export async function updateProject(
  args: z.infer<typeof UpdateProjectInput>,
  dryRun: boolean,
): Promise<ToolResult> {
  const token = await getThingsToken();
  const url = buildUpdateProjectUrl(args, token);
  if (dryRun) {
    return {
      url: redactUrl(url),
      message: "Dry run — URL not invoked. Token redacted.",
      dryRun: true,
    };
  }
  await openUrl(url);
  return { url: redactUrl(url), message: `Updated project ${args.id}` };
}

export async function completeTodo(
  args: z.infer<typeof CompleteTodoInput>,
  dryRun: boolean,
): Promise<ToolResult> {
  return updateTodo({ id: args.id, completed: true }, dryRun);
}

export async function reschedule(
  args: z.infer<typeof RescheduleInput>,
  dryRun: boolean,
): Promise<ToolResult> {
  return updateTodo({ id: args.id, when: args.when }, dryRun);
}

/**
 * Duplicate an existing project (including all its headings + child to-dos)
 * and rename / relocate the clone. Uses Things' native `duplicate=true` on
 * the update-project URL command — the original is untouched.
 *
 * Pattern: keep "Template: New Rental", "Template: Camping Trip" etc. as
 * normal projects under a "Templates" Area in Things itself. Call this tool
 * to instantiate them. Templates live in Things, on every device, editable
 * in the app. No parallel definition.
 */
export async function cloneProject(
  args: z.infer<typeof CloneProjectInput>,
  dryRun: boolean,
): Promise<ToolResult> {
  const token = await getThingsToken();
  const url = buildUpdateProjectUrl(
    {
      id: args.id,
      duplicate: true,
      title: args.title,
      ...(args.area !== undefined ? { area: args.area } : {}),
      ...(args.areaId !== undefined ? { areaId: args.areaId } : {}),
      ...(args.when !== undefined ? { when: args.when } : {}),
      ...(args.deadline !== undefined ? { deadline: args.deadline } : {}),
      ...(args.addTags !== undefined ? { addTags: args.addTags } : {}),
    },
    token,
  );
  if (dryRun) {
    return {
      url: redactUrl(url),
      message: "Dry run — clone URL not invoked. Token redacted.",
      dryRun: true,
    };
  }
  await openUrl(url);
  return {
    url: redactUrl(url),
    message: `Cloned project ${args.id} → "${args.title}"${args.area ? ` in ${args.area}` : ""}`,
  };
}
