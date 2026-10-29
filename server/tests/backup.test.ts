import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase, restoreDatabase } from "../cli/database";
import { openStore } from "../db";
import { databaseFilename } from "../db/migrate";
import { decrypt, encrypt } from "../shared/security";
import {
  initialStore,
  migrationCount,
  latestMigrationCount,
  seedWorkspace,
  temporaryDatabase,
} from "./database-fixture";

test("backup and restore preserve encrypted data and refuse to overwrite an installation", () => {
  const temp = mkdtempSync(join(tmpdir(), "orgsdk-backup-"));
  const source = join(temp, "source");
  const destination = join(temp, "restored");
  const backup = join(temp, "backup.sqlite3");
  try {
    const store = openStore(source);
    const encrypted = encrypt(store, "private credential");
    store.sqlite
      .query("INSERT INTO users (username,email,password_hash) VALUES (?,?,?)")
      .run("test", "test@example.com", encrypted);
    store.close();
    const run = (dir: string, command: string, path: string) =>
      Bun.spawnSync({
        cmd: ["bun", "server/index.ts", command, path],
        cwd: process.cwd(),
        env: { ...process.env, ORGSDK_DATA_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      });
    const saved = run(source, "backup", backup);
    expect(saved.exitCode).toBe(0);
    mkdirSync(destination);
    copyFileSync(
      join(source, "encryption.key"),
      join(destination, "encryption.key"),
    );
    const restored = run(destination, "restore", backup);
    expect(restored.exitCode).toBe(0);
    const reopened = openStore(destination);
    const row = reopened.sqlite
      .query("SELECT password_hash FROM users")
      .get() as { password_hash: string };
    expect(decrypt(reopened, row.password_hash)).toBe("private credential");
    reopened.close();
    expect(run(destination, "restore", backup).exitCode).not.toBe(0);
    expect(run(source, "backup", backup).exitCode).not.toBe(0);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test("backups preserve the source migration level and restored data upgrades on startup", () => {
  const fixture = temporaryDatabase();
  try {
    const source = join(fixture.directory, "source");
    const original = initialStore(source);
    const { project } = seedWorkspace(original);
    original.close();
    const backup = join(fixture.directory, "snapshot.sqlite3");
    backupDatabase(source, backup);
    for (const file of [join(source, databaseFilename), backup]) {
      const sqlite = new Database(file, { readonly: true });
      try {
        expect(migrationCount(sqlite)).toBe(1);
      } finally {
        sqlite.close();
      }
    }
    const destination = join(fixture.directory, "restored");
    mkdirSync(destination);
    copyFileSync(
      join(source, "encryption.key"),
      join(destination, "encryption.key"),
    );
    restoreDatabase(destination, backup);
    const restored = openStore(destination);
    try {
      expect(migrationCount(restored.sqlite)).toBe(latestMigrationCount);
      expect(restored.sqlite.query("SELECT name FROM projects").get()).toEqual({
        name: project.name,
      });
    } finally {
      restored.close();
    }
  } finally {
    fixture.cleanup();
  }
});
