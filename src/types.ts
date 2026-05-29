/**
 * Zod schemas for tool inputs. Used to validate incoming MCP tool calls
 * before passing arguments to the URL-builder / AppleScript layers.
 */

import { z } from "zod";

// ---------- shared ----------

const When = z
  .string()
  .min(1)
  .describe(
    "When to schedule. One of: 'today', 'tomorrow', 'evening', 'anytime', 'someday', " +
      "a date 'yyyy-mm-dd', or a date+time 'yyyy-mm-dd@HH:MM'. " +
      "Natural language ('next monday', 'in 3 days') also works but must be English.",
  );

const TagList = z
  .array(z.string())
  .describe("Tag names. Tags must already exist in Things; unknown tags are silently ignored.");

// ---------- capture ----------

export const AddTodoInput = z.object({
  title: z.string().optional().describe("Title of the to-do."),
  titles: z.array(z.string()).optional().describe("Create multiple to-dos at once. Takes priority over `title`."),
  notes: z.string().optional().describe("Notes body (max 10,000 chars)."),
  when: When.optional(),
  deadline: z.string().optional().describe("Deadline date 'yyyy-mm-dd'."),
  tags: TagList.optional(),
  checklistItems: z.array(z.string()).optional().describe("Checklist items (max 100)."),
  list: z.string().optional().describe("Title of an Area or Project to add into. If omitted and `when` is also omitted, goes to Inbox."),
  listId: z.string().optional().describe("ID of an Area or Project. Takes precedence over `list`."),
  heading: z.string().optional().describe("Title of a heading within the target project."),
  headingId: z.string().optional(),
  reveal: z.boolean().optional().default(false),
});

export const AddProjectInput = z.object({
  title: z.string().describe("Project title."),
  notes: z.string().optional(),
  when: When.optional(),
  deadline: z.string().optional(),
  tags: TagList.optional(),
  area: z.string().optional().describe("Area title."),
  areaId: z.string().optional(),
  todos: z.array(z.string()).optional().describe("Initial to-dos to create inside the project."),
  reveal: z.boolean().optional().default(false),
});

export const BulkCreateInput = z.object({
  data: z.array(z.unknown()).describe(
    "JSON array per Things JSON spec (https://culturedcode.com/things/support/articles/2803573/). " +
      "Each element is a {type, attributes} object; type is 'to-do', 'project', 'heading', or 'checklist-item'. " +
      "Operation must be 'create' (omit `operation` field) — use bulk_reorganize for updates.",
  ),
  reveal: z.boolean().optional().default(false),
});

// ---------- reorganize ----------

export const UpdateTodoInput = z.object({
  id: z.string().describe("ID of the to-do to update."),
  title: z.string().optional(),
  notes: z.string().optional().describe("Replaces existing notes. Use prependNotes/appendNotes to add."),
  prependNotes: z.string().optional(),
  appendNotes: z.string().optional(),
  when: z.union([When, z.literal("")]).optional().describe("'' clears the field."),
  deadline: z.union([z.string(), z.literal("")]).optional(),
  tags: TagList.optional().describe("Replaces existing tags."),
  addTags: TagList.optional().describe("Appends to existing tags."),
  checklistItems: z.array(z.string()).optional(),
  prependChecklistItems: z.array(z.string()).optional(),
  appendChecklistItems: z.array(z.string()).optional(),
  list: z.string().optional(),
  listId: z.string().optional(),
  heading: z.string().optional(),
  headingId: z.string().optional(),
  completed: z.boolean().optional(),
  canceled: z.boolean().optional(),
  reveal: z.boolean().optional(),
  duplicate: z.boolean().optional().describe("If true, duplicate first then update."),
});

export const UpdateProjectInput = z.object({
  id: z.string(),
  title: z.string().optional(),
  notes: z.string().optional(),
  prependNotes: z.string().optional(),
  appendNotes: z.string().optional(),
  when: z.union([When, z.literal("")]).optional(),
  deadline: z.union([z.string(), z.literal("")]).optional(),
  tags: TagList.optional(),
  addTags: TagList.optional(),
  area: z.string().optional(),
  areaId: z.string().optional(),
  completed: z.boolean().optional(),
  canceled: z.boolean().optional(),
  reveal: z.boolean().optional(),
  duplicate: z.boolean().optional(),
});

export const CompleteTodoInput = z.object({
  id: z.string(),
});

export const CloneProjectInput = z.object({
  id: z.string().describe("ID of the source/template project to duplicate."),
  title: z.string().describe("Title for the new (cloned) project."),
  area: z.string().optional().describe("Area name to place the clone in. Defaults to keeping the source's area."),
  areaId: z.string().optional().describe("Area ID; takes precedence over `area`."),
  when: z.union([When, z.literal("")]).optional().describe("Start date for the new project. '' clears."),
  deadline: z.union([z.string(), z.literal("")]).optional(),
  addTags: TagList.optional().describe("Tags to add to the clone (must exist in Things)."),
});

export const RescheduleInput = z.object({
  id: z.string(),
  when: z.union([When, z.literal("")]),
});

export const BulkReorganizeInput = z.object({
  data: z.array(z.unknown()).describe(
    "JSON array per Things JSON spec, with `operation: 'update'` on items that should be modified. " +
      "Auth-token is automatically injected.",
  ),
  reveal: z.boolean().optional().default(false),
});

// ---------- read ----------

export const FindTodosInput = z.object({
  query: z.string().describe("Substring match against to-do name and notes."),
  max: z.number().int().positive().optional().default(50),
});

export const ListTodosInput = z.object({
  from: z.enum([
    "inbox", "today", "anytime", "upcoming", "someday", "logbook",
    "area", "tag", "project",
  ]).describe(
    "Source list. Built-in lists ('inbox'/'today'/'anytime'/'upcoming'/'someday'/'logbook') need no name. " +
      "'area', 'tag', and 'project' require `name` (or `id` for project).",
  ),
  name: z.string().optional().describe("Area name, tag name, or project name (depending on `from`)."),
  id: z.string().optional().describe("Project ID. Takes precedence over `name` for from='project'."),
});

export const GetProjectInput = z.object({
  name: z.string().optional().describe("Project name. Uses first matching project."),
  id: z.string().optional().describe("Project ID. Takes precedence over `name`."),
}).refine((v) => Boolean(v.name) || Boolean(v.id), {
  message: "Must provide either `name` or `id`.",
});

export const ListByDeadlineInput = z.object({
  daysAhead: z.number().int().min(0).max(365).default(7).describe(
    "Window in days. Returns to-dos whose deadline is on or before (today + daysAhead). Default 7.",
  ),
});

// ---------- show / search ----------

export const ShowInput = z.object({
  id: z.string().optional().describe(
    "Built-in list IDs ('inbox', 'today', 'anytime', 'upcoming', 'someday', 'logbook', 'tomorrow', 'deadlines', 'repeating', 'all-projects', 'logged-projects'), or item/list ID.",
  ),
  query: z.string().optional().describe("Name of an area/project/tag to navigate to. Ignored if `id` is set."),
  filter: z.array(z.string()).optional().describe("Tag names to filter by."),
});

export const SearchInput = z.object({
  query: z.string().optional(),
});
