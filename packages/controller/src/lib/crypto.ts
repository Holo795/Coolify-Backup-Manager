import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Secret-at-rest encryption for the controller DB (API tokens, SSH/S3 creds,
 * per-destination AES keys). Uses AES-256-GCM with a master key.
 *
 * Master key: MASTER_KEY (base64, 32 bytes) if provided, else derived from
 * BETTER_AUTH_SECRET via SHA-256 (so a dev setup works out of the box).
 */
function masterKey(): Buffer {
  if (env.masterKey) {
    const k = Buffer.from(env.masterKey, "base64");
    if (k.length === 32) return k;
  }
  return createHash("sha256").update(env.authSecret).digest();
}

/** Encrypt a UTF-8 string -> base64 blob ("iv.tag.ciphertext"). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

/** Decrypt a blob produced by encryptSecret back to a UTF-8 string. */
export function decryptSecret(blob: string): string {
  const [ivB64, tagB64, ctB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed secret blob");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

export function encryptJSON(obj: unknown): string {
  return encryptSecret(JSON.stringify(obj));
}
export function decryptJSON<T>(blob: string): T {
  return JSON.parse(decryptSecret(blob)) as T;
}

/** Generate a fresh base64 32-byte AES key (for per-destination encryption). */
export function generateAesKeyB64(): string {
  return randomBytes(32).toString("base64");
}

/** SHA-256 hex of a token (for storing agent tokens without plaintext). */
export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Random opaque token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
