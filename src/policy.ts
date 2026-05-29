/**
 * Per-tool policy. Default policy is embedded in config/policy.default.yaml;
 * user override at ~/Library/Application Support/things-mcp/policy.yaml.
 *
 * Decisions:
 *   - "allow"   — execute normally (chat client's approval UI may still gate)
 *   - "dry-run" — return what would happen (URL constructed, not fired)
 *   - "deny"    — reject the call
 *
 * Rate limits are evaluated per-tool, sliding window.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

export type Decision = "allow" | "dry-run" | "deny";

export interface RateLimit {
  count: number;
  perSeconds: number;
}

export interface ToolPolicy {
  decision: Decision;
  rateLimit?: RateLimit;
}

export interface Policy {
  tools: Record<string, ToolPolicy>;
  default: ToolPolicy;
}

interface RawToolPolicy {
  decision?: string;
  rate_limit?: string; // e.g. "30/hour", "10/minute", "5/second"
}

interface RawPolicy {
  tools?: Record<string, RawToolPolicy>;
  default?: RawToolPolicy;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PATH = join(__dirname, "..", "config", "policy.default.yaml");
const USER_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "things-mcp",
  "policy.yaml",
);

let cachedPolicy: Policy | null = null;

export function loadPolicy(): Policy {
  if (cachedPolicy) return cachedPolicy;

  const base = readYaml(DEFAULT_PATH) ?? { tools: {} };
  const user = tryReadYaml(USER_PATH);
  const merged = mergePolicy(base, user ?? {});

  cachedPolicy = normalize(merged);
  return cachedPolicy;
}

export function reloadPolicy(): Policy {
  cachedPolicy = null;
  return loadPolicy();
}

export function getToolPolicy(toolName: string): ToolPolicy {
  const policy = loadPolicy();
  return policy.tools[toolName] ?? policy.default;
}

// --------------------------- rate limiting ---------------------------------

const buckets = new Map<string, number[]>();

export function checkAndRecordRateLimit(toolName: string, limit: RateLimit): boolean {
  const now = Date.now();
  const windowStart = now - limit.perSeconds * 1000;
  const bucket = (buckets.get(toolName) ?? []).filter((ts) => ts > windowStart);
  if (bucket.length >= limit.count) {
    buckets.set(toolName, bucket);
    return false;
  }
  bucket.push(now);
  buckets.set(toolName, bucket);
  return true;
}

// ------------------------------ helpers ------------------------------------

function readYaml(path: string): RawPolicy | undefined {
  const content = readFileSync(path, "utf8");
  return yaml.load(content) as RawPolicy;
}

function tryReadYaml(path: string): RawPolicy | undefined {
  try {
    return readYaml(path);
  } catch {
    return undefined;
  }
}

function mergePolicy(base: RawPolicy, user: RawPolicy): RawPolicy {
  return {
    tools: { ...(base.tools ?? {}), ...(user.tools ?? {}) },
    default: user.default ?? base.default,
  };
}

function normalize(raw: RawPolicy): Policy {
  const defaultPolicy = normalizeTool(raw.default) ?? { decision: "allow" };
  const tools: Record<string, ToolPolicy> = {};
  for (const [name, rt] of Object.entries(raw.tools ?? {})) {
    const normalized = normalizeTool(rt);
    if (normalized) tools[name] = normalized;
  }
  return { tools, default: defaultPolicy };
}

function normalizeTool(raw: RawToolPolicy | undefined): ToolPolicy | undefined {
  if (!raw) return undefined;
  const decision = (raw.decision ?? "allow") as Decision;
  if (decision !== "allow" && decision !== "dry-run" && decision !== "deny") {
    throw new Error(`Invalid policy decision: ${decision}`);
  }
  const policy: ToolPolicy = { decision };
  if (raw.rate_limit) {
    policy.rateLimit = parseRateLimit(raw.rate_limit);
  }
  return policy;
}

function parseRateLimit(s: string): RateLimit {
  const match = /^(\d+)\s*\/\s*(second|minute|hour|day)s?$/i.exec(s.trim());
  if (!match) {
    throw new Error(`Invalid rate_limit format: ${s} (expected e.g. "30/hour")`);
  }
  const count = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const perSeconds = unit === "second" ? 1 : unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400;
  return { count, perSeconds };
}
