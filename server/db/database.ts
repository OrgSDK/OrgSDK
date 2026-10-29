import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type * as schema from "./schema";

// Application code receives Drizzle's query and transaction API, never its native client.
export type AppDatabase = Pick<
  BunSQLiteDatabase<typeof schema>,
  "select" | "insert" | "update" | "delete" | "transaction"
>;
