/**
 * Capture tools — create new to-dos and projects. No auth-token required.
 */

import { z } from "zod";
import { buildAddProjectUrl, buildAddUrl, openUrl } from "../things-url.js";
import { AddProjectInput, AddTodoInput } from "../types.js";

export interface ToolResult {
  url?: string;
  message: string;
  dryRun?: boolean;
}

export async function addTodo(args: z.infer<typeof AddTodoInput>, dryRun: boolean): Promise<ToolResult> {
  const url = buildAddUrl(args);
  if (dryRun) return { url, message: "Dry run — URL not invoked.", dryRun: true };
  await openUrl(url);
  return {
    url,
    message: args.titles
      ? `Created ${args.titles.length} to-dos.`
      : `Created to-do: ${args.title ?? "(no title)"}`,
  };
}

export async function addProject(args: z.infer<typeof AddProjectInput>, dryRun: boolean): Promise<ToolResult> {
  const url = buildAddProjectUrl(args);
  if (dryRun) return { url, message: "Dry run — URL not invoked.", dryRun: true };
  await openUrl(url);
  return {
    url,
    message: `Created project: ${args.title}${args.area ? ` in ${args.area}` : ""}${
      args.todos ? ` with ${args.todos.length} to-dos` : ""
    }`,
  };
}
