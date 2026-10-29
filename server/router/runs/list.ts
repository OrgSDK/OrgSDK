import { and, desc, eq, inArray, or } from "drizzle-orm";
import { runs } from "../../db/schema";
import { serializeRun } from "../../runs/views";
import { page } from "../../shared/pagination";
import { scopedProcedure } from "../procedures";

export const listProcedure = scopedProcedure("runs:read").query(({ ctx }) => {
  const token = ctx.token;
  const grant = token
    ? and(
        eq(runs.tokenId, token.id),
        or(
          inArray(runs.projectId, token.projects),
          inArray(runs.actionVersionId, token.actionVersions),
        ),
      )
    : undefined;
  const visibleRuns = ctx.db
    .select()
    .from(runs)
    .where(and(eq(runs.workspaceId, ctx.workspace.id), grant))
    .orderBy(desc(runs.createdAt))
    .all();
  return page(visibleRuns.map(serializeRun));
});
