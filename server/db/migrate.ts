import { readMigrationFiles } from "drizzle-orm/migrator";
import { z } from "zod";
import { assetDirectory } from "../platform/assets";
import type { SqliteConnection } from "./connection";

export const migrationsFolder = assetDirectory("migrations");
export const databaseFilename = "orgsdk.sqlite3";

const appliedMigration = z.object({ hash: z.string(), createdAt: z.number() });

export function assertManagedDatabase(sqlite: SqliteConnection): void {
  const tables = z
    .array(z.object({ name: z.string() }))
    .parse(
      sqlite
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all(),
    );
  if (tables.length === 0) {
    return;
  }
  if (!tables.some((table) => table.name === "__drizzle_migrations")) {
    throw new Error(
      "Unmanaged database; refusing to open it. Use an empty data directory.",
    );
  }
  const applied = z
    .array(appliedMigration)
    .parse(
      sqlite
        .query(
          "SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at",
        )
        .all(),
    );
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
