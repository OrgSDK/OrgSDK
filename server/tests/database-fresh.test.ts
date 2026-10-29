import { expect, test } from "bun:test";
import { z } from "zod";
import { getTableName } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { openStore } from "../db";
import { migrationsFolder } from "../db/migrate";
import * as schema from "../db/schema";
import {
  migrationCount,
  seedWorkspace,
  temporaryDatabase,
} from "./database-fixture";

test("fresh installs apply generated migrations and expose the declared schema", () => {
  const fixture = temporaryDatabase();
  try {
    const store = openStore(fixture.directory);
    try {
      const expected = readMigrationFiles({ migrationsFolder });
      expect(migrationCount(store.sqlite)).toBe(expected.length);
      const tables = z
        .array(z.object({ name: z.string() }))
        .parse(
          store.sqlite
            .query(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .all(),
        )
        .map((table) => table.name);
      expect(tables.sort()).toEqual(
        [
          ...Object.values(schema).map(getTableName),
          "__drizzle_migrations",
        ].sort(),
      );
      expect(tables.some((name) => name.startsWith("domain_"))).toBe(false);
      expect(store.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
      const { project } = seedWorkspace(store);
      expect(project.enabled).toBe(true);
      expect(project.readableTables).toEqual([]);
      expect(project.writableDocuments).toEqual([]);
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("generated schema enforces foreign keys, case-insensitive uniqueness and role checks", () => {
  const fixture = temporaryDatabase();
  try {
    const store = openStore(fixture.directory);
    try {
      const { user, workspace, project, time } = seedWorkspace(store);
      expect(() =>
        store.db
          .insert(schema.projects)
          .values({
            ...project,
            id: crypto.randomUUID(),
            workspaceId: workspace.id + 1,
          })
          .run(),
      ).toThrow("FOREIGN KEY");
      expect(() =>
        store.db
          .insert(schema.users)
          .values({
            username: "another",
            email: user.email.toUpperCase(),
            passwordHash: "hash",
          })
          .run(),
      ).toThrow("UNIQUE");
      expect(() =>
        store.db
          .insert(schema.workspaces)
          .values({ name: "Duplicate", host: "LOCALHOST", createdAt: time })
          .run(),
      ).toThrow("UNIQUE");
      const member = store.db
        .insert(schema.users)
        .values({
          username: "member",
          email: "member@example.test",
          passwordHash: "hash",
        })
        .returning()
        .get();
      expect(() =>
        store.db
          .insert(schema.memberships)
          .values({
            userId: member.id,
            workspaceId: workspace.id,
            role: "invalid",
          })
          .run(),
      ).toThrow("CHECK");
      expect(() =>
        store.db
          .insert(schema.memberships)
          .values({
            userId: member.id,
            workspaceId: workspace.id,
            role: "owner",
          })
          .run(),
      ).toThrow("UNIQUE");
      const run = {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        projectId: project.id,
        actorId: user.id,
        operation: "code",
        idempotencyKey: "one",
        createdAt: time,
        updatedAt: time,
      };
      expect(() =>
        store.db
          .insert(schema.runs)
          .values({ ...run, status: "invalid" })
          .run(),
      ).toThrow("CHECK");
      store.db.insert(schema.runs).values(run).run();
      expect(() =>
        store.db
          .insert(schema.runs)
          .values({ ...run, id: crypto.randomUUID() })
          .run(),
      ).toThrow("UNIQUE");
      expect(() => store.db.delete(schema.projects).run()).toThrow(
        "FOREIGN KEY",
      );
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});
