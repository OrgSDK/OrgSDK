import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { openStore } from "../db";
import { databaseFilename } from "../db/migrate";
import { credentials, projects } from "../db/schema";
import { decrypt, encrypt } from "../shared/security";
import {
  initialStore,
  migrationCount,
  latestMigrationCount,
  seedWorkspace,
  temporaryDatabase,
} from "./database-fixture";

test("generated migration upgrades preserve records and encrypted credentials and run once", () => {
  const fixture = temporaryDatabase();
  try {
    const original = initialStore(fixture.directory);
    const { workspace, project, time } = seedWorkspace(original);
    const credential = original.db
      .insert(credentials)
      .values({
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        name: "Private connection",
        provider: "token",
        encryptedSecret: encrypt(original, '{"token":"preserved"}'),
        createdAt: time,
        updatedAt: time,
      })
      .returning()
      .get();
    expect(migrationCount(original.sqlite)).toBe(1);
    expect(
      original.sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE name='mail_outbox_due_idx'",
        )
        .get(),
    ).toBeNull();
    original.close();
    for (let reopen = 0; reopen < 2; reopen++) {
      const upgraded = openStore(fixture.directory);
      try {
        expect(migrationCount(upgraded.sqlite)).toBe(latestMigrationCount);
        expect(upgraded.db.select().from(projects).all()).toEqual([project]);
        const persisted = upgraded.db.select().from(credentials).get()!;
        expect(persisted).toEqual(credential);
        expect(decrypt(upgraded, persisted.encryptedSecret)).toBe(
          '{"token":"preserved"}',
        );
        expect(
          upgraded.sqlite
            .query(
              "SELECT name FROM sqlite_master WHERE name IN ('runs_queue_idx','runs_active_idx','mail_outbox_due_idx')",
            )
            .all(),
        ).toHaveLength(3);
        expect(upgraded.sqlite.query("PRAGMA foreign_key_check").all()).toEqual(
          [],
        );
      } finally {
        upgraded.close();
      }
    }
  } finally {
    fixture.cleanup();
  }
});

test("a failed generated upgrade rolls back and can be retried without losing data", () => {
  const fixture = temporaryDatabase();
  try {
    const original = initialStore(fixture.directory);
    const { project } = seedWorkspace(original);
    original.sqlite.exec("CREATE INDEX runs_queue_idx ON users(email);");
    original.close();
    expect(() => openStore(fixture.directory)).toThrow();
    const inspect = new Database(join(fixture.directory, databaseFilename));
    try {
      expect(migrationCount(inspect)).toBe(1);
      expect(inspect.query("SELECT name FROM projects").get()).toEqual({
        name: project.name,
      });
      expect(
        inspect
          .query(
            "SELECT name FROM sqlite_master WHERE name IN ('runs_active_idx','mail_outbox_due_idx')",
          )
          .all(),
      ).toEqual([]);
      inspect.exec("DROP INDEX runs_queue_idx;");
    } finally {
      inspect.close();
    }
    const recovered = openStore(fixture.directory);
    try {
      expect(migrationCount(recovered.sqlite)).toBe(latestMigrationCount);
    } finally {
      recovered.close();
    }
  } finally {
    fixture.cleanup();
  }
});
