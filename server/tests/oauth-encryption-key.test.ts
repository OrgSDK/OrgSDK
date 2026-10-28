import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../db";
test("store initializes an encryption key and refuses replacement when protected data exists", async () => {
  const { existsSync, unlinkSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "orgsdk-key-"));
  const path = join(dir, "encryption.key");
  try {
    const store = openStore(dir);
    expect(existsSync(path)).toBe(true);
    store.sqlite
      .query(
        "INSERT INTO users (username,email,password_hash,totp_secret) VALUES ('owner','owner@example.com','hash','protected')",
      )
      .run();
    store.close();
    unlinkSync(path);
    expect(() => openStore(dir)).toThrow("Encryption key is missing");
    expect(existsSync(path)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
