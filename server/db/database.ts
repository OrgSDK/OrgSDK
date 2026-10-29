import type { DatabaseConnection } from "./connection";

// Application code receives Drizzle's query and transaction API, never its native client.
export type AppDatabase = Pick<
  DatabaseConnection,
  "select" | "insert" | "update" | "delete" | "transaction"
>;
