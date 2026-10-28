import { eq, sql } from "drizzle-orm";
import type { Store } from "../db";
import { authAttempts } from "../db/schema/maintenance";
import { HttpError } from "../http/responses";

export function recordAuthAttempt(
  store: Store,
  key: string,
  time: number,
): void {
  store.sqlite
    .transaction(() => {
      const current = store.db
        .select()
        .from(authAttempts)
        .where(eq(authAttempts.key, key))
        .get();
      if (current && current.expiresAt > time && current.count >= 10) {
        throw new HttpError(429, "Too many attempts. Try again later.");
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
    })
    .immediate();
}
