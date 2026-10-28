import { credentialQueries } from "../../credentials/queries";
import { credentialIdSchema } from "../../credentials/schemas";
import { ServiceError } from "../../shared/errors";
import { browserWorkspaceProcedure } from "../procedures";

export const getProcedure = browserWorkspaceProcedure
  .input(credentialIdSchema)
  .query(({ ctx, input }) => {
    const workspaceId = ctx.workspace.id;
    const credential = credentialQueries(ctx.db, workspaceId).findById(
      input.id,
    );
    if (!credential) {
      throw new ServiceError("NOT_FOUND", "Credential not found.");
    }
    return credential;
  });
