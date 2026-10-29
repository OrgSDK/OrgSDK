import { z } from "zod";
import type { Store } from "../db";
import type { SqliteConnection } from "../db/connection";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databaseFilename, migrationsFolder } from "../db/migrate";
import journal from "../db/migrations/meta/_journal.json";
import * as schema from "../db/schema";
import { createSecretCipher } from "../shared/secrets";
import { ensureEncryptionKey } from "../shared/security";

export function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "orgsdk-database-"));
  return {
    directory,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export const latestMigrationCount = journal.entries.length;

export function initialStore(dataDir: string, migrationLimit = 1) {
  mkdirSync(dataDir, { recursive: true });
  const migrationDirectory = mkdtempSync(
    join(tmpdir(), "orgsdk-initial-migration-"),
  );
  const sqlite = new Database(join(dataDir, databaseFilename), {
    create: true,
  });
  try {
    const entries = journal.entries.slice(0, migrationLimit);
    mkdirSync(join(migrationDirectory, "meta"));
    writeFileSync(
      join(migrationDirectory, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    for (const entry of entries) {
      copyFileSync(
        join(migrationsFolder, `${entry.tag}.sql`),
        join(migrationDirectory, `${entry.tag}.sql`),
      );
    }
    sqlite.exec("PRAGMA foreign_keys=ON;");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: migrationDirectory });
    const secrets = createSecretCipher(ensureEncryptionKey(dataDir));
    return { db, sqlite, dataDir, secrets, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  } finally {
    rmSync(migrationDirectory, { recursive: true, force: true });
  }
}

export function seedWorkspace(store: Pick<Store, "db">) {
  const time = new Date().toISOString();
  const user = store.db
    .insert(schema.users)
    .values({
      username: "owner",
      email: "owner@example.test",
      passwordHash: "test hash",
    })
    .returning()
    .get();
  const workspace = store.db
    .insert(schema.workspaces)
    .values({ name: "Workspace", host: "localhost", createdAt: time })
    .returning()
    .get();
  store.db
    .insert(schema.memberships)
    .values({ userId: user.id, workspaceId: workspace.id, role: "owner" })
    .run();
  const project = store.db
    .insert(schema.projects)
    .values({
      id: crypto.randomUUID(),
      workspaceId: workspace.id,
      name: "Persistent project",
      createdAt: time,
      updatedAt: time,
    })
    .returning()
    .get();
  return { user, workspace, project, time };
}

export function migrationCount(sqlite: SqliteConnection): number {
  const row = sqlite
    .query("SELECT count(*) AS count FROM __drizzle_migrations")
    .get();
  return z.object({ count: z.number() }).parse(row).count;
}
