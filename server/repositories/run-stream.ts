import { and, asc, eq, gt } from "drizzle-orm";
import type { Store } from "../db";
import { runEvents } from "../db/schema";

export function eventsAfter(
  store: Store,
  workspaceId: number,
  runId: string,
  after: number,
): (typeof runEvents.$inferSelect)[] {
  return store.db
    .select()
    .from(runEvents)
    .where(
      and(
        eq(runEvents.workspaceId, workspaceId),
        eq(runEvents.runId, runId),
        gt(runEvents.sequence, after),
      ),
    )
    .orderBy(asc(runEvents.sequence))
    .limit(100)
    .all();
}
