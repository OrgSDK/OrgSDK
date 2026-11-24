import { inArray } from "drizzle-orm";
import type { AppDatabase } from "../db/database";
import { runs, workspaces } from "../db/schema";
import type { ServiceContext } from "../application";
import { isLoopbackInstallation } from "../auth/studio";

export const managerHeartbeat = new WeakMap<
  ServiceContext["secrets"],
  number
>();

const requested = new WeakMap<AppDatabase, string>();
export function canManageUpdate(ctx: ServiceContext): boolean {
  return (
    ctx.role === "owner" &&
    !!ctx.sessionId &&
    !ctx.token &&
    process.env.ORGSDK_MANAGED_UPDATES === "1" &&
    !!process.connected &&
    isLoopbackInstallation(ctx.origin) &&
    ctx.db.select({ id: workspaces.id }).from(workspaces).limit(2).all()
      .length === 1
  );
}

export function pendingUpdate(db: AppDatabase) {
  return requested.get(db) ?? null;
}
export function drainForUpdate(db: AppDatabase, version: string) {
  requested.set(db, version);
  // Give the requesting browser its receipt before the supervisor stops the listener.
  const timer = setInterval(() => {
    const busy = db
      .select({ id: runs.id })
      .from(runs)
      .where(inArray(runs.status, ["running", "waiting_approval"]))
      .limit(1)
      .get();
    if (busy) {
      return;
    }
    clearInterval(timer);
    if (!process.connected || !process.send) {
      requested.delete(db);
      return;
    }
    process.send({ update: version }, (error: Error | null) => {
      if (error) {
        requested.delete(db);
      }
    });
  }, 1000);
  timer.unref();
}
