import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { OpenDatabase, SqliteConnection, SqliteValue } from "./connection";
import * as schema from "./schema";

export function openDatabase(path: string, readonly = false): OpenDatabase {
  const client = new Database(path, { readonly, fileMustExist: readonly });
  const db = drizzle(client, { schema });
  const sqlite: SqliteConnection = {
    exec: (sql) => client.exec(sql),
    query: (sql) => client.prepare<SqliteValue[], unknown>(sql),
    close: () => client.close(),
  };
  return {
    sqlite,
    db,
    migrate: (migrationsFolder) => migrate(db, { migrationsFolder }),
  };
}
