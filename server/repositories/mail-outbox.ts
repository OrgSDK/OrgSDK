import { and, asc, eq, isNull, lt, lte, or } from "drizzle-orm";
import type { Store } from "../db";
import { invitations } from "../db/schema/core";
import { mailOutbox } from "../db/schema/maintenance";

export function enqueueMail(
  store: Store,
  message: Pick<
    typeof mailOutbox.$inferInsert,
    "id" | "recipient" | "subject" | "body"
  >,
): void {
  store.db
    .insert(mailOutbox)
    .values({ ...message, nextAttempt: Date.now() })
    .run();
}

export function revokeUnsentMail(store: Store, id: string): void {
  const unsent = and(
    eq(mailOutbox.id, id),
    isNull(mailOutbox.sentAt),
    isNull(mailOutbox.leaseUntil),
  );
  store.db.delete(mailOutbox).where(unsent).run();
}

export function claimMail(
  store: Store,
  time: number,
): typeof mailOutbox.$inferSelect | undefined {
  return store.sqlite
    .transaction(() => {
      const availableLease = or(
        isNull(mailOutbox.leaseUntil),
        lt(mailOutbox.leaseUntil, time),
      );
      const due = and(
        isNull(mailOutbox.sentAt),
        lte(mailOutbox.nextAttempt, time),
        availableLease,
      );
      const row = store.db
        .select()
        .from(mailOutbox)
        .where(due)
        .orderBy(asc(mailOutbox.nextAttempt))
        .limit(1)
        .get();
      if (!row) return;
      if (row.id.startsWith("invitation:")) {
        const id = Number(row.id.slice("invitation:".length));
        const invitation = store.db
          .select()
          .from(invitations)
          .where(eq(invitations.id, id))
          .get();
        if (
          !invitation ||
          invitation.acceptedAt ||
          invitation.revokedAt ||
          invitation.expiresAt <= new Date(time).toISOString()
        ) {
          store.db.delete(mailOutbox).where(eq(mailOutbox.id, row.id)).run();
          return;
        }
      }
      store.db
        .update(mailOutbox)
        .set({ leaseUntil: time + 120_000 })
        .where(eq(mailOutbox.id, row.id))
        .run();
      return row;
    })
    .immediate();
}

export function markMailSent(store: Store, id: string): void {
  store.db
    .update(mailOutbox)
    .set({ sentAt: Date.now(), leaseUntil: null, body: "", lastError: null })
    .where(eq(mailOutbox.id, id))
    .run();
}

export function retryMail(
  store: Store,
  job: typeof mailOutbox.$inferSelect,
): void {
  const attempts = job.attempts + 1;
  const delay = Math.min(86_400_000, 30_000 * 2 ** Math.min(attempts, 12));
  store.db
    .update(mailOutbox)
    .set({
      attempts,
      nextAttempt: Date.now() + delay,
      leaseUntil: null,
      lastError: "Delivery failed",
    })
    .where(eq(mailOutbox.id, job.id))
    .run();
}
