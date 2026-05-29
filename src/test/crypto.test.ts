import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptField, DecryptError, encryptField, keyFromHex } from "../crypto.js";

describe("crypto: AES-256-GCM field encryption", () => {
  const key = randomBytes(32);
  const aad = "add_todo";

  it("roundtrips short text", () => {
    const blob = encryptField(key, "hello world", aad);
    assert.equal(decryptField(key, blob, aad), "hello world");
  });

  it("roundtrips empty string", () => {
    const blob = encryptField(key, "", aad);
    assert.equal(decryptField(key, blob, aad), "");
  });

  it("roundtrips 10KB JSON-shaped payload", () => {
    const big = JSON.stringify({ x: "a".repeat(10000) });
    const blob = encryptField(key, big, aad);
    assert.equal(decryptField(key, blob, aad), big);
  });

  it("roundtrips Unicode", () => {
    const text = "café — naïve résumé 🦮 北京";
    const blob = encryptField(key, text, aad);
    assert.equal(decryptField(key, blob, aad), text);
  });

  it("produces different ciphertext for same plaintext (IV randomness)", () => {
    const a = encryptField(key, "same", aad);
    const b = encryptField(key, "same", aad);
    assert.notEqual(a, b);
  });

  it("rejects decrypt with wrong key", () => {
    const blob = encryptField(key, "secret", aad);
    const otherKey = randomBytes(32);
    assert.throws(() => decryptField(otherKey, blob, aad), DecryptError);
  });

  it("rejects decrypt with wrong AAD (tool name mismatch)", () => {
    const blob = encryptField(key, "secret", "add_todo");
    assert.throws(() => decryptField(key, blob, "update_todo"), DecryptError);
  });

  it("rejects tampered ciphertext (bit flip)", () => {
    const blob = encryptField(key, "secret", aad);
    const buf = Buffer.from(blob, "base64");
    // Flip a bit in the middle of the ciphertext (not the IV, not the tag).
    buf[buf.length - 20]! ^= 0x01;
    const tampered = buf.toString("base64");
    assert.throws(() => decryptField(key, tampered, aad), DecryptError);
  });

  it("rejects truncated ciphertext", () => {
    const blob = encryptField(key, "secret", aad);
    const short = blob.slice(0, 8);
    assert.throws(() => decryptField(key, short, aad), DecryptError);
  });

  it("rejects 16-byte key (wrong size)", () => {
    const shortKey = randomBytes(16);
    assert.throws(() => encryptField(shortKey, "x", aad), /32 bytes/);
  });

  it("keyFromHex accepts valid 64-char hex", () => {
    const hex = randomBytes(32).toString("hex");
    const buf = keyFromHex(hex);
    assert.equal(buf.length, 32);
  });

  it("keyFromHex rejects wrong-length hex", () => {
    assert.throws(() => keyFromHex("abcd"), /Expected 64-char hex/);
  });
});
