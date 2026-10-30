import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

export type DatabaseConnection = BaseSQLiteDatabase<
  "sync",
  unknown,
  typeof schema
>;
export type SqliteValue = string | number | bigint | Uint8Array | null;

export interface SqliteConnection {
  exec(sql: string): unknown;
  query(sql: string): {
    all(...parameters: SqliteValue[]): unknown[];
    get(...parameters: SqliteValue[]): unknown;
    run(...parameters: SqliteValue[]): unknown;
  };
  close(): void;
}

export interface OpenDatabase {
  db: DatabaseConnection;
  sqlite: SqliteConnection;
  migrate(migrationsFolder: string): void;
}

const driver =
  typeof Bun === "undefined"
    ? await import("./node-driver")
    : await import("./bun-driver");

export const openDatabase = driver.openDatabase;
