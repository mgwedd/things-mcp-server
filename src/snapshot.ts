/**
 * In-memory TTL cache over Things state.
 *
 * Things itself (via Things Cloud) is the single source of truth across all
 * your devices. This module exists ONLY to avoid re-spawning AppleScript on
 * back-to-back reads within a single agent turn — not to maintain a parallel
 * copy of your data.
 *
 * Default TTL is 60 seconds, configurable per call. Pass `force: true` to
 * bypass the cache and re-read.
 *
 * No persistence to disk. The cache lives in the MCP server's memory for the
 * lifetime of the process. If you want a JSON dump for ad-hoc inspection,
 * use `things-mcp snapshot --write <path>` (CLI; explicit, ephemeral).
 */

import {
  getAreas,
  getProjects,
  getTagNames,
  type AreaInfo,
  type ProjectInfo,
} from "./applescript.js";

const DEFAULT_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttlMs: number, force: boolean, loader: () => Promise<T>): Promise<T> {
  if (!force) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as T;
    }
  }
  const value = await loader();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function clearSnapshotCache(): void {
  cache.clear();
}

export interface SnapshotOpts {
  /** Cache TTL in milliseconds. Default 60s. */
  ttlMs?: number;
  /** Bypass cache and re-read from Things. */
  force?: boolean;
  /** Include projects (heavier AppleScript query). Default true. */
  includeProjects?: boolean;
}

export interface Snapshot {
  takenAt: string;
  source: "cache" | "fresh";
  areas: AreaInfo[];
  tags: string[];
  projects?: ProjectInfo[];
}

/**
 * Returns Areas + Tags (always) and Projects (default; opt out with includeProjects: false).
 */
export async function snapshot(opts: SnapshotOpts = {}): Promise<Snapshot> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const force = opts.force ?? false;
  const includeProjects = opts.includeProjects ?? true;

  const start = Date.now();
  const [areas, tags, projects] = await Promise.all([
    cached("areas", ttl, force, () => getAreas()),
    cached("tags", ttl, force, () => getTagNames()),
    includeProjects ? cached("projects", ttl, force, () => getProjects()) : Promise.resolve(undefined),
  ]);

  const tookMs = Date.now() - start;
  const fromCache = tookMs < 50; // heuristic: any real AppleScript spawn takes >>50ms

  const snap: Snapshot = {
    takenAt: new Date().toISOString(),
    source: fromCache ? "cache" : "fresh",
    areas,
    tags,
  };
  if (projects) snap.projects = projects;
  return snap;
}
