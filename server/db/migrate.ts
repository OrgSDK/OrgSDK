import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { join } from "node:path";
import type * as schema from "./schema";

export const migrationsFolder = join(import.meta.dir, "migrations");
export const databaseFilename = "orgsdk.sqlite3";

type AppliedMigration = { hash: string; createdAt: number };

export function assertManagedDatabase(sqlite: Database): void {
  const tables = sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  if (tables.length === 0) return;
  if (!tables.some((table) => table.name === "__drizzle_migrations")) {
    throw new Error(
      "Unmanaged database; refusing to open it. Use an empty data directory.",
    );
  }
  const applied = sqlite
    .query<AppliedMigration, []>(
      "SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at",
    )
    .all();
  const available = readMigrationFiles({ migrationsFolder });
  if (applied.length === 0 && tables.length > 1) {
    throw new Error("Database tables have no recorded migrations.");
  }
  for (const [index, migration] of applied.entries()) {
    const expected = available[index];
    if (
      !expected ||
      migration.hash !== expected.hash ||
      migration.createdAt !== expected.folderMillis
    ) {
      throw new Error(
        "Database migration history does not match this application.",
      );
    }
  }
}

export function migrateDatabase(
  database: BunSQLiteDatabase<typeof schema>,
): void {
  migrate(database, { migrationsFolder });
}
