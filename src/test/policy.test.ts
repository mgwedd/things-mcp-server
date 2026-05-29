/**
 * Tests for the rate-limit parser and sliding-window check.
 *
 * We deliberately do not test the YAML loader against a real file here —
 * that's covered by the smoke test against the default policy on startup.
 */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkAndRecordRateLimit } from "../policy.js";

describe("policy: rate limiting", () => {
  // Each test uses a unique tool name to isolate state across tests.
  let toolCounter = 0;
  function nextTool(): string {
    return `_test_tool_${++toolCounter}`;
  }

  it("allows calls under the limit", () => {
    const tool = nextTool();
    const limit = { count: 3, perSeconds: 60 };
    assert.equal(checkAndRecordRateLimit(tool, limit), true);
    assert.equal(checkAndRecordRateLimit(tool, limit), true);
    assert.equal(checkAndRecordRateLimit(tool, limit), true);
  });

  it("denies calls over the limit within the window", () => {
    const tool = nextTool();
    const limit = { count: 2, perSeconds: 60 };
    assert.equal(checkAndRecordRateLimit(tool, limit), true);
    assert.equal(checkAndRecordRateLimit(tool, limit), true);
    assert.equal(checkAndRecordRateLimit(tool, limit), false);
    assert.equal(checkAndRecordRateLimit(tool, limit), false);
  });

  it("scopes limits per tool", () => {
    const t1 = nextTool();
    const t2 = nextTool();
    const limit = { count: 1, perSeconds: 60 };
    assert.equal(checkAndRecordRateLimit(t1, limit), true);
    assert.equal(checkAndRecordRateLimit(t2, limit), true);
    assert.equal(checkAndRecordRateLimit(t1, limit), false);
    assert.equal(checkAndRecordRateLimit(t2, limit), false);
  });

  it("recovers when the window slides past the oldest call", async () => {
    const tool = nextTool();
    const limit = { count: 2, perSeconds: 0.05 }; // 50ms window
    assert.equal(checkAndRecordRateLimit(tool, limit), true);
    assert.equal(checkAndRecordRateLimit(tool, limit), true);
    assert.equal(checkAndRecordRateLimit(tool, limit), false);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(checkAndRecordRateLimit(tool, limit), true);
  });

  afterEach(() => {
    // Bucket state is module-private; we rely on unique tool names per test.
  });
});
