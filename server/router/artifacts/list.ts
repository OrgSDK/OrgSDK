import { browserWorkspaceProcedure } from "../procedures";
import { page } from "../../shared/pagination";
import { eq } from "drizzle-orm";
import { artifacts } from "../../db/schema";
import { artifactView } from "../../runs/artifacts";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const workspaceArtifacts = ctx.db
    .select()
    .from(artifacts)
    .where(eq(artifacts.workspaceId, ctx.workspace.id))
    .all();
  return page(workspaceArtifacts.map(artifactView));
});
