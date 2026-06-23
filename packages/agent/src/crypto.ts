import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { once } from "node:events";

const IV_LEN = 12;
const TAG_LEN = 16;

/** Generate a fresh base64-encoded 32-byte key. */
export function generateKeyB64(): string {
  return randomBytes(32).toString("base64");
}

function keyFromB64(b64: string): Buffer {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error("Encryption key must decode to 32 bytes");
  return k;
}

/** Compute the sha256 of a file (hex). */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const rs = createReadStream(path);
  rs.pipe(hash, { end: false });
  await once(rs, "end");
  return hash.digest("hex");
}

/**
 * Encrypt src -> dest using AES-256-GCM.
 * Output layout: [IV(12)] [ciphertext...] [TAG(16)]
 */
export async function encryptFile(src: string, dest: string, keyB64: string): Promise<void> {
  const key = keyFromB64(keyB64);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(dest);
  out.write(iv);
  const rs = createReadStream(src);
  for await (const chunk of rs) {
    out.write(cipher.update(chunk as Buffer));
  }
  out.write(cipher.final());
  out.write(cipher.getAuthTag());
  out.end();
  await once(out, "close");
}

/**
 * Decrypt src -> dest. Reads IV from head and TAG from tail, streams the middle.
 */
export async function decryptFile(src: string, dest: string, keyB64: string): Promise<void> {
  const key = keyFromB64(keyB64);
  const size = (await stat(src)).size;
  if (size < IV_LEN + TAG_LEN) throw new Error("Encrypted file too small");

  const iv = await readRange(src, 0, IV_LEN - 1);
  const tag = await readRange(src, size - TAG_LEN, size - 1);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const out = createWriteStream(dest);
  const rs = createReadStream(src, { start: IV_LEN, end: size - TAG_LEN - 1 });
  for await (const chunk of rs) {
    out.write(decipher.update(chunk as Buffer));
  }
  out.write(decipher.final());
  out.end();
  await once(out, "close");
}

async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const rs = createReadStream(path, { start, end });
  for await (const c of rs) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
