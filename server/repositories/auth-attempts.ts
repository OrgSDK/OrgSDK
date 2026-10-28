import { inTransaction } from "../db/transaction";
import { eq, sql } from "drizzle-orm";
import type { AppDependencies } from "../application";
import { authAttempts } from "../db/schema/maintenance";
import { ServiceError } from "../shared/errors";

export function recordAuthAttempt(
  store: AppDependencies,
  key: string,
  time: number,
): void {
  inTransaction(store, (store) => {
    const current = store.db
      .select()
      .from(authAttempts)
      .where(eq(authAttempts.key, key))
      .get();
    if (current && current.expiresAt > time && current.count >= 10) {
      throw new ServiceError(
        "TOO_MANY_REQUESTS",
        "Too many attempts. Try again later.",
      );
    }
    if (!current || current.expiresAt <= time) {
      store.db
        .insert(authAttempts)
        .values({ key, count: 1, expiresAt: time + 15 * 60_000 })
        .onConflictDoUpdate({
          target: authAttempts.key,
          set: { count: 1, expiresAt: time + 15 * 60_000 },
        })
        .run();
      return;
    }
    store.db
      .update(authAttempts)
      .set({ count: sql`${authAttempts.count} + 1` })
      .where(eq(authAttempts.key, key))
      .run();
  });
}
