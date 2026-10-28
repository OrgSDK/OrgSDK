import { requireCredentialAccess } from "../../credentials/access";
import { credentialQueries } from "../../credentials/queries";
import { inTransaction } from "../../db/transaction";
import { recordAudit } from "../../repositories/audit";
import { credentialChangesSchema } from "../../credentials/schemas";
import { ServiceError } from "../../shared/errors";
import { protectedProcedure } from "../procedures";

export const updateProcedure = protectedProcedure
  .input(credentialChangesSchema)
  .mutation(({ ctx, input }) => {
    const workspaceId = requireCredentialAccess(ctx, true);
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.secret === undefined
        ? {}
        : {
            encryptedSecret: ctx.secrets.encrypt(JSON.stringify(input.secret)),
          }),
    };
    return inTransaction(ctx, (ctx) => {
      const credential = credentialQueries(ctx.db, workspaceId).update(
        input.id,
        changes,
      );
      if (!credential) {
        throw new ServiceError("NOT_FOUND", "Credential not found.");
      }
      recordAudit(ctx, "credential", credential.id, "updated");
      return credential;
    });
  });
