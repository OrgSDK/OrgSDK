import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { OpenDatabase } from "./connection";
import * as schema from "./schema";

export function openDatabase(path: string, readonly = false): OpenDatabase {
  const sqlite = new Database(path, { readonly, create: !readonly });
  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    db,
    migrate: (migrationsFolder) => migrate(db, { migrationsFolder }),
  };
}
