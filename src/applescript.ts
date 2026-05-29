/**
 * AppleScript bridge for read operations against Things3.
 *
 * Things' AppleScript dictionary exposes a rich query language. We shell out
 * to `osascript`, ask Things to emit a structured TSV payload, and parse it.
 *
 * macOS will prompt for Automation permission on first invocation. The grant
 * is per source binary → per target app (Things3), revocable in
 * System Settings → Privacy & Security → Automation.
 */

import { spawn } from "node:child_process";

export class AppleScriptError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message);
    this.name = "AppleScriptError";
  }
}

export async function runScript(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-e", script]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new AppleScriptError(`osascript exited ${code}`, stderr));
    });
  });
}

// ----------------------- shared serialization ------------------------------
//
// Rows are TSV (tab-separated). Multiple rows joined by ROW_SEP (a Unicode
// RECORD SEPARATOR character that will never appear in user content).
//
// Notes sections (which can contain newlines, tabs, and any other text) use
// a sentinel boundary instead: anything after `NOTES_BEGIN<sentinel>NOTES_END`
// is the literal notes string. This avoids escaping headaches.

const TSV_SEP = "\t";
const ROW_SEP = "␞"; // RECORD SEPARATOR
const NOTES_BEGIN = "␃NOTES_BEGIN␃"; // ETX marker
const NOTES_END = "␄NOTES_END␄";     // EOT marker

/**
 * AppleScript helpers shared across queries. Prepended to each script.
 *
 * `isoDate` returns yyyy-mm-dd. `isoDateTime` returns yyyy-mm-ddTHH:MM
 * when the time component is non-zero; otherwise it falls back to date-only
 * so the caller can tell "scheduled but not reminded" apart from "reminder
 * set."
 */
const AS_HELPERS = `
on safeStr(v)
  try
    if v is missing value then return ""
    return v as string
  on error
    return ""
  end try
end safeStr

on zpad(n)
  set s to n as string
  if (count of s) is 1 then return "0" & s
  return s
end zpad

on isoDate(d)
  try
    if d is missing value then return ""
    set y to year of d as string
    set m to my zpad(month of d as integer)
    set dd to my zpad(day of d as integer)
    return y & "-" & m & "-" & dd
  on error
    return ""
  end try
end isoDate

on isoDateTime(d)
  try
    if d is missing value then return ""
    set y to year of d as string
    set m to my zpad(month of d as integer)
    set dd to my zpad(day of d as integer)
    set hh to (hours of d) as integer
    set mm to (minutes of d) as integer
    if hh is 0 and mm is 0 then
      return y & "-" & m & "-" & dd
    end if
    return y & "-" & m & "-" & dd & "T" & my zpad(hh) & ":" & my zpad(mm)
  on error
    return ""
  end try
end isoDateTime

on todoRow(t)
  set theStatus to (status of t) as string
  set theTags to ""
  try
    set tagList to {}
    repeat with tg in tag names of t
      set end of tagList to (tg as string)
    end repeat
    set AppleScript's text item delimiters to ","
    set theTags to tagList as string
    set AppleScript's text item delimiters to ""
  end try
  set theArea to ""
  try
    set theArea to name of area of t
  end try
  set theProject to ""
  try
    set theProject to name of project of t
  end try
  return (id of t as string) & "${TSV_SEP}" & ¬
    my safeStr(name of t) & "${TSV_SEP}" & ¬
    theStatus & "${TSV_SEP}" & ¬
    my safeStr(notes of t) & "${TSV_SEP}" & ¬
    theTags & "${TSV_SEP}" & ¬
    theArea & "${TSV_SEP}" & ¬
    theProject & "${TSV_SEP}" & ¬
    my isoDate(due date of t) & "${TSV_SEP}" & ¬
    my isoDateTime(activation date of t) & "${TSV_SEP}" & ¬
    my isoDate(modification date of t) & "${TSV_SEP}" & ¬
    my isoDate(creation date of t)
end todoRow
`;

// ----------------------- types ---------------------------------------------

export interface TodoSummary {
  id: string;
  name: string;
  status: "open" | "completed" | "canceled";
  notes: string;
  tags: string[];
  area: string | null;
  project: string | null;
  dueDate: string | null;        // yyyy-mm-dd
  activationDate: string | null; // yyyy-mm-dd OR yyyy-mm-ddTHH:MM when a reminder time is set
  modificationDate: string | null;
  creationDate: string | null;
}

export interface AreaInfo {
  id: string;
  name: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  area: string | null;
  status: "open" | "completed" | "canceled";
  headings: string[];
  todoCount: number;
}

export interface ProjectDetail extends ProjectInfo {
  notes: string;
  dueDate: string | null;
  activationDate: string | null;
  tags: string[];
}

// ----------------------- to-do queries -------------------------------------

/**
 * Returns to-dos from a built-in list ("Inbox", "Today", "Anytime",
 * "Upcoming", "Someday", "Logbook", "Tomorrow").
 */
export async function getTodos(listName: string): Promise<TodoSummary[]> {
  const script = `${AS_HELPERS}
tell application "Things3"
  set theList to list "${escapeAppleScript(listName)}"
  set theTodos to to dos of theList
  set out to ""
  repeat with t in theTodos
    if out is "" then
      set out to my todoRow(t)
    else
      set out to out & "${ROW_SEP}" & my todoRow(t)
    end if
  end repeat
  return out
end tell
`;
  const raw = await runScript(script);
  return parseTodoTsv(raw);
}

/**
 * Returns to-dos under a specific project. Identifier can be a project ID
 * (preferred — unique) or a project name (uses first match).
 */
export async function getTodosForProject(
  identifier: { id: string } | { name: string },
): Promise<TodoSummary[]> {
  const lookup = "id" in identifier
    ? `project id "${escapeAppleScript(identifier.id)}"`
    : `first project whose name is "${escapeAppleScript(identifier.name)}"`;
  const script = `${AS_HELPERS}
tell application "Things3"
  try
    set p to ${lookup}
  on error
    return ""
  end try
  set theTodos to to dos of p
  set out to ""
  repeat with t in theTodos
    if out is "" then
      set out to my todoRow(t)
    else
      set out to out & "${ROW_SEP}" & my todoRow(t)
    end if
  end repeat
  return out
end tell
`;
  const raw = await runScript(script);
  return parseTodoTsv(raw);
}

/**
 * Returns to-dos with a due date set within the next `daysAhead` days,
 * sorted by due date ascending. Uses AppleScript `whose` for efficiency.
 */
export async function getTodosByDeadlineWindow(daysAhead: number): Promise<TodoSummary[]> {
  if (!Number.isFinite(daysAhead) || daysAhead < 0) {
    throw new Error(`daysAhead must be a non-negative number, got ${daysAhead}`);
  }
  const script = `${AS_HELPERS}
tell application "Things3"
  set cutoff to (current date) + ${Math.floor(daysAhead)} * days
  set theTodos to (to dos of list "Anytime") whose due date is not missing value and due date is less than or equal to cutoff
  set out to ""
  repeat with t in theTodos
    if out is "" then
      set out to my todoRow(t)
    else
      set out to out & "${ROW_SEP}" & my todoRow(t)
    end if
  end repeat
  return out
end tell
`;
  const raw = await runScript(script);
  const todos = parseTodoTsv(raw);
  // Sort ascending by dueDate (lexicographic works for yyyy-mm-dd).
  return todos.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
}

/**
 * Substring search against to-do name + notes. Reads the "Anytime" list and
 * filters client-side. Capped at `max` matches.
 */
export async function searchTodos(query: string, max: number = 50): Promise<TodoSummary[]> {
  const script = `${AS_HELPERS}
tell application "Things3"
  set theTodos to to dos of list "Anytime"
  set out to ""
  repeat with t in theTodos
    if out is "" then
      set out to my todoRow(t)
    else
      set out to out & "${ROW_SEP}" & my todoRow(t)
    end if
  end repeat
  return out
end tell
`;
  const raw = await runScript(script);
  const all = parseTodoTsv(raw);
  const q = query.toLowerCase();
  return all
    .filter((t) => t.name.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))
    .slice(0, max);
}

// ----------------------- areas ---------------------------------------------

export async function getAreaNames(): Promise<string[]> {
  const script = `
tell application "Things3"
  set names to {}
  repeat with a in areas
    set end of names to (name of a as string)
  end repeat
  set AppleScript's text item delimiters to "${ROW_SEP}"
  return names as string
end tell
`;
  const raw = (await runScript(script)).trim();
  if (!raw) return [];
  return raw.split(ROW_SEP).map((s) => s.trim()).filter(Boolean);
}

export async function getAreas(): Promise<AreaInfo[]> {
  const script = `
tell application "Things3"
  set rows to {}
  repeat with a in areas
    set end of rows to (id of a as string) & "${TSV_SEP}" & (name of a as string)
  end repeat
  set AppleScript's text item delimiters to "${ROW_SEP}"
  return rows as string
end tell
`;
  const raw = (await runScript(script)).trim();
  if (!raw) return [];
  return raw.split(ROW_SEP).map((row) => {
    const [id, name] = row.split(TSV_SEP);
    return { id: (id ?? "").trim(), name: name ?? "" };
  });
}

// ----------------------- projects ------------------------------------------

export async function getProjects(areaName?: string): Promise<ProjectInfo[]> {
  const script = `
tell application "Things3"
  set rows to {}
  repeat with p in projects
    set theArea to ""
    try
      set theArea to (name of area of p as string)
    end try
    set theStatus to (status of p) as string
    set headingNames to ""
    try
      set hs to {}
      repeat with h in headings of p
        set end of hs to (name of h as string)
      end repeat
      set AppleScript's text item delimiters to "|"
      set headingNames to hs as string
      set AppleScript's text item delimiters to ""
    end try
    set todoCount to (count of to dos of p) as string
    set end of rows to (id of p as string) & "${TSV_SEP}" & ¬
      (name of p as string) & "${TSV_SEP}" & ¬
      theArea & "${TSV_SEP}" & ¬
      theStatus & "${TSV_SEP}" & ¬
      headingNames & "${TSV_SEP}" & ¬
      todoCount
  end repeat
  set AppleScript's text item delimiters to "${ROW_SEP}"
  return rows as string
end tell
`;
  const raw = (await runScript(script)).trim();
  if (!raw) return [];
  const all: ProjectInfo[] = raw.split(ROW_SEP).map((row) => {
    const cells = row.split(TSV_SEP);
    const [id, name, area, status, headingsRaw, count] = cells;
    return {
      id: (id ?? "").trim(),
      name: name ?? "",
      area: area && area.length > 0 ? area : null,
      status: parseStatus(status ?? ""),
      headings: (headingsRaw ?? "").split("|").map((s) => s.trim()).filter(Boolean),
      todoCount: parseInt(count ?? "0", 10) || 0,
    };
  });
  if (areaName) return all.filter((p) => p.area === areaName);
  return all;
}

/**
 * Returns full detail for a single project, including its notes. Identifier
 * can be ID (preferred) or name.
 *
 * The notes are emitted between sentinel markers so multi-line / tab-containing
 * notes don't break TSV parsing. Returns null if the project doesn't exist.
 */
export async function getProjectDetail(
  identifier: { id: string } | { name: string },
): Promise<ProjectDetail | null> {
  const lookup = "id" in identifier
    ? `project id "${escapeAppleScript(identifier.id)}"`
    : `first project whose name is "${escapeAppleScript(identifier.name)}"`;
  const script = `${AS_HELPERS}
tell application "Things3"
  try
    set p to ${lookup}
  on error
    return ""
  end try
  set theArea to ""
  try
    set theArea to (name of area of p as string)
  end try
  set theStatus to (status of p) as string
  set headingNames to ""
  try
    set hs to {}
    repeat with h in headings of p
      set end of hs to (name of h as string)
    end repeat
    set AppleScript's text item delimiters to "|"
    set headingNames to hs as string
    set AppleScript's text item delimiters to ""
  end try
  set todoCount to (count of to dos of p) as string
  set theTags to ""
  try
    set tagList to {}
    repeat with tg in tag names of p
      set end of tagList to (tg as string)
    end repeat
    set AppleScript's text item delimiters to ","
    set theTags to tagList as string
    set AppleScript's text item delimiters to ""
  end try
  set meta to (id of p as string) & "${TSV_SEP}" & ¬
    (name of p as string) & "${TSV_SEP}" & ¬
    theArea & "${TSV_SEP}" & ¬
    theStatus & "${TSV_SEP}" & ¬
    headingNames & "${TSV_SEP}" & ¬
    todoCount & "${TSV_SEP}" & ¬
    my isoDate(due date of p) & "${TSV_SEP}" & ¬
    my isoDateTime(activation date of p) & "${TSV_SEP}" & ¬
    theTags
  set theNotes to my safeStr(notes of p)
  return meta & "${NOTES_BEGIN}" & theNotes & "${NOTES_END}"
end tell
`;
  const raw = (await runScript(script)).trim();
  if (!raw) return null;

  // Split meta from notes via sentinel.
  const beginIdx = raw.indexOf(NOTES_BEGIN);
  const endIdx = raw.lastIndexOf(NOTES_END);
  if (beginIdx < 0 || endIdx < 0 || endIdx < beginIdx) return null;

  const meta = raw.slice(0, beginIdx);
  const notes = raw.slice(beginIdx + NOTES_BEGIN.length, endIdx);
  const cells = meta.split(TSV_SEP);
  const [id, name, area, status, headingsRaw, count, dueDate, activationDate, tagsRaw] = cells;

  return {
    id: (id ?? "").trim(),
    name: name ?? "",
    area: area && area.length > 0 ? area : null,
    status: parseStatus(status ?? ""),
    headings: (headingsRaw ?? "").split("|").map((s) => s.trim()).filter(Boolean),
    todoCount: parseInt(count ?? "0", 10) || 0,
    notes,
    dueDate: dueDate && dueDate.length > 0 ? dueDate : null,
    activationDate: activationDate && activationDate.length > 0 ? activationDate : null,
    tags: (tagsRaw ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

// ----------------------- tags ----------------------------------------------

export async function getTagNames(): Promise<string[]> {
  const script = `
tell application "Things3"
  set names to {}
  repeat with t in tags
    set end of names to (name of t as string)
  end repeat
  set AppleScript's text item delimiters to "${ROW_SEP}"
  return names as string
end tell
`;
  const raw = (await runScript(script)).trim();
  if (!raw) return [];
  return raw.split(ROW_SEP).map((s) => s.trim()).filter(Boolean);
}

// ----------------------- parsing -------------------------------------------

function parseTodoTsv(raw: string): TodoSummary[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const rows = trimmed.split(ROW_SEP);
  return rows.map((row) => {
    const cells = row.split(TSV_SEP);
    const [id, name, status, notes, tags, area, project, dueDate, activationDate, modificationDate, creationDate] = cells;
    return {
      id: (id ?? "").trim(),
      name: name ?? "",
      status: parseStatus(status ?? ""),
      notes: notes ?? "",
      tags: (tags ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      area: area && area.length > 0 ? area : null,
      project: project && project.length > 0 ? project : null,
      dueDate: dueDate && dueDate.length > 0 ? dueDate : null,
      activationDate: activationDate && activationDate.length > 0 ? activationDate : null,
      modificationDate: modificationDate && modificationDate.length > 0 ? modificationDate : null,
      creationDate: creationDate && creationDate.length > 0 ? creationDate : null,
    };
  });
}

function parseStatus(s: string): "open" | "completed" | "canceled" {
  const lower = s.toLowerCase();
  if (lower.includes("complet")) return "completed";
  if (lower.includes("cancel")) return "canceled";
  return "open";
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
