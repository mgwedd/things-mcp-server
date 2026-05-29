/**
 * Construct and execute things:/// URLs.
 *
 * Reference: https://culturedcode.com/things/support/articles/2803573/
 *
 * Every parameter is properly percent-encoded. The auth-token is only included
 * for commands that require it; capture commands (add, add-project, json-create)
 * never include the token.
 */

import { spawn } from "node:child_process";

// ------------------------------ types --------------------------------------

export type WhenValue =
  | "today"
  | "tomorrow"
  | "evening"
  | "anytime"
  | "someday"
  | string; // also accepts date strings (yyyy-mm-dd) and date-time strings (yyyy-mm-dd@HH:MM)

export interface AddTodoParams {
  title?: string;
  titles?: string[];           // newline-joined; takes priority over title
  notes?: string;
  when?: WhenValue;
  deadline?: string;           // yyyy-mm-dd or natural-language English
  tags?: string[];             // must already exist in Things
  checklistItems?: string[];
  listId?: string;
  list?: string;               // area or project title
  headingId?: string;
  heading?: string;
  completed?: boolean;
  canceled?: boolean;
  reveal?: boolean;
}

export interface AddProjectParams {
  title?: string;
  notes?: string;
  when?: WhenValue;
  deadline?: string;
  tags?: string[];
  areaId?: string;
  area?: string;
  todos?: string[];            // newline-joined
  reveal?: boolean;
}

export interface UpdateTodoParams {
  id: string;
  title?: string;
  notes?: string;
  prependNotes?: string;
  appendNotes?: string;
  when?: WhenValue | "";        // "" clears
  deadline?: string | "";
  tags?: string[];              // replace
  addTags?: string[];           // append
  checklistItems?: string[];    // replace
  prependChecklistItems?: string[];
  appendChecklistItems?: string[];
  listId?: string;
  list?: string;
  headingId?: string;
  heading?: string;
  completed?: boolean;
  canceled?: boolean;
  reveal?: boolean;
  duplicate?: boolean;
}

export interface UpdateProjectParams {
  id: string;
  title?: string;
  notes?: string;
  prependNotes?: string;
  appendNotes?: string;
  when?: WhenValue | "";
  deadline?: string | "";
  tags?: string[];
  addTags?: string[];
  areaId?: string;
  area?: string;
  completed?: boolean;
  canceled?: boolean;
  reveal?: boolean;
  duplicate?: boolean;
}

export interface ShowParams {
  id?: string;        // todo/project/area/tag ID, or built-in list ID
  query?: string;     // name of an area/project/tag, or built-in list
  filter?: string[];  // tag names to filter by
}

export interface SearchParams {
  query?: string;
}

// ----------------------------- URL building --------------------------------

const BASE = "things:///";

function encode(v: string): string {
  return encodeURIComponent(v);
}

function joinNewlines(items: string[]): string {
  return items.join("\n");
}

function build(command: string, params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    // Empty string is meaningful for update (clears a field) — keep it.
    parts.push(`${k}=${encode(v)}`);
  }
  const qs = parts.join("&");
  return qs ? `${BASE}${command}?${qs}` : `${BASE}${command}`;
}

export function buildAddUrl(p: AddTodoParams): string {
  return build("add", {
    title: p.title,
    titles: p.titles ? joinNewlines(p.titles) : undefined,
    notes: p.notes,
    when: p.when,
    deadline: p.deadline,
    tags: p.tags?.join(","),
    "checklist-items": p.checklistItems ? joinNewlines(p.checklistItems) : undefined,
    "list-id": p.listId,
    list: p.list,
    "heading-id": p.headingId,
    heading: p.heading,
    completed: p.completed === undefined ? undefined : String(p.completed),
    canceled: p.canceled === undefined ? undefined : String(p.canceled),
    reveal: p.reveal === undefined ? undefined : String(p.reveal),
  });
}

export function buildAddProjectUrl(p: AddProjectParams): string {
  return build("add-project", {
    title: p.title,
    notes: p.notes,
    when: p.when,
    deadline: p.deadline,
    tags: p.tags?.join(","),
    "area-id": p.areaId,
    area: p.area,
    "to-dos": p.todos ? joinNewlines(p.todos) : undefined,
    reveal: p.reveal === undefined ? undefined : String(p.reveal),
  });
}

export function buildUpdateUrl(p: UpdateTodoParams, authToken: string): string {
  return build("update", {
    "auth-token": authToken,
    id: p.id,
    title: p.title,
    notes: p.notes,
    "prepend-notes": p.prependNotes,
    "append-notes": p.appendNotes,
    when: p.when,
    deadline: p.deadline,
    tags: p.tags?.join(","),
    "add-tags": p.addTags?.join(","),
    "checklist-items": p.checklistItems ? joinNewlines(p.checklistItems) : undefined,
    "prepend-checklist-items": p.prependChecklistItems ? joinNewlines(p.prependChecklistItems) : undefined,
    "append-checklist-items": p.appendChecklistItems ? joinNewlines(p.appendChecklistItems) : undefined,
    "list-id": p.listId,
    list: p.list,
    "heading-id": p.headingId,
    heading: p.heading,
    completed: p.completed === undefined ? undefined : String(p.completed),
    canceled: p.canceled === undefined ? undefined : String(p.canceled),
    reveal: p.reveal === undefined ? undefined : String(p.reveal),
    duplicate: p.duplicate === undefined ? undefined : String(p.duplicate),
  });
}

export function buildUpdateProjectUrl(p: UpdateProjectParams, authToken: string): string {
  return build("update-project", {
    "auth-token": authToken,
    id: p.id,
    title: p.title,
    notes: p.notes,
    "prepend-notes": p.prependNotes,
    "append-notes": p.appendNotes,
    when: p.when,
    deadline: p.deadline,
    tags: p.tags?.join(","),
    "add-tags": p.addTags?.join(","),
    "area-id": p.areaId,
    area: p.area,
    completed: p.completed === undefined ? undefined : String(p.completed),
    canceled: p.canceled === undefined ? undefined : String(p.canceled),
    reveal: p.reveal === undefined ? undefined : String(p.reveal),
    duplicate: p.duplicate === undefined ? undefined : String(p.duplicate),
  });
}

/**
 * Build a things:///json URL. If any item has operation === "update",
 * authToken is required (caller must enforce).
 */
export function buildJsonUrl(data: unknown[], authToken?: string, reveal?: boolean): string {
  const params: Record<string, string | undefined> = {
    data: JSON.stringify(data),
    reveal: reveal === undefined ? undefined : String(reveal),
  };
  if (authToken) params["auth-token"] = authToken;
  return build("json", params);
}

export function buildShowUrl(p: ShowParams): string {
  return build("show", {
    id: p.id,
    query: p.query,
    filter: p.filter?.join(","),
  });
}

export function buildSearchUrl(p: SearchParams): string {
  return build("search", { query: p.query });
}

// ----------------------------- execution -----------------------------------

/**
 * Open a things:/// URL via macOS `open`. The Things app handles it.
 * Returns when `open` exits (which is fast; it doesn't wait for Things to finish).
 */
export async function openUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("open", [url], { stdio: "ignore" });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`'open' exited ${code}`));
    });
  });
}
