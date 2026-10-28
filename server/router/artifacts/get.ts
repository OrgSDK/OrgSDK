import { artifactIdSchema } from "../../runs/artifacts";
import { browserWorkspaceProcedure } from "../procedures";
import { and, eq } from "drizzle-orm";
import { artifacts } from "../../db/schema";
import { ServiceError } from "../../shared/errors";
import { artifactView } from "../../runs/artifacts";

export const getProcedure = browserWorkspaceProcedure
  .input(artifactIdSchema)
  .query(({ ctx, input }) => {
    const artifact = ctx.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.workspaceId, ctx.workspace.id),
          eq(artifacts.id, input.id),
        ),
      )
      .get();
    if (!artifact) {
      throw new ServiceError("NOT_FOUND", "Not found.");
    }
    return artifactView(artifact);
  });
