import { credentialQueries } from "../../credentials/queries";
import { page } from "../../shared/pagination";
import { browserWorkspaceProcedure } from "../procedures";

export const listProcedure = browserWorkspaceProcedure.query(({ ctx }) => {
  const workspaceId = ctx.workspace.id;
  return page(credentialQueries(ctx.db, workspaceId).list());
});
