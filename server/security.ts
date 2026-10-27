import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./db";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const randomSecret = () => randomBytes(32).toString("base64url");
export function ensureEncryptionKey(dataDir: string): Buffer {
  const path = join(dataDir, "encryption.key");
  try {
    writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
  }
  const value = readFileSync(path);
  if (value.length !== 32) throw new Error("Invalid encryption key");
  return value;
}
function existingKey(store: Store): Buffer {
  const value = readFileSync(join(store.dataDir, "encryption.key"));
  if (value.length !== 32) throw new Error("Invalid encryption key");
  return value;
}
export function encrypt(store: Store, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", existingKey(store), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function decrypt(store: Store, value: string): string {
  const data = Buffer.from(value, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    existingKey(store),
    data.subarray(0, 12),
  );
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
