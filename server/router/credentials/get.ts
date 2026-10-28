import { findCredential } from "../../credentials/queries";
import { credentialIdSchema } from "../../credentials/schemas";
import { ServiceError } from "../../shared/errors";
import { browserWorkspaceProcedure } from "../procedures";

export const getProcedure = browserWorkspaceProcedure
  .input(credentialIdSchema)
  .query(({ ctx, input }) => {
    const credential = findCredential(ctx.db, ctx.workspace.id, input.id);
    if (!credential) {
      throw new ServiceError("NOT_FOUND", "Credential not found.");
    }
    return credential;
  });
