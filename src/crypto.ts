/**
 * AES-256-GCM helpers for field-level audit log encryption.
 *
 * Why not SQLCipher? We tried `better-sqlite3-multiple-ciphers` first but
 * its prebuilds lag the main `better-sqlite3` package and build-from-source
 * via node-gyp is fragile. Field-level AES-256-GCM gives equivalent threat
 * coverage with zero native-build risk: schema/timestamps/tool-names are
 * visible to anyone with file read access (low sensitivity), and the
 * content payloads (args, errors) are AEAD-ciphertexts requiring the
 * Keychain-held key to decrypt.
 *
 * Format on disk: base64(iv || ciphertext || tag).
 *   iv:         12 bytes (96 bits, GCM standard)
 *   ciphertext: same length as plaintext
 *   tag:        16 bytes (128 bits, GCM authentication tag)
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export class DecryptError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "DecryptError";
  }
}

/**
 * Encrypt `plaintext` with the given 32-byte key. AAD binds the ciphertext
 * to the row's tool name (so a row's args can't be transplanted to a row
 * for a different tool without breaking auth).
 */
export function encryptField(key: Buffer, plaintext: string, aad: string): string {
  if (key.length !== 32) {
    throw new Error(`AES-256 key must be 32 bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

/**
 * Decrypt a base64-encoded blob. Throws DecryptError on auth failure
 * (wrong key, wrong AAD, tampered ciphertext).
 */
export function decryptField(key: Buffer, blob: string, aad: string): string {
  if (key.length !== 32) {
    throw new Error(`AES-256 key must be 32 bytes, got ${key.length}`);
  }
  const buf = Buffer.from(blob, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new DecryptError(`ciphertext too short: ${buf.length} bytes`);
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (err) {
    throw new DecryptError(
      "AES-GCM decrypt/auth failed. Either the Keychain audit-key has changed " +
      "since this row was written, the row's tool name (AAD) was modified, or " +
      "the ciphertext was tampered with.",
      err,
    );
  }
}

/**
 * Parse a hex-encoded key from Keychain into a Buffer.
 */
export function keyFromHex(hex: string): Buffer {
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(`Expected 64-char hex (32 bytes) audit key, got ${hex.length} chars`);
  }
  return buf;
}
