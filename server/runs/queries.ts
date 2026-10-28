import { and, eq } from "drizzle-orm";
import { runs } from "../db/schema";
import { type ServiceContext } from "../application";
import { runsRepository } from "../repositories/runs";

export function findIdempotentRun(
  ctx: ServiceContext,
  namespace: string,
  key: string,
) {
  return runsRepository(ctx).list(
    and(eq(runs.idempotencyNamespace, namespace), eq(runs.idempotencyKey, key)),
  )[0];
}
