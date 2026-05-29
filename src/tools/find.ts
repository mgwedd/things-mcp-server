/**
 * Read tools — query Things via AppleScript. No auth-token, but Automation
 * permission must be granted on first run.
 */

import { z } from "zod";
import {
  getAreaNames,
  getProjectDetail,
  getTagNames,
  getTodos,
  getTodosByDeadlineWindow,
  getTodosForProject,
  searchTodos,
  type ProjectDetail,
  type TodoSummary,
} from "../applescript.js";
import {
  FindTodosInput,
  GetProjectInput,
  ListByDeadlineInput,
  ListTodosInput,
} from "../types.js";

export interface ListResult {
  count: number;
  items: TodoSummary[];
}

const BUILTIN_LIST_MAP: Record<string, string> = {
  inbox: "Inbox",
  today: "Today",
  anytime: "Anytime",
  upcoming: "Upcoming",
  someday: "Someday",
  logbook: "Logbook",
};

/**
 * Unified to-do listing. Drives Inbox/Today/Anytime/Upcoming/Someday/Logbook
 * built-in lists, plus by-area / by-tag / by-project filters.
 */
export async function listTodos(args: z.infer<typeof ListTodosInput>): Promise<ListResult> {
  let items: TodoSummary[];
  switch (args.from) {
    case "inbox":
    case "today":
    case "anytime":
    case "upcoming":
    case "someday":
    case "logbook":
      items = await getTodos(BUILTIN_LIST_MAP[args.from]!);
      break;
    case "area":
      if (!args.name) throw new Error("from='area' requires `name`.");
      items = (await getTodos("Anytime")).filter((t) => t.area === args.name);
      break;
    case "tag":
      if (!args.name) throw new Error("from='tag' requires `name`.");
      items = (await getTodos("Anytime")).filter((t) => t.tags.includes(args.name!));
      break;
    case "project":
      if (!args.id && !args.name) throw new Error("from='project' requires `name` or `id`.");
      items = args.id
        ? await getTodosForProject({ id: args.id })
        : await getTodosForProject({ name: args.name! });
      break;
  }
  return { count: items.length, items };
}

export async function findTodos(args: z.infer<typeof FindTodosInput>): Promise<ListResult> {
  const items = await searchTodos(args.query, args.max);
  return { count: items.length, items };
}

export async function getProject(args: z.infer<typeof GetProjectInput>): Promise<ProjectDetail> {
  const detail = args.id
    ? await getProjectDetail({ id: args.id })
    : await getProjectDetail({ name: args.name! });
  if (!detail) {
    const ref = args.id ? `id ${args.id}` : `name "${args.name}"`;
    throw new Error(`Project not found: ${ref}`);
  }
  return detail;
}

export async function listByDeadline(args: z.infer<typeof ListByDeadlineInput>): Promise<ListResult> {
  const items = await getTodosByDeadlineWindow(args.daysAhead);
  return { count: items.length, items };
}

export async function listAreas(): Promise<{ count: number; areas: string[] }> {
  const areas = await getAreaNames();
  return { count: areas.length, areas };
}

export async function listTags(): Promise<{ count: number; tags: string[] }> {
  const tags = await getTagNames();
  return { count: tags.length, tags };
}
