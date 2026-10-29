import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SecretCipher } from "./secrets";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const randomSecret = () => randomBytes(32).toString("base64url");
export function ensureEncryptionKey(dataDir: string): Buffer {
  const path = join(dataDir, "encryption.key");
  try {
    writeFileSync(path, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }
  }
  const value = readFileSync(path);
  if (value.length !== 32) {
    throw new Error("Invalid encryption key");
  }
  return value;
}
export function encrypt(
  owner: { secrets: SecretCipher },
  value: string,
): string {
  return owner.secrets.encrypt(value);
}
export function decrypt(
  owner: { secrets: SecretCipher },
  value: string,
): string {
  return owner.secrets.decrypt(value);
}
