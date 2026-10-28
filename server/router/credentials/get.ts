import { requireCredentialAccess } from "../../credentials/access";
import { credentialQueries } from "../../credentials/queries";
import { credentialIdSchema } from "../../credentials/schemas";
import { ServiceError } from "../../shared/errors";
import { protectedProcedure } from "../procedures";

export const getProcedure = protectedProcedure
  .input(credentialIdSchema)
  .query(({ ctx, input }) => {
    const workspaceId = requireCredentialAccess(ctx);
    const credential = credentialQueries(ctx.db, workspaceId).findById(
      input.id,
    );
    if (!credential) {
      throw new ServiceError("NOT_FOUND", "Credential not found.");
    }
    return credential;
  });
