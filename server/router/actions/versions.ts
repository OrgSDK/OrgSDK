import { and, desc, eq, inArray } from "drizzle-orm";
import { actionVersions } from "../../db/schema";
import { actionIdSchema } from "../../actions/schemas";
import { serializeVersion } from "../../actions/views";
import { actionsRepository } from "../../repositories/actions";
import { scopedProcedure } from "../procedures";

export const versionsProcedure = scopedProcedure("catalog:read")
  .input(actionIdSchema)
  .query(({ ctx, input }) => {
    const action = actionsRepository(ctx).find(input.id);
    const token = ctx.token;
    const versionGrant =
      token && !token.projects.includes(action.projectId)
        ? inArray(actionVersions.id, token.actionVersions)
        : undefined;
    const versions = ctx.db
      .select()
      .from(actionVersions)
      .where(
        and(
          eq(actionVersions.workspaceId, ctx.workspace.id),
          eq(actionVersions.actionId, action.id),
          versionGrant,
        ),
      )
      .orderBy(desc(actionVersions.number))
      .all();
    return versions.map(serializeVersion);
  });
