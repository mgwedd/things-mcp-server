import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashSummary, redactArgs } from "../redact.js";

function sha16(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

describe("redact.redactArgs", () => {
  it("preserves primitives", () => {
    assert.equal(redactArgs("hello"), "hello");
    assert.equal(redactArgs(42), 42);
    assert.equal(redactArgs(true), true);
    assert.equal(redactArgs(null), null);
    assert.equal(redactArgs(undefined), undefined);
  });

  it("hashes title", () => {
    const out = redactArgs({ title: "Buy milk" }) as { title: unknown };
    assert.deepEqual(out.title, { sha256: sha16("Buy milk"), len: 8, type: "string" });
  });

  it("hashes notes", () => {
    const notes = "Some private context";
    const out = redactArgs({ notes }) as { notes: unknown };
    assert.deepEqual(out.notes, { sha256: sha16(notes), len: notes.length, type: "string" });
  });

  it("hashes appendNotes and prependNotes", () => {
    const out = redactArgs({ appendNotes: "x", prependNotes: "y" }) as Record<string, unknown>;
    assert.equal((out.appendNotes as { type: string }).type, "string");
    assert.equal((out.prependNotes as { type: string }).type, "string");
  });

  it("hashes checklistItems as an array-joined sha", () => {
    const items = ["Bread", "Milk", "Eggs"];
    const out = redactArgs({ checklistItems: items }) as { checklistItems: unknown };
    assert.deepEqual(out.checklistItems, {
      sha256: sha16("Bread\nMilk\nEggs"),
      len: "Bread\nMilk\nEggs".length,
      type: "array",
    });
  });

  it("keeps structural fields literal", () => {
    const args = {
      id: "ABC123",
      list: "Camper",
      area: "Rentals",
      heading: "Plumbing",
      tags: ["@home", "@5min"],
      when: "today",
      deadline: "2026-06-01",
      completed: false,
      reveal: true,
    };
    assert.deepEqual(redactArgs(args), args);
  });

  it("redacts secret-shaped keys", () => {
    const out = redactArgs({
      "auth-token": "abc",
      apiKey: "xyz",
      myPassword: "p",
      MY_SECRET: "s",
    }) as Record<string, unknown>;
    assert.equal(out["auth-token"], "[REDACTED]");
    assert.equal(out.apiKey, "[REDACTED]");
    assert.equal(out.myPassword, "[REDACTED]");
    assert.equal(out.MY_SECRET, "[REDACTED]");
  });

  it("does not redact non-secret keys", () => {
    const out = redactArgs({ list: "X", id: "Y" }) as Record<string, unknown>;
    assert.equal(out.list, "X");
    assert.equal(out.id, "Y");
  });

  it("recurses into nested objects", () => {
    const out = redactArgs({
      data: [
        { type: "to-do", attributes: { title: "hi", tags: ["a"] } },
      ],
    }) as { data: Array<{ attributes: { title: unknown; tags: unknown } }> };
    assert.equal((out.data[0]!.attributes.title as { type: string }).type, "string");
    assert.deepEqual(out.data[0]!.attributes.tags, ["a"]);
  });

  it("handles arrays of primitives", () => {
    assert.deepEqual(redactArgs([1, 2, "three"]), [1, 2, "three"]);
  });
});

describe("redact.hashSummary", () => {
  it("hashes a string", () => {
    const out = hashSummary("abc");
    assert.equal(out.sha256, sha16("abc"));
    assert.equal(out.len, 3);
    assert.equal(out.type, "string");
  });

  it("hashes an array via newline-join", () => {
    const out = hashSummary(["a", "b"]);
    assert.equal(out.sha256, sha16("a\nb"));
    assert.equal(out.type, "array");
  });

  it("hashes other types via JSON", () => {
    const out = hashSummary({ x: 1 });
    assert.equal(out.sha256, sha16(JSON.stringify({ x: 1 })));
    assert.equal(out.type, "object");
  });
});
