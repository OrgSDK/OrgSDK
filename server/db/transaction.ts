import type { AppDatabase } from "./database";

export function inTransaction<Context extends { db: AppDatabase }, Result>(
  context: Context,
  operation: (context: Context) => Result,
): Result {
  return context.db.transaction(
    (database) => operation({ ...context, db: database }),
    { behavior: "immediate" },
  );
}
