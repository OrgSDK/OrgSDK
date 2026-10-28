import { and, eq } from "drizzle-orm";
import { runs } from "../db/schema";
import { type ServiceContext } from "../application";
import { workspace } from "../domain/permissions";

export function findIdempotentRun(
  ctx: ServiceContext,
  namespace: string,
  key: string,
) {
  return ctx.db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.workspaceId, workspace(ctx)),
        eq(runs.idempotencyNamespace, namespace),
        eq(runs.idempotencyKey, key),
      ),
    )
    .get();
}
