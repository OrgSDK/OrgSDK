import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openStore } from "../db";
import { databaseFilename } from "../db/migrate";
import {
  initialStore,
  migrationCount,
  seedWorkspace,
  temporaryDatabase,
} from "./database-fixture";

function runMigrations(dataDir: string) {
  const binary = process.env.ORGSDK_TEST_BINARY;
  return Bun.spawnSync({
    cmd: binary
      ? [resolve(binary), "migrate"]
      : ["bun", "server/index.ts", "migrate"],
    ...(binary ? { cwd: dataDir } : {}),
    env: {
      ...process.env,
      ORGSDK_DATA_DIR: dataDir,
      ...(binary ? { PATH: "/nonexistent" } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("mismatched migration histories are rejected without changing the database", () => {
  for (const change of [
    "UPDATE __drizzle_migrations SET hash='changed' WHERE created_at=(SELECT min(created_at) FROM __drizzle_migrations)",
    "INSERT INTO __drizzle_migrations(hash,created_at) VALUES ('future', 9999999999999)",
  ]) {
    const fixture = temporaryDatabase();
    try {
      const store = openStore(fixture.directory);
      store.sqlite.exec(change);
      store.close();
      const path = join(fixture.directory, databaseFilename);
      const before = readFileSync(path);
      expect(() => openStore(fixture.directory)).toThrow(
        "migration history does not match",
      );
      expect(readFileSync(path)).toEqual(before);
    } finally {
      fixture.cleanup();
    }
  }
});

test("the migration command initializes a database and respects the server lock", () => {
  const fixture = temporaryDatabase();
  try {
    const migrate = () => runMigrations(fixture.directory);
    const result = migrate();
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(result.stdout.toString()).toContain("Database migrations applied.");
    const sqlite = new Database(join(fixture.directory, databaseFilename), {
      readonly: true,
    });
    try {
      expect(
        sqlite.query("SELECT hash FROM __drizzle_migrations").all(),
      ).toHaveLength(2);
    } finally {
      sqlite.close();
    }
    writeFileSync(join(fixture.directory, "server.pid"), String(process.pid));
    const blocked = migrate();
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.stderr.toString()).toContain(
      "already owns this data directory",
    );
  } finally {
    fixture.cleanup();
  }
});

test("the migration command upgrades an installation from the first generated migration", () => {
  const fixture = temporaryDatabase();
  try {
    const original = initialStore(fixture.directory);
    const { project } = seedWorkspace(original);
    original.close();
    const result = runMigrations(fixture.directory);
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const sqlite = new Database(join(fixture.directory, databaseFilename), {
      readonly: true,
    });
    try {
      expect(migrationCount(sqlite)).toBe(2);
      expect(sqlite.query("SELECT name FROM projects").get()).toEqual({
        name: project.name,
      });
      expect(
        sqlite
          .query("SELECT name FROM sqlite_master WHERE name='runs_queue_idx'")
          .get(),
      ).not.toBeNull();
    } finally {
      sqlite.close();
    }
  } finally {
    fixture.cleanup();
  }
});
